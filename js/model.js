/* TRAFFIC-X prediction model.
   A small, deterministic model so every number on the page is derived from the
   same four inputs: vehicle count, weather, time of day and historical pattern. */
(function () {
  const TX = (window.TX = window.TX || {});

  // Monitored locations. `capacity` is vehicles per 15-minute window the approach
  // can carry in clear conditions. `am` / `pm` scale the historical peaks.
  const LOCATIONS = [
    { id: 'central', code: 'INT-07', name: 'Central Interchange', corridor: 'Eastbound Corridor',
      alt: 'Harbour Avenue', capacity: 950, base: 0.92, am: 0.85, pm: 1.0, node: 'G' },
    { id: 'northgate', code: 'INT-02', name: 'North Gate', corridor: 'Ring Road Northbound',
      alt: 'Mill Street', capacity: 1100, base: 0.8, am: 1.0, pm: 0.8, node: 'B' },
    { id: 'bridge', code: 'BR-01', name: 'Riverside Bridge', corridor: 'Bridge Approach West',
      alt: 'Canal Road', capacity: 720, base: 0.9, am: 0.9, pm: 0.95, node: 'J' },
    { id: 'techpark', code: 'INT-11', name: 'Tech Park Junction', corridor: 'Tech Park Exit Ramp',
      alt: 'Orchard Lane', capacity: 820, base: 0.85, am: 1.05, pm: 0.9, node: 'D' },
    { id: 'market', code: 'INT-04', name: 'Old Market Square', corridor: 'Market Street',
      alt: 'Station Road', capacity: 600, base: 0.7, am: 0.6, pm: 0.75, node: 'E' }
  ];

  const WEATHER = {
    clear: { label: 'Clear', cap: 1.0, demand: 1.0, impact: 12, temp: 24, note: 'Dry road, full visibility' },
    rain: { label: 'Rain', cap: 0.9, demand: 1.03, impact: 41, temp: 21, note: 'Wet surface, longer braking gaps' },
    heavy: { label: 'Heavy Rain', cap: 0.78, demand: 1.06, impact: 66, temp: 19, note: 'Standing water, slower lanes' },
    fog: { label: 'Fog', cap: 0.84, demand: 0.98, impact: 54, temp: 17, note: 'Visibility under 200 m' }
  };

  const LEVELS = [
    { key: 'free', label: 'Free flow', max: 0.45 },
    { key: 'moderate', label: 'Moderate', max: 0.72 },
    { key: 'heavy', label: 'Heavy', max: 0.87 },
    { key: 'severe', label: 'Severe', max: Infinity }
  ];

  const HORIZONS = [0, 15, 30, 60];

  const gauss = (x, mu, s) => Math.exp(-((x - mu) * (x - mu)) / (2 * s * s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wrapHour = (h) => ((h % 24) + 24) % 24;

  // Share of capacity normally in use at a given hour (0..~1).
  function profile(loc, hour) {
    const h = wrapHour(hour);
    const night = 0.08;
    const day = 0.2 * gauss(h, 13, 3.2);
    const am = 0.62 * loc.am * gauss(h, 8.6, 1.15);
    const pm = 0.7 * loc.pm * (gauss(h, 18.2, 0.75) + gauss(h - 24, 18.2, 0.75));
    const evening = 0.1 * gauss(h, 21, 1.6);
    return (night + day + am + pm + evening) * loc.base;
  }

  function historical(loc, hour) {
    return loc.capacity * profile(loc, hour);
  }

  function level(p) {
    return LEVELS.find((l) => p < l.max);
  }

  function trendOf(delta) {
    if (delta > 0.03) return { key: 'up', label: 'Rising' };
    if (delta < -0.03) return { key: 'down', label: 'Easing' };
    return { key: 'flat', label: 'Stable' };
  }

  /* inputs: { loc, vehicles, hour, weather, available: {vehicles, weather, time, history} } */
  function predict(input) {
    const loc = input.loc;
    const av = Object.assign({ vehicles: true, weather: true, time: true, history: true }, input.available || {});
    const wx = WEATHER[av.weather ? input.weather : 'clear'];
    const hour = input.hour;
    const effCap = loc.capacity * wx.cap;

    // History needs a clock to be looked up against.
    const useHistory = av.history && av.time;
    const histNow = historical(loc, hour);
    const observed = av.vehicles ? input.vehicles : useHistory ? histNow : loc.capacity * 0.5;
    const deviation = useHistory ? observed / Math.max(histNow, 1) : 1;

    const steps = HORIZONS.map((m) => {
      let projected;
      if (useHistory) {
        const histT = historical(loc, hour + m / 60);
        const devT = 1 + (deviation - 1) * Math.exp(-m / 70);
        projected = histT * devT;
      } else {
        projected = observed; // no pattern to follow: assume persistence
      }
      projected *= 1 + (wx.demand - 1) * (m / 60);
      const pressure = projected / effCap;

      let conf = 0.95;
      if (!av.vehicles) conf -= 0.27;
      if (!av.history) conf -= 0.19;
      if (!av.time) conf -= 0.11;
      if (!av.weather) conf -= 0.07;
      if (input.weather === 'heavy' && av.weather) conf -= 0.03;
      if (input.weather === 'fog' && av.weather) conf -= 0.04;
      conf -= clamp(Math.abs(deviation - 1) - 0.35, 0, 1) * 0.25; // unusual conditions are harder to call
      conf -= (m / 60) * 0.13;

      return {
        minutes: m,
        vehicles: Math.round(projected),
        pressure,
        level: level(pressure),
        confidence: clamp(conf, 0.2, 0.97)
      };
    });

    steps.forEach((s, i) => {
      s.trend = i === 0 ? trendOf(steps[1].pressure - s.pressure) : trendOf(s.pressure - steps[i - 1].pressure);
    });

    const now = steps[0];
    const peak = steps.reduce((a, b) => (b.pressure > a.pressure ? b : a));

    // How strongly each input shaped this forecast (0-100, display scale).
    const hourShape = useHistory
      ? Math.abs(historical(loc, hour + 0.5) - histNow) / Math.max(histNow, 1)
      : 0;
    const factors = [
      { key: 'vehicles', label: 'Vehicle count', value: av.vehicles ? clamp(30 + now.pressure * 66, 8, 96) : 0 },
      { key: 'history', label: 'Historical pattern', value: useHistory ? clamp(38 + Math.abs(deviation - 1) * 120 + hourShape * 90, 10, 95) : 0 },
      { key: 'time', label: 'Time of day', value: av.time ? clamp(22 + profile(loc, hour) * 52 + hourShape * 60, 10, 92) : 0 },
      { key: 'weather', label: 'Weather', value: av.weather ? wx.impact : 0 }
    ];
    factors.forEach((f) => (f.impact = f.value >= 65 ? 'High' : f.value >= 35 ? 'Medium' : f.value > 0 ? 'Low' : 'No data'));
    factors.sort((a, b) => b.value - a.value);

    const availableCount = Object.values(av).filter(Boolean).length;
    const quality = availableCount === 4 ? 'High' : availableCount === 3 ? 'Medium' : 'Low';

    const anomaly = useHistory && av.vehicles && deviation > 1.6 && profile(loc, hour) < 0.4;

    return {
      loc, hour, weather: wx, weatherKey: input.weather, available: av,
      observed: Math.round(observed), histNow: Math.round(histNow), deviation,
      effCap: Math.round(effCap), steps, now, peak, factors, quality, availableCount, anomaly,
      explanation: explain(),
      action: decide()
    };

    function explain() {
      const p30 = steps[2].pressure;
      const dir = p30 > now.pressure + 0.03 ? 'increase' : p30 < now.pressure - 0.03 ? 'ease' : 'hold steady';
      const parts = [];
      if (!av.vehicles && !useHistory) return 'Live vehicle counts and the historical baseline are both unavailable. This forecast is a placeholder estimate and should not drive signal changes.';
      if (!av.vehicles) return 'Live vehicle counts are unavailable, so this forecast leans on the historical pattern for this hour. Treat it as an estimate.';
      if (useHistory) {
        const pct = Math.round(Math.abs(deviation - 1) * 100);
        if (pct >= 4) parts.push(`the current vehicle load is ${pct}% ${deviation > 1 ? 'above' : 'below'} the historical average for this time period`);
        else parts.push('the current vehicle load matches the historical average for this time period');
        const histShift = historical(loc, hour + 0.5) - histNow;
        if (Math.abs(histShift) / histNow > 0.04) parts.push(`demand at this hour usually ${histShift > 0 ? 'keeps building for the next 30 minutes' : 'falls off over the next 30 minutes'}`);
      } else {
        parts.push('there is no historical baseline, so current volume is assumed to persist');
      }
      if (av.weather && input.weather !== 'clear') parts.push(`${wx.label.toLowerCase()} is cutting effective road capacity by ${Math.round((1 - wx.cap) * 100)}%`);
      const joined = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0];
      return `Traffic is expected to ${dir} because ${joined}.`;
    }

    function decide() {
      const peakIn = peak.minutes;
      const when = peakIn === 0 ? 'now' : `within the next ${peakIn} minutes`;
      if (anomaly) {
        return {
          kind: 'incident', priority: 'High',
          title: `Verify conditions at ${loc.name}`,
          detail: 'Send the nearest patrol unit and pull the junction camera feed.',
          reason: `Observed volume is ${Math.round((deviation - 1) * 100)}% above what this hour normally carries. The pattern does not explain it, so the cause needs checking before signals are changed.`
        };
      }
      if (peak.pressure >= 0.87) {
        const extra = Math.round(clamp((peak.pressure - 0.75) * 140, 10, 28));
        return {
          kind: 'signal', priority: 'High', extra,
          title: `Increase green time on ${loc.corridor}`,
          detail: `Add ${extra} s of green per cycle for the next 45 minutes.`,
          reason: `Vehicle pressure is ${steps[1].pressure >= now.pressure ? 'rising' : 'high'} and the historical pattern puts the congestion peak ${when}. Acting now clears the queue before it spills into upstream junctions.`
        };
      }
      if (peak.pressure >= 0.72) {
        return {
          kind: 'route', priority: 'Medium',
          title: `Advise ${loc.alt} as the alternate route`,
          detail: `Push the advisory to signs and navigation feeds approaching ${loc.name}.`,
          reason: `Traffic will reach heavy levels ${when}. Diverting some through-traffic early keeps ${loc.corridor} below its tipping point.`
        };
      }
      if (peak.pressure >= 0.45) {
        return {
          kind: 'monitor', priority: 'Low',
          title: `Keep ${loc.name} under watch`,
          detail: 'No change to signal plans. Re-check on the next 5-minute update.',
          reason: 'Flow is moderate and the forecast stays below the heavy threshold for the next hour.'
        };
      }
      return {
        kind: 'none', priority: 'Low',
        title: 'No intervention needed',
        detail: 'Signals stay on the standard plan.',
        reason: 'Volume is well within capacity and the historical pattern shows no build-up in the next hour.'
      };
    }
  }

  function formatHour(hour, opts) {
    const h = wrapHour(hour);
    let hh = Math.floor(h);
    let mm = Math.round((h - hh) * 60);
    if (mm === 60) { mm = 0; hh = (hh + 1) % 24; }
    if (opts && opts.ampm) {
      const suffix = hh >= 12 ? 'PM' : 'AM';
      const h12 = hh % 12 === 0 ? 12 : hh % 12;
      return `${String(h12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${suffix}`;
    }
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  TX.model = { LOCATIONS, WEATHER, LEVELS, HORIZONS, profile, historical, predict, level, formatHour, clamp };
})();
