/* TRAFFIC-X page controller: one state object, one model, every section derived from it. */
(function () {
  const TX = window.TX;
  const M = TX.model;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const byId = Object.fromEntries(M.LOCATIONS.map((l) => [l.id, l]));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SVGNS = 'http://www.w3.org/2000/svg';

  // ---------------------------------------------------------------- state
  const START_HOUR = 17.7; // 17:42
  const START_BIAS = { central: 1.178, northgate: 1.04, bridge: 1.22, techpark: 1.1, market: 0.96 };
  const state = {
    hour: START_HOUR,
    weather: 'clear',
    selected: 'central',
    live: false,
    available: { vehicles: true, weather: true, time: true, history: true },
    bias: Object.assign({}, START_BIAS),
    vehicles: {},
    applied: {}
  };
  function resetVehicles() {
    state.hour = START_HOUR;
    state.bias = Object.assign({}, START_BIAS);
    state.applied = {};
    for (const l of M.LOCATIONS) state.vehicles[l.id] = Math.round(M.historical(l, state.hour) * state.bias[l.id]);
    state.vehicles.central = 742;
  }
  resetVehicles();

  let preds = {};
  function computeAll() {
    for (const l of M.LOCATIONS) {
      preds[l.id] = M.predict({ loc: l, vehicles: state.vehicles[l.id], hour: state.hour, weather: state.weather, available: state.available });
    }
    return preds[state.selected];
  }

  // ---------------------------------------------------------------- helpers
  function bind(name, text) { $$(`[data-bind="${name}"]`).forEach((el) => { if (el.textContent !== String(text)) el.textContent = text; }); }
  function bindAttr(sel, attr, val) { $$(sel).forEach((el) => el.setAttribute(attr, val)); }

  // Animated numbers. Elements count up from 0 the first time they scroll into view.
  function setNum(key, value, dec) {
    $$(`[data-num="${key}"]`).forEach((el) => {
      el._target = value; el._dec = dec || 0;
      if (el._armed) tweenNum(el, value, dec);
    });
  }
  function tweenNum(el, to, dec, dur) {
    const from = el._v == null ? 0 : el._v;
    el._v = to;
    cancelAnimationFrame(el._raf);
    if (reduced) { el.textContent = to.toFixed(dec || 0); return; }
    const d = dur || (Math.abs(to - from) > 30 ? 1100 : 600);
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / d);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = (from + (to - from) * e).toFixed(dec || 0);
      if (k < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }
  function armNums(root) {
    $$('[data-num]', root).forEach((el) => {
      if (el._armed) return;
      el._armed = true;
      if (el._target != null) tweenNum(el, el._target, el._dec, 1400);
    });
  }

  const pct = (p) => Math.round(p * 100);
  const levelKey = (p) => M.level(p).key;
  const fmtSigned = (v) => (v >= 0 ? '+' : '') + v + '%';
  const clockAt = (min) => M.formatHour(state.hour + min / 60);

  // ---------------------------------------------------------------- location list
  const locList = $('#locList');
  M.LOCATIONS.forEach((l) => {
    const b = document.createElement('button');
    b.className = 'loc-item';
    b.setAttribute('role', 'option');
    b.dataset.id = l.id;
    b.innerHTML = `<span class="li-code">${l.code}</span><span class="li-name">${l.name}</span><span class="li-meter"><span class="li-bar"><i></i></span><span class="li-pct">0%</span></span>`;
    b.addEventListener('click', () => select(l.id));
    locList.appendChild(b);
  });
  function renderLocList() {
    $$('.loc-item', locList).forEach((b) => {
      const p = preds[b.dataset.id].now.pressure;
      b.setAttribute('aria-selected', b.dataset.id === state.selected);
      b.dataset.level = levelKey(p);
      b.querySelector('.li-bar i').style.setProperty('--p', Math.min(1, p).toFixed(3));
      b.querySelector('.li-pct').textContent = pct(p) + '%';
    });
  }

  function select(id) {
    if (state.selected === id) return;
    state.selected = id;
    renderAll();
  }

  // ---------------------------------------------------------------- maps
  const cityMap = new TX.CityMap($('#cityMap'), { interactive: true, labels: true, onSelect: select });
  const finaleMap = new TX.CityMap($('#finaleMap'), { interactive: false, labels: false, cover: true, calmCycle: true, density: 0.9 });

  function mapPayload() {
    const loads = {}, info = {}, anomalies = {};
    for (const l of M.LOCATIONS) {
      const p = preds[l.id];
      loads[l.node] = p.now.pressure;
      info[l.node] = { id: l.id, code: l.code, name: l.name, vehicles: p.observed, pressure: p.now.pressure };
      if (p.anomaly) anomalies[l.node] = true;
    }
    return { loads, info, anomalies };
  }

  // ---------------------------------------------------------------- hero
  let hero = null;
  (function initHero() {
    const canvas = $('#heroCanvas');
    try { hero = TX.Hero3D.create(canvas, $('#heroLabels')); } catch (e) { hero = null; }
    if (!hero) {
      const c2 = document.createElement('canvas');
      canvas.replaceWith(c2);
      c2.id = 'heroCanvas';
      const fallback = new TX.CityMap(c2, { labels: false, cover: true, density: 1.2 });
      hero = {
        setLoads(m) {
          const loads = {};
          for (const id in m) loads[byId[id].node] = m[id];
          fallback.setData({ loads });
        },
        setLabels() {}
      };
    }
  })();

  // ---------------------------------------------------------------- gauge
  const gauge = $('#gauge');
  const TICKS = 64;
  const gTicks = [];
  (function buildGauge() {
    const cx = 200, cy = 200;
    const a0 = (135 * Math.PI) / 180, span = (270 * Math.PI) / 180;
    for (let i = 0; i < TICKS; i++) {
      const a = a0 + (span * i) / (TICKS - 1);
      const major = i % 8 === 0;
      const r1 = major ? 146 : 154, r2 = 172;
      const ln = document.createElementNS(SVGNS, 'line');
      ln.setAttribute('x1', cx + Math.cos(a) * r1); ln.setAttribute('y1', cy + Math.sin(a) * r1);
      ln.setAttribute('x2', cx + Math.cos(a) * r2); ln.setAttribute('y2', cy + Math.sin(a) * r2);
      ln.setAttribute('stroke-width', major ? 2.5 : 2);
      ln.setAttribute('stroke', 'rgba(244,245,242,0.1)');
      gauge.appendChild(ln);
      gTicks.push({ el: ln, v: i / (TICKS - 1) });
    }
    // inner arc + threshold marks
    const arc = (r, f0, f1) => {
      const s = a0 + span * f0, e = a0 + span * f1;
      const large = e - s > Math.PI ? 1 : 0;
      return `M ${cx + Math.cos(s) * r} ${cy + Math.sin(s) * r} A ${r} ${r} 0 ${large} 1 ${cx + Math.cos(e) * r} ${cy + Math.sin(e) * r}`;
    };
    const base = document.createElementNS(SVGNS, 'path');
    base.setAttribute('d', arc(132, 0, 1));
    base.setAttribute('fill', 'none'); base.setAttribute('stroke', 'rgba(244,245,242,0.08)'); base.setAttribute('stroke-width', 1);
    gauge.appendChild(base);
    [[0.72, 'HEAVY', '#F59E0B'], [0.87, 'SEVERE', '#EF4444']].forEach(([f, label, col]) => {
      const a = a0 + span * f;
      const ln = document.createElementNS(SVGNS, 'line');
      ln.setAttribute('x1', cx + Math.cos(a) * 126); ln.setAttribute('y1', cy + Math.sin(a) * 126);
      ln.setAttribute('x2', cx + Math.cos(a) * 180); ln.setAttribute('y2', cy + Math.sin(a) * 180);
      ln.setAttribute('stroke', col); ln.setAttribute('stroke-width', 1);
      gauge.appendChild(ln);
      const tx = document.createElementNS(SVGNS, 'text');
      tx.setAttribute('x', cx + Math.cos(a) * 194); tx.setAttribute('y', cy + Math.sin(a) * 194);
      tx.setAttribute('fill', col); tx.setAttribute('font-size', 10); tx.setAttribute('font-family', 'JetBrains Mono, monospace');
      tx.setAttribute('text-anchor', 'start'); tx.setAttribute('letter-spacing', '1.5');
      tx.textContent = label;
      gauge.appendChild(tx);
    });
    const needle = document.createElementNS(SVGNS, 'path');
    needle.setAttribute('d', 'M 0 -5 L 10 0 L 0 5 Z');
    needle.setAttribute('fill', '#F4F5F2');
    needle.id = 'gNeedle';
    gauge.appendChild(needle);
    gauge._needle = needle; gauge._a0 = a0; gauge._span = span;
  })();
  let gaugeShown = 0, gaugeTarget = 0, gaugeArmed = false, gaugeRaf = null;
  function setGauge(p) {
    gaugeTarget = Math.min(1, p);
    if (gaugeArmed) animateGauge();
  }
  function animateGauge() {
    cancelAnimationFrame(gaugeRaf);
    const from = gaugeShown, to = gaugeTarget, t0 = performance.now();
    const dur = reduced ? 1 : Math.abs(to - from) > 0.3 ? 1600 : 700;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      gaugeShown = from + (to - from) * e;
      drawGauge(gaugeShown);
      if (k < 1) gaugeRaf = requestAnimationFrame(step);
    };
    gaugeRaf = requestAnimationFrame(step);
  }
  function drawGauge(v) {
    for (const t of gTicks) {
      t.el.setAttribute('stroke', t.v <= v + 0.0001 ? TX.loadColor(Math.max(0.3, t.v), 1) : 'rgba(244,245,242,0.1)');
    }
    const a = gauge._a0 + gauge._span * v;
    const r = 112;
    gauge._needle.setAttribute('transform', `translate(${200 + Math.cos(a) * r} ${200 + Math.sin(a) * r}) rotate(${(a * 180) / Math.PI + 180})`);
  }
  drawGauge(0);

  // ---------------------------------------------------------------- forecast timeline
  const tl = $('#timeline');
  const tlChart = $('#tlChart');
  const tlCols = $('#tlCols');
  const TL_X = [10, 310, 610, 910];
  const yOf = (p) => 290 - ((Math.min(1.08, Math.max(0.3, p)) - 0.3) / 0.78) * 275;
  tlChart.innerHTML = `
    <defs>
      <clipPath id="tlClip"><rect id="tlClipRect" x="0" y="-20" width="0" height="340"></rect></clipPath>
      <linearGradient id="tlStroke" x1="0" y1="0" x2="0" y2="300" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#EF4444"/><stop offset="${(yOf(0.87) / 300).toFixed(3)}" stop-color="#EF4444"/>
        <stop offset="${(yOf(0.8) / 300).toFixed(3)}" stop-color="#F59E0B"/><stop offset="${(yOf(0.62) / 300).toFixed(3)}" stop-color="#FACC15"/>
        <stop offset="${(yOf(0.42) / 300).toFixed(3)}" stop-color="#22C55E"/><stop offset="1" stop-color="#22C55E"/>
      </linearGradient>
    </defs>
    <line class="thr-line" x1="0" x2="1200" y1="${yOf(0.72)}" y2="${yOf(0.72)}" stroke="rgba(245,158,11,0.5)"/>
    <line class="thr-line" x1="0" x2="1200" y1="${yOf(0.87)}" y2="${yOf(0.87)}" stroke="rgba(239,68,68,0.55)"/>
    ${TL_X.map((x) => `<line class="grid-line" x1="${x}" x2="${x}" y1="0" y2="300"/>`).join('')}
    <g clip-path="url(#tlClip)">
      <path class="band" id="tlBand" fill="rgba(244,245,242,0.06)"/>
      <path class="hist-curve" id="tlHist"/>
      <path class="curve" id="tlCurve" stroke="url(#tlStroke)"/>
    </g>`;
  const tlOverlay = document.createElement('div');
  tlOverlay.className = 'tl-labels';
  tlOverlay.innerHTML = `
    <span class="tl-thr" style="top:${(yOf(0.87) / 3).toFixed(2)}%;color:var(--c-severe)">Severe 87%</span>
    <span class="tl-thr" style="top:${(yOf(0.72) / 3).toFixed(2)}%;color:var(--c-heavy)">Heavy 72%</span>
    <span class="tl-hist-label" id="tlHistLabel">Usual for this time</span>
    ${TL_X.map((_, i) => `<span class="tl-dot" data-i="${i}" style="opacity:0"></span>`).join('')}`;
  tl.insertBefore(tlOverlay, tlCols);
  tlOverlay.style.height = '260px';
  // keep overlay aligned with the chart height
  const syncOverlay = () => { tlOverlay.style.height = tlChart.getBoundingClientRect().height + 'px'; };
  new ResizeObserver(syncOverlay).observe(tlChart);

  tlCols.innerHTML = M.HORIZONS.map((m) => `
    <div class="tl-col" data-level="heavy">
      <div class="tl-when"><b>${m === 0 ? 'Now' : '+' + m + ' min'}</b><span class="tl-clock"></span></div>
      <div class="tl-level">—</div>
      <div class="tl-pct"><span class="tl-pv">0</span>%<small>pressure</small></div>
      <div class="tl-trend" data-trend="flat"><span class="tl-arrow"></span><span class="tl-tl">Stable</span></div>
      <div class="tl-conf"><span class="tl-conf-bar"><i></i></span><span class="tl-cv">0%</span> confidence</div>
    </div>`).join('');

  function smoothPath(pts) {
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p2[0]} ${p2[1]}`;
    }
    return d;
  }

  let tlShown = false;
  function renderTimeline(P) {
    const pts = P.steps.map((s, i) => [TL_X[i], yOf(s.pressure)]);
    const ext = [...pts, [1190, yOf(P.steps[3].pressure + (P.steps[3].pressure - P.steps[2].pressure) * 0.5)]];
    $('#tlCurve').setAttribute('d', smoothPath(ext));
    const up = P.steps.map((s, i) => [TL_X[i], yOf(s.pressure + (1 - s.confidence) * 0.9)]);
    const dn = P.steps.map((s, i) => [TL_X[i], yOf(s.pressure - (1 - s.confidence) * 0.9)]).reverse();
    $('#tlBand').setAttribute('d', smoothPath(up) + ' L ' + smoothPath(dn).slice(2) + ' Z');
    const hist = M.HORIZONS.map((m, i) => [TL_X[i], yOf(M.historical(P.loc, P.hour + m / 60) / P.effCap)]);
    $('#tlHist').setAttribute('d', P.available.history && P.available.time ? smoothPath(hist) : '');
    const hl = $('#tlHistLabel');
    hl.style.display = P.available.history && P.available.time ? '' : 'none';
    hl.style.left = '31%';
    hl.style.top = `calc(${(hist[1][1] / 3).toFixed(2)}% + 8px)`;

    $$('.tl-dot', tlOverlay).forEach((d, i) => {
      d.style.left = (TL_X[i] / 12).toFixed(2) + '%';
      d.style.top = (pts[i][1] / 3).toFixed(2) + '%';
      d.dataset.level = P.steps[i].level.key;
    });
    $$('.tl-col', tlCols).forEach((col, i) => {
      const s = P.steps[i];
      col.dataset.level = s.level.key;
      col.querySelector('.tl-clock').textContent = clockAt(s.minutes);
      col.querySelector('.tl-level').textContent = s.level.label;
      const pv = col.querySelector('.tl-pv');
      if (tlShown) tweenNum(pv, pct(s.pressure)); else { pv._v = 0; pv._pending = pct(s.pressure); }
      const tr = col.querySelector('.tl-trend');
      tr.dataset.trend = s.trend.key;
      col.querySelector('.tl-tl').textContent = i === 0 ? `${s.trend.label} next 15 min` : s.trend.label;
      col.querySelector('.tl-conf-bar i').style.setProperty('--c', tlShown ? s.confidence.toFixed(3) : 0);
      col.querySelector('.tl-cv').textContent = pct(s.confidence) + '%';
    });
  }
  function revealTimeline() {
    if (tlShown) return;
    tlShown = true;
    tl.classList.add('in');
    const rect = $('#tlClipRect');
    const t0 = performance.now(), dur = reduced ? 1 : 1600;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      rect.setAttribute('width', 1200 * e);
      $$('.tl-dot', tlOverlay).forEach((d, i) => { if (1200 * e >= TL_X[i] - 4) d.style.opacity = 1; });
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    $$('.tl-col', tlCols).forEach((col, i) => {
      setTimeout(() => {
        const pv = col.querySelector('.tl-pv');
        tweenNum(pv, pct(preds[state.selected].steps[i].pressure), 0, 900);
        col.querySelector('.tl-conf-bar i').style.setProperty('--c', preds[state.selected].steps[i].confidence.toFixed(3));
      }, reduced ? 0 : 200 + i * 350);
    });
  }

  // ---------------------------------------------------------------- factors
  const factorsEl = $('#factors');
  let factorsShown = false;
  const factorRows = {};
  function renderFactors(P) {
    P.factors.forEach((f, rank) => {
      let row = factorRows[f.key];
      if (!row) {
        row = document.createElement('div');
        row.className = 'factor';
        row.innerHTML = `<span class="fa-name"></span><span class="fa-val"><span class="fa-n">0</span>%</span><span class="fa-impact"></span><span></span><span class="fa-track"><i></i></span>`;
        factorRows[f.key] = row;
      }
      factorsEl.appendChild(row); // re-append keeps rank order
      row.dataset.rank = rank;
      row.dataset.zero = f.value === 0;
      row.querySelector('.fa-name').textContent = f.label;
      row.querySelector('.fa-impact').textContent = f.impact === 'No data' ? 'Input offline' : `${f.impact} impact`;
      const n = row.querySelector('.fa-n');
      if (factorsShown) tweenNum(n, Math.round(f.value)); else n._pending = Math.round(f.value);
      row.querySelector('.fa-track i').style.transform = `scaleX(${factorsShown ? f.value / 100 : 0})`;
      row._value = f.value;
    });
  }
  function revealFactors() {
    if (factorsShown) return;
    factorsShown = true;
    $$('.factor', factorsEl).forEach((row, i) => {
      setTimeout(() => {
        row.querySelector('.fa-track i').style.transform = `scaleX(${row._value / 100})`;
        const n = row.querySelector('.fa-n');
        tweenNum(n, Math.round(row._value), 0, 1100);
      }, reduced ? 0 : i * 160);
    });
  }

  // ---------------------------------------------------------------- weather
  const wxLanes = new TX.LaneStrip($('#wxLanes'), { label: 'Segment EB-01 · 400 m' });
  $$('#wxSeg button').forEach((b) => b.addEventListener('click', () => { state.weather = b.dataset.wx; renderAll(); }));

  function renderWeather(P) {
    $$('#wxSeg button').forEach((b) => b.setAttribute('aria-checked', b.dataset.wx === state.weather));
    const clear = M.predict({ loc: P.loc, vehicles: state.vehicles[state.selected], hour: state.hour, weather: 'clear', available: state.available });
    bind('wxCap', P.effCap);
    bind('wxP30', pct(P.steps[2].pressure) + '%');
    bind('wxLevel', P.steps[2].level.label);
    bindAttr('[data-bind="wxLevel"]', 'data-level', P.steps[2].level.key);
    const diff = pct(P.steps[2].pressure) - pct(clear.steps[2].pressure);
    const note = state.weather === 'clear'
      ? `${P.weather.note}. Capacity is unchanged.`
      : `${P.weather.note}. Capacity drops ${Math.round((1 - P.weather.cap) * 100)}%, adding ${diff} points of pressure at +30 min${clear.steps[2].level.key !== P.steps[2].level.key ? ` and moving the forecast from ${clear.steps[2].level.label} to ${P.steps[2].level.label}` : ''}.`;
    bind('wxNote', note);
    wxLanes.set({ pressure: P.now.pressure, weather: state.weather, label: `${P.loc.code} · ${P.loc.corridor}` });
  }

  // ---------------------------------------------------------------- anomaly
  const anomLoc = byId.bridge;
  const ANOM_HOUR = 2 + 40 / 60;
  const anomPred = M.predict({ loc: anomLoc, vehicles: 640, hour: ANOM_HOUR, weather: 'clear' });
  (function buildAnomaly() {
    bind('anomHist', anomPred.histNow);
    bind('anomObs', anomPred.observed);
    bind('anomRatio', (anomPred.observed / anomPred.histNow).toFixed(1) + '×');
    $('.anom-axis').innerHTML = ['18:00', '21:00', '00:00', '03:00', '06:00'].map((t) => `<span>${t}</span>`).join('');
    const svg = $('#anomChart');
    const X = (h) => ((h - 18) / 12) * 1000;
    const Y = (v) => 210 - (v / 700) * 200;
    const hist = [], up = [], dn = [], obs = [];
    for (let h = 18; h <= 30.001; h += 0.25) {
      const v = M.historical(anomLoc, h);
      hist.push([X(h), Y(v)]); up.push([X(h), Y(v * 1.22 + 15)]); dn.push([X(h), Y(Math.max(0, v * 0.78 - 15))]);
    }
    const nowH = 24 + ANOM_HOUR;
    for (let h = 18; h <= nowH + 0.001; h += 1 / 12) {
      let v = M.historical(anomLoc, h) * (1 + 0.06 * Math.sin(h * 5.3) + 0.03 * Math.sin(h * 13.1));
      const k = (h - 26.05) / (nowH - 26.05);
      if (k > 0) v = v + (anomPred.observed - v) * Math.pow(Math.min(1, k), 1.6);
      obs.push([X(h), Y(v)]);
    }
    const toD = (p) => 'M ' + p.map((q) => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' L ');
    const split = obs.findIndex((q) => q[0] >= X(26.05));
    svg.innerHTML = `
      <defs><clipPath id="anClip"><rect id="anClipRect" x="0" y="-20" width="0" height="260"/></clipPath></defs>
      <path class="band" d="${toD(up)} L ${dn.slice().reverse().map((q) => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' L ')} Z"/>
      <path class="hist" d="${toD(hist)}"/>
      <g clip-path="url(#anClip)">
        <path class="obs" d="${toD(obs.slice(0, split + 1))}"/>
        <path class="spike" d="${toD(obs.slice(split))}"/>
      </g>
      <line class="now-line" x1="${X(nowH)}" x2="${X(nowH)}" y1="0" y2="215"/>
      <text x="${X(nowH) + 8}" y="16" fill="#EF4444" font-family="JetBrains Mono, monospace" font-size="11">02:40 NOW</text>
      <text x="8" y="${Y(M.historical(anomLoc, 18.4)) - 10}" fill="rgba(59,130,246,0.85)" font-family="JetBrains Mono, monospace" font-size="11">Historical range</text>`;
    svg._nowX = X(nowH);
  })();
  const anomBoard = $('#anomBoard');
  function playAnomaly() {
    anomBoard.classList.remove('detected');
    const rect = $('#anClipRect');
    rect.setAttribute('width', 0);
    void anomBoard.offsetWidth;
    anomBoard.classList.add('detected');
    const target = $('#anomChart')._nowX + 2;
    const t0 = performance.now(), dur = reduced ? 1 : 1600;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      rect.setAttribute('width', target * (1 - Math.pow(1 - k, 2)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  $('#anomReplay').addEventListener('click', playAnomaly);

  // ---------------------------------------------------------------- response
  const BASE_GREEN = 42;
  const APPLY_LABEL = { signal: 'Apply to signal plan', route: 'Publish route advisory', incident: 'Dispatch patrol unit', monitor: 'Acknowledge', none: 'Acknowledge' };
  let lastActionTitle = '';
  function renderResponse(P) {
    const a = P.action;
    bind('respLoc', `${P.loc.code} ${P.loc.name}`);
    const titleEl = $('[data-bind="actionTitle"]');
    if (a.title !== lastActionTitle) {
      if (lastActionTitle && !reduced) {
        titleEl.classList.add('swap');
        setTimeout(() => { titleEl.textContent = a.title; titleEl.classList.remove('swap'); }, 260);
      } else titleEl.textContent = a.title;
      lastActionTitle = a.title;
    }
    bind('actionPriority', a.priority);
    bindAttr('.resp-meta .prio', 'data-prio', a.priority.toLowerCase());
    bind('actionDetail', a.detail);
    bind('actionReason', a.reason);
    const green = a.kind === 'signal' ? BASE_GREEN + a.extra : BASE_GREEN;
    const applied = state.applied[state.selected];
    bind('spCurrent', `${applied ? applied.green : BASE_GREEN} s green`);
    bind('spNew', a.kind === 'signal' ? `${green} s green` : 'No change');
    $('.sp-row:not(.sp-new) .sp-green').style.setProperty('--g', applied ? applied.green : BASE_GREEN);
    $('.sp-new .sp-green').style.setProperty('--g', green);
    $$('#optionList li').forEach((li) => li.classList.toggle('chosen', li.dataset.kind === a.kind || (a.kind === 'none' && li.dataset.kind === 'monitor')));
    const btn = $('#applyBtn');
    btn.textContent = applied ? 'Applied' : APPLY_LABEL[a.kind];
    btn.disabled = !!applied;
    $('#applyNote').textContent = applied ? applied.note : '';
  }
  $('#applyBtn').addEventListener('click', () => {
    const P = preds[state.selected];
    const a = P.action;
    const id = state.selected;
    const before = P.steps[2].pressure;
    let note;
    if (a.kind === 'signal' || a.kind === 'route') {
      const k = a.kind === 'signal' ? 0.88 : 0.92;
      state.bias[id] *= k;
      state.vehicles[id] = Math.round(state.vehicles[id] * k);
      const after = M.predict({ loc: P.loc, vehicles: state.vehicles[id], hour: state.hour, weather: state.weather, available: state.available }).steps[2].pressure;
      note = `Applied at ${M.formatHour(state.hour)}. Simulated +30 min pressure: ${pct(before)}% → ${pct(after)}%.`;
    } else {
      note = `Logged at ${M.formatHour(state.hour)}. Operator notified.`;
    }
    state.applied[id] = { green: a.kind === 'signal' ? BASE_GREEN + a.extra : BASE_GREEN, note };
    renderAll();
  });

  // ---------------------------------------------------------------- simulator
  const sim = { vehicles: 742, weather: 'clear', hour: START_HOUR };
  const simLanes = new TX.LaneStrip($('#simLanes'), { label: 'Scenario' });
  const simV = $('#simVehicles'), simT = $('#simTime');
  function syncSim() {
    sim.vehicles = state.vehicles[state.selected];
    sim.weather = state.weather === 'fog' ? 'clear' : state.weather;
    sim.hour = ((state.hour % 24) + 24) % 24;
    simV.value = sim.vehicles; simT.value = Math.round(sim.hour * 4) % 96;
    renderSim();
  }
  simV.addEventListener('input', () => { sim.vehicles = +simV.value; renderSim(); });
  simT.addEventListener('input', () => { sim.hour = +simT.value / 4; renderSim(); });
  $$('#simRain button').forEach((b) => b.addEventListener('click', () => { sim.weather = b.dataset.wx; renderSim(); }));
  $('#simSync').addEventListener('click', syncSim);
  let lastSimLevel = '';
  function renderSim() {
    const loc = byId[state.selected];
    const hour = sim.hour;
    const P = M.predict({ loc, vehicles: sim.vehicles, hour, weather: sim.weather });
    $('#simVehiclesOut').textContent = sim.vehicles;
    $('#simTimeOut').textContent = M.formatHour(hour, { ampm: true });
    simV.style.setProperty('--fill', ((sim.vehicles - simV.min) / (simV.max - simV.min)) * 100 + '%');
    simT.style.setProperty('--fill', (Math.min(95, sim.hour * 4) / 95) * 100 + '%');
    $$('#simRain button').forEach((b) => b.setAttribute('aria-checked', b.dataset.wx === sim.weather));
    bind('simContext', `Scenario for ${loc.code} ${loc.name}. Change the inputs and the forecast updates instantly.`);

    const s30 = P.steps[2];
    const lvEl = $('[data-bind="simLevel"]');
    bind('simLevel', s30.level.label);
    lvEl.dataset.level = s30.level.key;
    if (lastSimLevel && lastSimLevel !== s30.level.key && !reduced) { lvEl.classList.remove('bump'); void lvEl.offsetWidth; lvEl.classList.add('bump'); }
    lastSimLevel = s30.level.key;
    bind('simPct', pct(s30.pressure) + '%');
    bind('simConf', pct(s30.confidence) + '%');

    // trend sparkline
    const sx = [12, 100, 188, 288];
    const sy = (p) => 70 - (Math.min(1.1, Math.max(0.1, p)) - 0.1) * 60;
    const spark = $('#simSpark');
    const pts = P.steps.map((s, i) => [sx[i], sy(s.pressure)]);
    spark.innerHTML = `
      <line x1="0" x2="300" y1="${sy(0.87)}" y2="${sy(0.87)}" stroke="rgba(239,68,68,0.4)" stroke-dasharray="2 4"/>
      <path d="${smoothPath(pts)}" fill="none" stroke="#F4F5F2" stroke-width="1.5"/>
      ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${TX.loadColor(P.steps[i].pressure)}"/>
        <text x="${p[0]}" y="${p[1] - 9}" text-anchor="middle" fill="rgba(244,245,242,0.7)" font-size="10" font-family="JetBrains Mono, monospace">${pct(P.steps[i].pressure)}</text>
        <text x="${p[0]}" y="80" text-anchor="middle" fill="rgba(244,245,242,0.38)" font-size="9" font-family="JetBrains Mono, monospace">${i ? '+' + P.steps[i].minutes : 'NOW'}</text>`).join('')}`;
    bind('simTrend', trendSentence(P, hour));
    bind('simAction', P.action.title);
    const pr = $('#simPrio');
    pr.dataset.prio = P.action.priority.toLowerCase();
    pr.innerHTML = `Priority <strong>${P.action.priority}</strong>`;
    simLanes.set({ pressure: P.now.pressure, weather: sim.weather, label: `Scenario · ${loc.code} · ${M.formatHour(hour)}` });
  }
  function trendSentence(P, hour) {
    const s = P.steps;
    const peakI = s.indexOf(P.peak);
    const at = (m) => M.formatHour(hour + m / 60);
    if (peakI === 0) return s[3].pressure < s[0].pressure - 0.03 ? `Easing through the next hour, down to ${pct(s[3].pressure)}% by ${at(60)}` : 'Stable through the next hour';
    if (peakI === 3) return `Rising through the next hour, reaching ${pct(s[3].pressure)}% by ${at(60)}`;
    return `Rising to ${pct(P.peak.pressure)}% by ${at(P.peak.minutes)}, then easing`;
  }

  // ---------------------------------------------------------------- reliability
  $$('#inputList button').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.input;
    state.available[k] = !state.available[k];
    renderAll();
  }));
  function renderReliability(P) {
    const c = pct(P.steps[2].confidence);
    setNum('confidence', c);
    const big = $('.rel-big');
    big.classList.toggle('low', c < 60);
    big.classList.toggle('mid', c >= 60 && c < 80);
    bind('quality', P.quality);
    $$('#inputList button').forEach((b) => b.setAttribute('aria-pressed', state.available[b.dataset.input]));
  }

  // ---------------------------------------------------------------- main render
  function renderAll() {
    const P = computeAll();
    const loc = P.loc;
    const lv = P.now.level;

    // hero
    bind('heroVehicles', `${P.observed} veh`);
    bind('heroWeather', state.available.weather ? P.weather.label : 'No feed');
    bind('heroTime', M.formatHour(state.hour));
    bind('heroHist', P.available.history ? `${fmtSigned(Math.round((P.deviation - 1) * 100))} vs usual` : 'Offline');
    bind('heroTicker', `${loc.name}: ${lv.label} now, ${P.peak.minutes ? `${P.peak.level.label} by +${P.peak.minutes} min` : 'at its peak'} · ${pct(P.steps[2].confidence)}% confidence · ${P.action.title}`);
    const loads = {};
    M.LOCATIONS.forEach((l) => (loads[l.id] = preds[l.id].now.pressure));
    hero.setLoads(loads);
    hero.setLabels(['central', 'northgate', 'techpark', 'bridge'].map((id) => {
      const p = preds[id];
      return { id, code: p.loc.code, name: p.loc.name, vehicles: p.observed, level: p.peak.level.key, text: p.peak.minutes ? `${p.now.level.label} → ${p.peak.level.label} +${p.peak.minutes}m` : p.now.level.label };
    }));

    // signal
    renderLocList();
    setNum('vehicles', P.observed);
    setNum('pressure', pct(P.now.pressure));
    bindAttr('.readout', 'data-level', lv.key);
    bindAttr('.ro-status', 'data-level', lv.key);
    bind('levelText', `${lv.label}${lv.key === 'free' ? '' : ' traffic'}`);
    bind('capacity', loc.capacity);
    bind('weatherText', state.available.weather ? `${P.weather.label}, ${P.weather.temp}°C` : 'Feed offline');
    bind('timeText', `Fri ${M.formatHour(state.hour)}`);
    bind('histDelta', P.available.history ? fmtSigned(Math.round((P.deviation - 1) * 100)) : 'n/a');
    bind('histUsual', P.histNow);
    bind('mapClock', `Fri ${M.formatHour(state.hour)} · ${state.live ? 'live simulation' : 'paused'}`);
    const mp = mapPayload();
    const routeKinds = { route: 1, signal: 1 };
    cityMap.setData(Object.assign({ selected: state.selected, weather: state.available.weather ? state.weather : 'clear', altRoute: routeKinds[P.action.kind] ? TX.CityMap.ALT_ROUTES[loc.node] : null }, mp));
    finaleMap.setData({ loads: mp.loads });

    // pressure
    setNum('gauge', pct(P.now.pressure));
    setGauge(P.now.pressure);
    bindAttr('#pressure', 'data-level', lv.key);
    bind('gaugeVeh', P.observed);
    bind('gaugeCap', P.effCap);
    const capNote = P.effCap < loc.capacity ? ` ${P.weather.label} has cut usable capacity from ${loc.capacity} to ${P.effCap}.` : '';
    bind('pressureLead', `${P.observed} vehicles are using an approach that can carry ${P.effCap} in 15 minutes.${capNote} Past 87% the queue stops clearing between signal cycles.`);
    const scaleMax = Math.max(loc.capacity, P.observed) * 1.05;
    bind('capScale', Math.round(scaleMax));
    const cb = $('#capBar');
    cb.querySelector('.cb-fill').style.transform = `scaleX(${pressureArmed ? Math.min(1, P.observed / scaleMax) : 0})`;
    cb.querySelector('.cb-fill')._target = Math.min(1, P.observed / scaleMax);
    cb.querySelector('.cb-hist').style.left = (P.histNow / scaleMax) * 100 + '%';
    cb.querySelector('.cb-hist').style.display = P.available.history ? '' : 'none';
    cb.querySelector('.cb-limit').style.left = ((P.effCap * 0.87) / scaleMax) * 100 + '%';

    // forecast
    bind('forecastContext', `${loc.code} ${loc.name} · ${loc.corridor} · forecast from ${M.formatHour(state.hour)}`);
    renderTimeline(P);
    renderReliability(P);

    // why
    renderFactors(P);
    bind('explanation', P.explanation);
    renderWeather(P);

    // response
    renderResponse(P);

    // simulator follows the selected location and live inputs until the user touches it
    if (!simTouched) syncSim(); else renderSim();
  }
  let simTouched = false;
  ['input', 'click'].forEach((ev) => $('.sim-controls').addEventListener(ev, (e) => { if (e.target.id !== 'simSync') simTouched = true; else simTouched = false; }, true));

  let pressureArmed = false;

  // ---------------------------------------------------------------- live simulation
  let liveTimer = null;
  function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; }
  function tick() {
    state.hour += 1.5 / 60; // 1.5 simulated minutes per second
    for (const l of M.LOCATIONS) {
      state.bias[l.id] = Math.max(0.8, Math.min(1.38, state.bias[l.id] + gauss() * 0.012));
      const target = M.historical(l, state.hour) * state.bias[l.id];
      const v = state.vehicles[l.id];
      state.vehicles[l.id] = Math.max(20, Math.round(v + (target - v) * 0.25 + gauss() * l.capacity * 0.01));
    }
    renderAll();
  }
  function setLive(on) {
    state.live = on;
    $('#liveToggle').setAttribute('aria-pressed', on);
    $('#simBtn').setAttribute('aria-pressed', on);
    $('#simBtn .sb-text').textContent = on ? 'Live simulation running' : 'Start live simulation';
    clearInterval(liveTimer);
    if (on) liveTimer = setInterval(tick, 1000);
    bind('mapClock', `Fri ${M.formatHour(state.hour)} · ${on ? 'live simulation' : 'paused'}`);
  }
  $('#liveToggle').addEventListener('click', () => setLive(!state.live));
  $('#simBtn').addEventListener('click', () => setLive(!state.live));
  $('#resetBtn').addEventListener('click', () => { resetVehicles(); renderAll(); });

  // ---------------------------------------------------------------- scroll: reveals, nav
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target;
      el.classList.add('in');
      armNums(el);
      if (el.id === 'pressure') {
        pressureArmed = true; gaugeArmed = true; animateGauge();
        const f = el.querySelector('.cb-fill');
        f.style.transform = `scaleX(${f._target || 0})`;
      }
      if (el.classList.contains('factors')) revealFactors();
      if (el.id === 'anomBoard') playAnomaly();
      io.unobserve(el);
    }
  }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
  $$('.reveal').forEach((el) => io.observe(el));
  const tlIO = new IntersectionObserver((es) => { if (es[0].isIntersecting) { revealTimeline(); tlIO.disconnect(); } }, { threshold: 0.35 });
  tlIO.observe(tl);

  const nav = $('#nav');
  const progress = $('#navProgress');
  const sections = $$('[data-chapter]');
  const linkFor = { '01': 0, '02': 0, '03': 1, '04': 1, '05': 1, '06': 1, '07': 2, '08': 2 };
  const links = $$('.nav-links a');
  const chIO = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const s = e.target;
      s.classList.add('seen');
      $('#navChapter .nc-num').textContent = s.dataset.chapter;
      $('#navChapter .nc-name').textContent = s.dataset.name;
      links.forEach((a, i) => a.classList.toggle('active', i === linkFor[s.dataset.chapter]));
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach((s) => chIO.observe(s));

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      nav.classList.toggle('scrolled', y > 40);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
      // subtle hero parallax
      if (!reduced && y < window.innerHeight * 1.2) {
        $('.hero-content').style.transform = `translate3d(0, ${y * 0.18}px, 0)`;
        $('.hero-content').style.opacity = String(Math.max(0, 1 - y / (window.innerHeight * 0.85)));
      }
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // keyboard: arrow keys move through locations when the list has focus
  locList.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const ids = M.LOCATIONS.map((l) => l.id);
    const i = ids.indexOf(state.selected);
    const n = ids[(i + (e.key === 'ArrowDown' ? 1 : ids.length - 1)) % ids.length];
    select(n);
    locList.querySelector(`[data-id="${n}"]`).focus();
  });

  renderAll();
  requestAnimationFrame(() => document.body.classList.add('loaded'));
})();
