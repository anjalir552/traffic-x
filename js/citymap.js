/* 2D city traffic map: road graph, moving vehicles, congestion overlays, hotspots. */
(function () {
  const TX = (window.TX = window.TX || {});

  const VW = 1000, VH = 620;

  // Major intersections (virtual coordinates).
  const NODES = {
    A: [110, 118], B: [352, 92], C: [612, 112], D: [884, 138],
    E: [92, 318], F: [334, 300], G: [592, 322], H: [892, 334],
    I: [128, 528], J: [382, 520], K: [644, 506], L: [904, 548]
  };
  // [from, to, optional bend control point]
  const EDGES = [
    ['A', 'B'], ['B', 'C', [480, 92]], ['C', 'D'],
    ['E', 'F'], ['F', 'G'], ['G', 'H', [742, 342]],
    ['I', 'J'], ['J', 'K'], ['K', 'L', [774, 520]],
    ['A', 'E'], ['E', 'I'],
    ['B', 'F'], ['F', 'J'],
    ['C', 'G'], ['G', 'K', [610, 414]],
    ['D', 'H'], ['H', 'L'],
    ['B', 'G', [500, 190]], ['J', 'G'], ['C', 'H', [790, 200]]
  ];
  const NODE_BASE = { A: 0.3, B: 0.5, C: 0.48, D: 0.5, E: 0.36, F: 0.56, G: 0.6, H: 0.56, I: 0.24, J: 0.5, K: 0.44, L: 0.3 };
  const ALT_ROUTES = {
    G: ['F', 'J', 'K', 'L', 'H'],
    B: ['A', 'E', 'F'],
    J: ['I', 'E', 'F'],
    D: ['C', 'H'],
    E: ['A', 'B', 'F']
  };
  const RIVER = [[-240, 482], [80, 446], [250, 452], [382, 470], [520, 466], [700, 440], [900, 420], [1260, 396]];

  const STOPS = [
    [0.0, [34, 197, 94]], [0.42, [34, 197, 94]], [0.62, [245, 158, 11]],
    [0.8, [249, 115, 22]], [0.92, [239, 68, 68]], [2, [239, 68, 68]]
  ];
  function loadColor(v, a) {
    for (let i = 1; i < STOPS.length; i++) {
      if (v <= STOPS[i][0]) {
        const [p0, c0] = STOPS[i - 1], [p1, c1] = STOPS[i];
        const t = (v - p0) / (p1 - p0 || 1);
        const c = c0.map((x, k) => Math.round(x + (c1[k] - x) * t));
        return `rgba(${c[0]},${c[1]},${c[2]},${a == null ? 1 : a})`;
      }
    }
    return `rgba(239,68,68,${a == null ? 1 : a})`;
  }
  TX.loadColor = loadColor;

  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function sampleEdge(e) {
    const a = NODES[e[0]], b = NODES[e[1]], c = e[2];
    const pts = [];
    const n = 48;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (c) {
        const u = 1 - t;
        pts.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
      } else pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { from: e[0], to: e[1], pts, cum, len: cum[cum.length - 1], cars: [] };
  }

  function pointAt(edge, s) {
    const { pts, cum } = edge;
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] < s) lo = m; else hi = m; }
    const seg = cum[hi] - cum[lo] || 1;
    const t = (s - cum[lo]) / seg;
    const p0 = pts[lo], p1 = pts[hi];
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dl = Math.hypot(dx, dy) || 1;
    return [p0[0] + dx * t, p0[1] + dy * t, dx / dl, dy / dl];
  }

  function smoothRiver() {
    const out = [];
    for (let i = 0; i < RIVER.length - 1; i++) {
      const p0 = RIVER[Math.max(0, i - 1)], p1 = RIVER[i], p2 = RIVER[i + 1], p3 = RIVER[Math.min(RIVER.length - 1, i + 2)];
      for (let t = 0; t < 1; t += 0.1) {
        const t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    out.push(RIVER[RIVER.length - 1]);
    return out;
  }

  function distToPolyline(x, y, pts) {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
      if (d < best) best = d;
    }
    return best;
  }

  class CityMap {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = Object.assign({ interactive: false, labels: true, density: 1, onSelect: null, calmCycle: false }, opts);
      this.edges = EDGES.map(sampleEdge);
      this.river = smoothRiver();
      this.loads = Object.assign({}, NODE_BASE);
      this.locNodes = {};
      this.selected = null;
      this.hover = null;
      this.anomalies = {};
      this.weather = 'clear';
      this.altRoute = null;
      this.calm = 0;
      this.time = 0;
      this.visible = false;
      this.rain = [];
      this.buildBlocks();
      this.resize();
      this.seedCars();

      new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
      new IntersectionObserver((es) => {
        this.visible = es[0].isIntersecting;
        if (this.visible && !this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame((t) => this.frame(t)); }
      }, { rootMargin: '100px' }).observe(canvas);

      if (this.opts.interactive) this.bindPointer();
    }

    buildBlocks() {
      const r = rng(42);
      const cell = 34;
      this.blocks = [];
      this.minor = [];
      const majorPts = this.edges.map((e) => e.pts);
      for (let x = -300; x < VW + 300; x += cell) {
        for (let y = -200; y < VH + 200; y += cell) {
          const cx = x + cell / 2, cy = y + cell / 2;
          if (distToPolyline(cx, cy, this.river) < 30) continue;
          let near = false;
          for (const p of majorPts) { if (distToPolyline(cx, cy, p) < 18) { near = true; break; } }
          if (near) continue;
          if (r() < 0.82) {
            const inset = 4 + r() * 3;
            const split = r();
            if (split < 0.35) {
              const w = (cell - inset * 2) / 2 - 1;
              this.blocks.push([x + inset, y + inset, w, cell - inset * 2, 0.03 + r() * 0.05]);
              this.blocks.push([x + inset + w + 2, y + inset, w, cell - inset * 2, 0.03 + r() * 0.05]);
            } else {
              this.blocks.push([x + inset, y + inset, cell - inset * 2, cell - inset * 2, 0.03 + r() * 0.06]);
            }
          }
        }
      }
    }

    resize() {
      const parent = this.canvas.parentElement;
      const w = parent.clientWidth, h = parent.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = w; this.h = h; this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      const fit = this.opts.cover ? Math.max(w / VW, h / VH) * 1.02 : Math.min(w / (VW + 60), h / (VH + 70));
      this.scale = fit;
      this.ox = (w - VW * fit) / 2;
      this.oy = (h - VH * fit) / 2 + (this.opts.cover ? 0 : 8);
      this.renderStatic();
      if (!this.raf) this.draw();
    }

    toScreen(x, y) { return [this.ox + x * this.scale, this.oy + y * this.scale]; }

    renderStatic() {
      const off = this.static || (this.static = document.createElement('canvas'));
      off.width = this.canvas.width; off.height = this.canvas.height;
      const g = off.getContext('2d');
      const s = this.scale;
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      g.fillStyle = '#071116';
      g.fillRect(0, 0, this.w, this.h);
      g.save();
      g.translate(this.ox, this.oy);
      g.scale(s, s);

      // minor street grid
      g.strokeStyle = 'rgba(244,245,242,0.035)';
      g.lineWidth = 1 / s;
      g.beginPath();
      for (let x = -300; x < VW + 300; x += 34) { g.moveTo(x, -200); g.lineTo(x, VH + 200); }
      for (let y = -200; y < VH + 200; y += 34) { g.moveTo(-300, y); g.lineTo(VW + 300, y); }
      g.stroke();

      // blocks
      for (const b of this.blocks) {
        g.fillStyle = `rgba(160,175,190,${b[4]})`;
        g.fillRect(b[0], b[1], b[2], b[3]);
      }

      // river
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath();
      this.river.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.strokeStyle = 'rgba(59,130,246,0.16)'; g.lineWidth = 40; g.stroke();
      g.strokeStyle = '#0A1E2A'; g.lineWidth = 37; g.stroke();
      g.fillStyle = 'rgba(59,130,246,0.4)';
      g.font = `500 ${9 / Math.max(s, 0.6)}px ${getComputedStyle(document.body).getPropertyValue('--mono') || 'monospace'}`;
      g.fillText('R I V E R   A R D E N', 150, 454);

      // major roads: casing
      for (const e of this.edges) {
        g.beginPath();
        e.pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
        g.strokeStyle = '#15262E'; g.lineWidth = 11; g.stroke();
        g.strokeStyle = '#0E1C22'; g.lineWidth = 8; g.stroke();
      }
      g.restore();

      // frame ticks
      g.strokeStyle = 'rgba(244,245,242,0.12)';
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 0; x < this.w; x += 80) { g.moveTo(x, 0); g.lineTo(x, 5); g.moveTo(x, this.h); g.lineTo(x, this.h - 5); }
      for (let y = 0; y < this.h; y += 80) { g.moveTo(0, y); g.lineTo(5, y); g.moveTo(this.w, y); g.lineTo(this.w - 5, y); }
      g.stroke();
    }

    seedCars() {
      const r = rng(7);
      for (const e of this.edges) {
        e.cars = [];
        const n = this.targetCars(e);
        for (let i = 0; i < n; i++) e.cars.push({ s: r() * e.len, dir: r() < 0.5 ? 1 : -1, j: 0.75 + r() * 0.5 });
      }
    }

    loadAt(e, s) {
      const t = s / e.len;
      const a = this.effLoad(e.from), b = this.effLoad(e.to);
      const k = t * t * (3 - 2 * t);
      return a + (b - a) * k;
    }

    effLoad(node) {
      const v = this.loads[node] != null ? this.loads[node] : 0.4;
      return v + (0.3 - v) * this.calm;
    }

    targetCars(e) {
      const m = (this.effLoad(e.from) + this.effLoad(e.to)) / 2;
      return Math.round((e.len / 1000) * 120 * (0.2 + m) * this.opts.density);
    }

    setData(d) {
      if (d.loads) {
        const locLoads = Object.values(d.loads);
        const mean = locLoads.reduce((a, b) => a + b, 0) / (locLoads.length || 1);
        for (const n in NODES) this.loads[n] = d.loads[n] != null ? d.loads[n] : NODE_BASE[n] * 0.55 + mean * 0.45;
      }
      if (d.info) this.locNodes = d.info;
      if (d.selected !== undefined) this.selected = d.selected;
      if (d.anomalies) this.anomalies = d.anomalies;
      if (d.weather) this.weather = d.weather;
      if (d.altRoute !== undefined) this.altRoute = d.altRoute;
      if (!this.raf) this.draw();
    }

    bindPointer() {
      const c = this.canvas;
      const pick = (ev) => {
        const rect = c.getBoundingClientRect();
        const x = (ev.clientX - rect.left - this.ox) / this.scale;
        const y = (ev.clientY - rect.top - this.oy) / this.scale;
        let best = null, bd = 34 / Math.min(this.scale, 1);
        for (const n in this.locNodes) {
          const p = NODES[n];
          const d = Math.hypot(p[0] - x, p[1] - y);
          if (d < bd) { bd = d; best = n; }
        }
        return best;
      };
      c.addEventListener('pointermove', (ev) => {
        const n = pick(ev);
        if (n !== this.hover) { this.hover = n; c.style.cursor = n ? 'pointer' : 'default'; }
      });
      c.addEventListener('pointerleave', () => { this.hover = null; });
      c.addEventListener('click', (ev) => {
        const n = pick(ev);
        if (n && this.opts.onSelect) this.opts.onSelect(this.locNodes[n].id);
      });
    }

    frame(t) {
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      this.time += dt;
      if (this.opts.calmCycle) {
        // finale: congestion clears over ~9 s, holds, then restarts
        const cyc = this.time % 14;
        this.calm = cyc < 1.2 ? 0 : Math.min(1, (cyc - 1.2) / 8);
        this.calm = this.calm * this.calm * (3 - 2 * this.calm);
      }
      this.update(dt);
      this.draw();
      this.raf = this.visible ? requestAnimationFrame((tt) => this.frame(tt)) : null;
    }

    update(dt) {
      for (const e of this.edges) {
        const target = this.targetCars(e);
        if (e.cars.length < target && Math.random() < 0.3) e.cars.push({ s: Math.random() < 0.5 ? 0 : e.len, dir: Math.random() < 0.5 ? 1 : -1, j: 0.75 + Math.random() * 0.5 });
        if (e.cars.length > target + 2 && Math.random() < 0.3) e.cars.pop();
        for (const car of e.cars) {
          const l = this.loadAt(e, car.s);
          const v = Math.max(3, 62 * Math.pow(Math.max(0.05, 1.12 - l), 1.4)) * car.j;
          car.s += v * dt * car.dir;
          if (car.s > e.len) car.s -= e.len;
          if (car.s < 0) car.s += e.len;
        }
      }
    }

    draw() {
      const ctx = this.ctx, s = this.scale;
      if (!this.static || !s) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.static, 0, 0);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.save();
      ctx.translate(this.ox, this.oy);
      ctx.scale(s, s);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';

      // hotspots under roads
      for (const n in NODES) {
        const l = this.effLoad(n);
        if (l < 0.7) continue;
        const p = NODES[n];
        const k = Math.min(1, (l - 0.7) / 0.25);
        const pulse = 0.85 + 0.15 * Math.sin(this.time * 2.4 + p[0]);
        const rad = (34 + 46 * k) * pulse;
        const grd = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], rad);
        grd.addColorStop(0, loadColor(l, 0.32 * (0.5 + k * 0.5)));
        grd.addColorStop(1, loadColor(l, 0));
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(p[0], p[1], rad, 0, Math.PI * 2); ctx.fill();
      }

      // congestion overlay + flow dashes
      for (const e of this.edges) {
        const a = e.pts[0], b = e.pts[e.pts.length - 1];
        const grad = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
        grad.addColorStop(0, loadColor(this.effLoad(e.from), 0.85));
        grad.addColorStop(1, loadColor(this.effLoad(e.to), 0.85));
        ctx.beginPath();
        e.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2.2;
        ctx.stroke();
      }

      // vehicles
      ctx.fillStyle = 'rgba(245,236,220,0.9)';
      const sz = Math.max(1.6, 2.2 / Math.max(s, 0.7));
      for (const e of this.edges) {
        for (const car of e.cars) {
          const [x, y, dx, dy] = pointAt(e, car.s);
          const off = 3.2 * car.dir;
          ctx.fillRect(x - dy * off - sz / 2, y + dx * off - sz / 2, sz, sz);
        }
      }

      // alternate route
      if (this.altRoute && this.altRoute.length > 1) {
        ctx.beginPath();
        this.altRoute.forEach((n, i) => { const p = NODES[n]; i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
        ctx.setLineDash([6, 8]);
        ctx.lineDashOffset = -this.time * 26;
        ctx.strokeStyle = 'rgba(59,130,246,0.95)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // intersections
      for (const n in NODES) {
        if (this.locNodes[n]) continue;
        const p = NODES[n];
        ctx.fillStyle = '#22363F';
        ctx.fillRect(p[0] - 3, p[1] - 3, 6, 6);
      }
      ctx.restore();

      // location markers + labels (screen space, crisp text)
      if (this.opts.labels) this.drawMarkers();
      this.drawWeather();
    }

    drawMarkers() {
      const ctx = this.ctx;
      const mono = '"JetBrains Mono", ui-monospace, monospace';
      const small = this.w < 560;
      for (const n in this.locNodes) {
        const info = this.locNodes[n];
        const [x, y] = this.toScreen(NODES[n][0], NODES[n][1]);
        const sel = this.selected === info.id;
        const hov = this.hover === n;
        const col = loadColor(info.pressure, 1);

        // marker
        ctx.fillStyle = '#071116';
        ctx.fillRect(x - 6, y - 6, 12, 12);
        ctx.strokeStyle = col; ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 5.5, y - 5.5, 11, 11);
        ctx.fillStyle = col;
        ctx.fillRect(x - 2.5, y - 2.5, 5, 5);

        if (sel || hov) {
          const r = sel ? 16 + Math.sin(this.time * 3) * 1.5 : 14;
          ctx.strokeStyle = sel ? '#F59E0B' : 'rgba(244,245,242,0.6)';
          ctx.lineWidth = 1.5;
          const L = 5;
          ctx.beginPath();
          [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => {
            ctx.moveTo(x + sx * r, y + sy * (r - L)); ctx.lineTo(x + sx * r, y + sy * r); ctx.lineTo(x + sx * (r - L), y + sy * r);
          });
          ctx.stroke();
        }

        // signal head: green / amber / red cycle, offset per junction
        const ph = (this.time + NODES[n][0] * 0.03) % 24;
        const lamp = ph < 12 ? 2 : ph < 15 ? 1 : 0;
        const sx = x + (NODES[n][0] > 760 ? 12 : -16), sy = y - 18;
        ctx.fillStyle = 'rgba(7,17,22,0.95)';
        ctx.fillRect(sx - 1, sy - 1, 6, 16);
        ['#EF4444', '#F59E0B', '#22C55E'].forEach((c, k) => {
          ctx.globalAlpha = k === lamp ? 1 : 0.18;
          ctx.fillStyle = c;
          ctx.beginPath(); ctx.arc(sx + 2, sy + 2 + k * 5, 1.8, 0, Math.PI * 2); ctx.fill();
        });
        ctx.globalAlpha = 1;

        if (this.anomalies[n]) {
          const r = 24 + (this.time * 18) % 22;
          ctx.strokeStyle = `rgba(239,68,68,${1 - ((this.time * 18) % 22) / 22})`;
          ctx.lineWidth = 1;
          ctx.strokeRect(x - r, y - r, r * 2, r * 2);
        }

        if (small && !sel) continue;
        const right = NODES[n][0] > 760;
        const tx = right ? x - 22 : x + 22;
        ctx.textAlign = right ? 'right' : 'left';
        ctx.font = `${sel ? 500 : 400} 12px ${mono}`;
        const bw = Math.max(ctx.measureText(info.name).width, 118) + 16;
        ctx.fillStyle = sel ? 'rgba(7,17,22,0.92)' : 'rgba(7,17,22,0.8)';
        ctx.fillRect(right ? tx - bw + 8 : tx - 8, y - 27, bw, 47);
        if (sel) { ctx.fillStyle = '#F59E0B'; ctx.fillRect(right ? tx + 7 : tx - 8, y - 27, 1.5, 47); }
        ctx.font = `500 10px ${mono}`;
        ctx.fillStyle = 'rgba(244,245,242,0.42)';
        ctx.fillText(info.code, tx, y - 14);
        ctx.font = `${sel ? 500 : 400} 12px ${mono}`;
        ctx.fillStyle = sel ? '#F4F5F2' : 'rgba(244,245,242,0.78)';
        ctx.fillText(info.name, tx, y);
        ctx.font = `400 11px ${mono}`;
        ctx.fillStyle = col;
        ctx.fillText(`${info.vehicles} veh · ${Math.round(info.pressure * 100)}%`, tx, y + 14);
      }
      ctx.textAlign = 'left';
    }

    drawWeather() {
      const w = this.weather;
      if (w === 'clear') return;
      const ctx = this.ctx;
      if (w === 'fog') {
        const g = ctx.createLinearGradient(0, 0, 0, this.h);
        g.addColorStop(0, 'rgba(170,180,190,0.16)');
        g.addColorStop(1, 'rgba(170,180,190,0.06)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, this.w, this.h);
        return;
      }
      const n = w === 'heavy' ? 220 : 90;
      if (this.rain.length !== n) {
        this.rain = Array.from({ length: n }, () => [Math.random() * this.w, Math.random() * this.h, 0.6 + Math.random() * 0.6]);
      }
      ctx.strokeStyle = w === 'heavy' ? 'rgba(170,200,225,0.28)' : 'rgba(170,200,225,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const sp = w === 'heavy' ? 900 : 600;
      for (const d of this.rain) {
        d[1] += sp * d[2] * 0.016; d[0] -= 120 * d[2] * 0.016;
        if (d[1] > this.h) { d[1] = -10; d[0] = Math.random() * (this.w + 100); }
        ctx.moveTo(d[0], d[1]); ctx.lineTo(d[0] + 3, d[1] - 12 * d[2]);
      }
      ctx.stroke();
    }
  }

  CityMap.NODES = NODES;
  CityMap.ALT_ROUTES = ALT_ROUTES;
  TX.CityMap = CityMap;
})();
