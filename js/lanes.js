/* Top-down road segment with car-following traffic. Density and speed follow
   road pressure; weather changes the surface, visibility and driver gaps. */
(function () {
  const TX = (window.TX = window.TX || {});
  const BODY = ['#d9d4cb', '#9aa3ab', '#5d666e', '#c9b79c', '#3b4249', '#e6e1d8', '#7d858c', '#b14a3a'];
  const WX = {
    clear: { v: 1, gap: 8, rain: 0, fog: 0 },
    rain: { v: 0.86, gap: 12, rain: 70, fog: 0 },
    heavy: { v: 0.7, gap: 16, rain: 190, fog: 0.08 },
    fog: { v: 0.74, gap: 15, rain: 0, fog: 0.5 }
  };

  class LaneStrip {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = Object.assign({ label: 'Segment' }, opts);
      this.pressure = 0.6;
      this.weather = 'clear';
      this.lanes = [];
      this.drops = [];
      this.fogBlobs = Array.from({ length: 7 }, () => ({ x: Math.random(), y: Math.random(), r: 0.25 + Math.random() * 0.3, v: 0.01 + Math.random() * 0.02 }));
      this.t = 0;
      this.resize();
      new ResizeObserver(() => this.resize()).observe(canvas);
      new IntersectionObserver((es) => {
        this.visible = es[0].isIntersecting;
        if (this.visible && !this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame((t) => this.frame(t)); }
      }).observe(canvas);
    }

    resize() {
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = w; this.h = h; this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      const roadH = Math.min(h * 0.72, 180);
      this.roadTop = (h - roadH) / 2;
      this.laneH = roadH / 4;
      this.unit = this.laneH / 36; // car size scales with lane height
      const prev = this.lanes;
      this.lanes = [0, 1, 2, 3].map((i) => ({
        dir: i < 2 ? -1 : 1,
        y: this.roadTop + this.laneH * (i + 0.5),
        cars: prev[i] ? prev[i].cars : []
      }));
      if (!prev.length) this.prefill();
    }

    prefill() {
      for (const lane of this.lanes) {
        const gap = this.spawnGap();
        for (let x = 20; x < this.w; x += gap * (0.8 + Math.random() * 0.5)) {
          lane.cars.push(this.makeCar(lane.dir > 0 ? x : this.w - x));
        }
        lane.cars.sort((a, b) => (a.x - b.x) * -lane.dir);
      }
    }

    makeCar(x) {
      return { x, v: this.vmax() * 0.8, j: 0.85 + Math.random() * 0.3, len: (24 + Math.random() * 8) * this.unit, col: BODY[(Math.random() * BODY.length) | 0], brake: 0, hold: 0 };
    }

    vmax() { return 170 * this.unit * Math.max(0.12, 1.12 - this.pressure * 0.9) * WX[this.weather].v; }
    spawnGap() { return (12 + Math.pow(Math.max(0, 1 - this.pressure), 1.4) * 300) * this.unit + WX[this.weather].gap * this.unit; }

    set(d) {
      if (d.pressure != null) this.pressure = Math.max(0.05, Math.min(1.2, d.pressure));
      if (d.weather) this.weather = d.weather;
      if (d.label) this.opts.label = d.label;
      if (!this.raf) this.draw();
    }

    frame(t) {
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      this.t += dt;
      this.update(dt);
      this.draw();
      this.raf = this.visible ? requestAnimationFrame((tt) => this.frame(tt)) : null;
    }

    update(dt) {
      const wx = WX[this.weather];
      const vmax = this.vmax();
      const minGap = wx.gap * this.unit;
      for (const lane of this.lanes) {
        const cars = lane.cars; // ordered front (exit side) to back
        for (let i = 0; i < cars.length; i++) {
          const c = cars[i];
          let target = vmax * c.j;
          if (i > 0) {
            const lead = cars[i - 1];
            const gap = (lead.x - c.x) * lane.dir - lead.len;
            target = Math.min(target, Math.max(0, gap - minGap) * 2.4);
          }
          if (c.hold > 0) { c.hold -= dt; target = Math.min(target, vmax * 0.15); }
          const a = target < c.v ? 5 : 1.6;
          c.v += (target - c.v) * Math.min(1, dt * a);
          c.brake = target < c.v - 4 * this.unit || c.hold > 0 ? 1 : Math.max(0, c.brake - dt * 3);
          c.x += c.v * dt * lane.dir;
        }
        // exits
        while (cars.length && (lane.dir > 0 ? cars[0].x > this.w + 40 : cars[0].x < -40)) cars.shift();
        // entries
        const entry = lane.dir > 0 ? -30 : this.w + 30;
        const last = cars[cars.length - 1];
        const room = last ? (last.x - entry) * lane.dir - last.len : Infinity;
        if (room > this.spawnGap() * (0.7 + Math.random() * 0.8)) {
          const car = this.makeCar(entry);
          car.v = Math.min(vmax, last ? Math.max(0, room - minGap) * 2.4 : vmax);
          cars.push(car);
        }
        // stop-and-go waves under pressure
        if (this.pressure > 0.78 && cars.length > 4 && Math.random() < dt * (this.pressure - 0.7) * 1.4) {
          cars[(Math.random() * (cars.length * 0.6)) | 0].hold = 0.5 + Math.random() * 0.6;
        }
      }
    }

    avgKmh() {
      let s = 0, n = 0;
      for (const l of this.lanes) for (const c of l.cars) { if (c.x > 0 && c.x < this.w) { s += c.v; n++; } }
      return n ? Math.round(((s / n) / (170 * this.unit)) * 62) : 0;
    }

    draw() {
      const ctx = this.ctx, w = this.w, h = this.h, u = this.unit;
      if (!w) return;
      const wx = WX[this.weather];
      const wet = wx.rain > 0;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = '#071116';
      ctx.fillRect(0, 0, w, h);

      // verge texture
      ctx.fillStyle = 'rgba(160,175,190,0.035)';
      for (let x = 0; x < w; x += 46) {
        ctx.fillRect(x + 6, 6, 34, this.roadTop - 18);
        ctx.fillRect(x + 6, this.roadTop + this.laneH * 4 + 12, 34, h - (this.roadTop + this.laneH * 4) - 18);
      }

      // road surface
      const top = this.roadTop, rh = this.laneH * 4;
      ctx.fillStyle = wet ? '#0C1A22' : '#0E1C22';
      ctx.fillRect(0, top, w, rh);
      if (wet) {
        // sheen streaks
        ctx.fillStyle = 'rgba(59,130,246,0.05)';
        for (let i = 0; i < 6; i++) ctx.fillRect(((i * 237 + this.t * 6) % (w + 300)) - 150, top + ((i * 53) % rh), 160, 2);
      }
      ctx.strokeStyle = 'rgba(244,245,242,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, top + 0.5); ctx.lineTo(w, top + 0.5); ctx.moveTo(0, top + rh - 0.5); ctx.lineTo(w, top + rh - 0.5); ctx.stroke();
      // median
      ctx.strokeStyle = 'rgba(245,158,11,0.55)';
      ctx.beginPath(); ctx.moveTo(0, top + rh / 2 - 1.5); ctx.lineTo(w, top + rh / 2 - 1.5); ctx.moveTo(0, top + rh / 2 + 1.5); ctx.lineTo(w, top + rh / 2 + 1.5); ctx.stroke();
      // lane dashes
      ctx.strokeStyle = 'rgba(244,245,242,0.22)';
      ctx.setLineDash([16 * u, 22 * u]);
      ctx.beginPath();
      [1, 3].forEach((k) => { ctx.moveTo(0, top + this.laneH * k); ctx.lineTo(w, top + this.laneH * k); });
      ctx.stroke();
      ctx.setLineDash([]);

      // cars
      const cw = 15 * u;
      for (const lane of this.lanes) {
        for (const c of lane.cars) {
          const x0 = lane.dir > 0 ? c.x - c.len : c.x;
          const y0 = lane.y - cw / 2;
          const front = lane.dir > 0 ? c.x : c.x;
          // headlight cone
          if (this.weather !== 'clear') {
            const g = ctx.createLinearGradient(front, 0, front + lane.dir * 70 * u, 0);
            g.addColorStop(0, `rgba(255,236,200,${this.weather === 'fog' ? 0.22 : 0.12})`);
            g.addColorStop(1, 'rgba(255,236,200,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(front, lane.y - cw * 0.35);
            ctx.lineTo(front + lane.dir * 70 * u, lane.y - cw * 0.9);
            ctx.lineTo(front + lane.dir * 70 * u, lane.y + cw * 0.9);
            ctx.lineTo(front, lane.y + cw * 0.35);
            ctx.fill();
          }
          ctx.fillStyle = c.col;
          roundRect(ctx, x0, y0, c.len, cw, 3 * u);
          ctx.fill();
          // cabin
          ctx.fillStyle = 'rgba(10,12,14,0.55)';
          const cabX = lane.dir > 0 ? x0 + c.len * 0.3 : x0 + c.len * 0.22;
          roundRect(ctx, cabX, y0 + cw * 0.14, c.len * 0.48, cw * 0.72, 2 * u);
          ctx.fill();
          // brake lights
          const rearX = lane.dir > 0 ? x0 : x0 + c.len;
          if (c.brake > 0.05) {
            ctx.fillStyle = `rgba(255,60,40,${0.25 * c.brake})`;
            ctx.beginPath(); ctx.arc(rearX, lane.y, 11 * u, 0, Math.PI * 2); ctx.fill();
          }
          ctx.fillStyle = c.brake > 0.05 ? '#EF4444' : 'rgba(150,40,30,0.9)';
          ctx.fillRect(rearX - (lane.dir > 0 ? 0 : 2 * u), y0 + 1.5 * u, 2 * u, 3 * u);
          ctx.fillRect(rearX - (lane.dir > 0 ? 0 : 2 * u), y0 + cw - 4.5 * u, 2 * u, 3 * u);
        }
      }

      // rain
      if (wx.rain) {
        const n = Math.round(wx.rain * (w / 1000));
        while (this.drops.length < n) this.drops.push([Math.random() * w, Math.random() * h, 0.6 + Math.random() * 0.7]);
        this.drops.length = n;
        ctx.strokeStyle = this.weather === 'heavy' ? 'rgba(180,205,230,0.4)' : 'rgba(180,205,230,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const sp = this.weather === 'heavy' ? 1100 : 750;
        for (const d of this.drops) {
          d[1] += sp * d[2] * 0.016; d[0] -= 160 * d[2] * 0.016;
          if (d[1] > h) { d[1] = -14; d[0] = Math.random() * (w + 120); }
          ctx.moveTo(d[0], d[1]); ctx.lineTo(d[0] + 3.5, d[1] - 14 * d[2]);
        }
        ctx.stroke();
        if (this.weather === 'heavy') {
          ctx.strokeStyle = 'rgba(180,205,230,0.18)';
          for (let i = 0; i < 10; i++) {
            const ph = (this.t * 1.7 + i * 0.37) % 1;
            const x = ((i * 389.3) % w), y = top + ((i * 71.7) % rh);
            ctx.beginPath(); ctx.ellipse(x, y, 2 + ph * 10, (2 + ph * 10) * 0.4, 0, 0, Math.PI * 2); ctx.globalAlpha = 1 - ph; ctx.stroke(); ctx.globalAlpha = 1;
          }
        }
      }

      // fog
      if (wx.fog) {
        ctx.fillStyle = `rgba(150,160,170,${wx.fog * 0.28})`;
        ctx.fillRect(0, 0, w, h);
        for (const b of this.fogBlobs) {
          b.x += b.v * 0.016; if (b.x > 1.4) b.x = -0.4;
          const gx = b.x * w, gy = b.y * h, r = b.r * w;
          const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
          g.addColorStop(0, `rgba(175,185,195,${wx.fog * 0.32})`);
          g.addColorStop(1, 'rgba(175,185,195,0)');
          ctx.fillStyle = g;
          ctx.fillRect(gx - r, gy - r, r * 2, r * 2);
        }
      }

      // hud
      ctx.font = '500 10.5px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillStyle = 'rgba(244,245,242,0.45)';
      ctx.textAlign = 'left';
      ctx.fillText(this.opts.label.toUpperCase(), 14, 18);
      ctx.textAlign = 'right';
      ctx.fillText(`AVG ${this.avgKmh()} KM/H`, w - 14, 18);
      ctx.textAlign = 'left';
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  TX.LaneStrip = LaneStrip;
})();
