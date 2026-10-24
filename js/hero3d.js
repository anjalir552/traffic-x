/* Hero: stylised night city in Three.js with vehicles that slow down around
   congestion hotspots. Returns null when WebGL is unavailable. */
(function () {
  const TX = (window.TX = window.TX || {});

  const BG = 0x071116;
  const SP = 12;          // road grid spacing
  const EXT = 66;         // road half-length
  const ART_X = [-36, 0, 36];
  const ART_Z = [-24, 12];
  const HOTSPOTS = {
    central: [0, 12], northgate: [-36, -24], bridge: [-36, 36], techpark: [36, -24], market: [-60, 12]
  };

  function create(canvas, labelsEl) {
    if (!window.THREE) return null;
    const THREE = window.THREE;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch (e) {
      return null;
    }
    if (!renderer.getContext()) return null;

    const mobile = window.matchMedia('(max-width: 760px)').matches;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.75));
    renderer.setClearColor(BG, 1);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(BG, 70, 190);
    const camera = new THREE.PerspectiveCamera(36, 1, 1, 400);

    const fogU = { uFog: { value: new THREE.Color(BG) }, uNear: { value: 70 }, uFar: { value: 190 } };

    // ground
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshBasicMaterial({ color: 0x08141A }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // roads
    const roads = [];
    for (let v = -60; v <= 60; v += SP) {
      roads.push({ axis: 'x', c: v, art: ART_Z.includes(v) });   // runs along x at z=c
      roads.push({ axis: 'z', c: v, art: ART_X.includes(v) });   // runs along z at x=c
    }
    {
      const pos = [], col = [];
      const quad = (x0, z0, x1, z1, y, c) => {
        pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z0, x1, y, z1, x0, y, z1);
        for (let i = 0; i < 6; i++) col.push(c.r, c.g, c.b);
      };
      const cl = new THREE.Color(0x0E1B21), ca = new THREE.Color(0x132530);
      for (const r of roads) {
        const w = r.art ? 2.1 : 1.15;
        if (r.axis === 'x') quad(-EXT, r.c - w, EXT, r.c + w, r.art ? 0.03 : 0.02, r.art ? ca : cl);
        else quad(r.c - w, -EXT, r.c + w, EXT, r.art ? 0.03 : 0.02, r.art ? ca : cl);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true })));

      // lane dashes on arterials
      const lp = [];
      for (const r of roads) {
        if (!r.art) continue;
        for (let s = -EXT; s < EXT; s += 3) {
          if (r.axis === 'x') lp.push(s, 0.05, r.c, s + 1.4, 0.05, r.c);
          else lp.push(r.c, 0.05, s, r.c, 0.05, s + 1.4);
        }
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
      scene.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2A4652, transparent: true, opacity: 0.6 })));
    }

    // buildings
    {
      const rand = mulberry(11);
      const mats = [];
      for (let i = -60; i < 60; i += SP) {
        for (let j = -60; j < 60; j += SP) {
          const cx = i + SP / 2, cz = j + SP / 2;
          const dist = Math.hypot(cx - 4, cz - 4);
          const fall = Math.max(0.18, 1 - dist / 85);
          if (rand() < 0.06) continue; // plazas
          const lots = rand() < 0.5 ? 1 : rand() < 0.6 ? 2 : 4;
          const inner = SP - 3.6;
          const sub = lots === 4 ? 2 : 1;
          const subX = lots === 2 ? 2 : sub;
          for (let a = 0; a < subX; a++) {
            for (let b = 0; b < sub; b++) {
              const lw = inner / subX, ld = inner / sub;
              const w = lw * (0.72 + rand() * 0.26), d = ld * (0.72 + rand() * 0.26);
              let h = 1.2 + Math.pow(rand(), 2.4) * 12 * fall + fall * 2;
              if (rand() < 0.035 * fall) h += 10 + rand() * 14;
              mats.push([i + 1.8 + lw * (a + 0.5), j + 1.8 + ld * (b + 0.5), w, h, d]);
            }
          }
        }
      }
      const geo = new THREE.BoxGeometry(1, 1, 1);
      geo.translate(0, 0.5, 0);
      const mat = new THREE.ShaderMaterial({
        uniforms: Object.assign({}, fogU),
        vertexShader: `
          varying vec3 vWorld; varying vec3 vN; varying float vY; varying vec2 vSeed;
          void main() {
            vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
            vWorld = wp.xyz; vY = position.y;
            vN = normalize(mat3(instanceMatrix) * normal);
            vSeed = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: `
          uniform vec3 uFog; uniform float uNear; uniform float uFar;
          varying vec3 vWorld; varying vec3 vN; varying float vY; varying vec2 vSeed;
          float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          void main() {
            vec3 n = normalize(vN);
            vec3 col;
            if (n.y > 0.5) {
              col = vec3(0.058, 0.062, 0.07);
            } else {
              vec3 base = mix(vec3(0.03, 0.033, 0.038), vec3(0.07, 0.075, 0.085), clamp(vY, 0.0, 1.0));
              float l = 0.65 + 0.35 * max(dot(n, normalize(vec3(-0.5, 0.0, 0.8))), 0.0);
              col = base * l;
              vec2 uv = vec2(abs(n.x) > 0.5 ? vWorld.z : vWorld.x, vWorld.y);
              vec2 g = uv * vec2(1.3, 1.05);
              vec2 cell = floor(g); vec2 f = fract(g);
              float win = step(0.28, f.x) * step(f.x, 0.72) * step(0.32, f.y) * step(f.y, 0.72);
              float h = hash(cell + vSeed * 0.731);
              float lit = step(0.87, h);
              vec3 wc = mix(vec3(0.96, 0.62, 0.04), vec3(0.6, 0.75, 0.95), step(0.95, h));
              col += win * lit * wc * 0.55;
              col += win * (1.0 - lit) * 0.01;
            }
            float d = length(vWorld - cameraPosition);
            col = mix(col, uFog, smoothstep(uNear, uFar, d));
            gl_FragColor = vec4(col, 1.0);
          }`
      });
      const mesh = new THREE.InstancedMesh(geo, mat, mats.length);
      const m4 = new THREE.Matrix4();
      mats.forEach((b, k) => {
        m4.makeScale(b[2], b[3], b[4]);
        m4.setPosition(b[0], 0, b[1]);
        mesh.setMatrixAt(k, m4);
      });
      scene.add(mesh);
    }

    // hotspots
    const hotspotMeshes = {};
    const discGeo = new THREE.PlaneGeometry(1, 1);
    const beamGeo = new THREE.CylinderGeometry(0.12, 0.12, 1, 8, 1, true);
    beamGeo.translate(0, 0.5, 0);
    for (const id in HOTSPOTS) {
      const [x, z] = HOTSPOTS[id];
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color(1, 0.6, 0.1) }, uI: { value: 0 }, uTime: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `
          uniform vec3 uColor; uniform float uI; uniform float uTime; varying vec2 vUv;
          void main(){
            float d = length(vUv - 0.5) * 2.0;
            float glow = pow(max(0.0, 1.0 - d), 2.0) * 1.0;
            float p = fract(uTime * 0.45);
            float ring = smoothstep(0.035, 0.0, abs(d - p)) * (1.0 - p) * 0.8;
            float a = (glow + ring) * uI;
            gl_FragColor = vec4(uColor * a, a);
          }`
      });
      const disc = new THREE.Mesh(discGeo, mat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(x, 0.1, z);
      disc.scale.set(40, 40, 1);
      scene.add(disc);
      const beamMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uColor: mat.uniforms.uColor, uI: mat.uniforms.uI },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 uColor; uniform float uI; varying vec2 vUv; void main(){ float a = (1.0 - vUv.y) * 0.6 * uI; gl_FragColor = vec4(uColor * a, a); }'
      });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.set(x, 0, z);
      beam.scale.set(1, 18, 1);
      scene.add(beam);
      hotspotMeshes[id] = { disc, beam, mat, x, z, intensity: 0, target: 0 };
    }

    // congestion strips along arterials
    const strips = [];
    {
      const N = 90;
      for (const r of roads) {
        if (!r.art) continue;
        const pos = new Float32Array((N + 1) * 2 * 3);
        const col = new Float32Array((N + 1) * 2 * 3);
        const idx = [];
        for (let i = 0; i <= N; i++) {
          const s = -EXT + (2 * EXT * i) / N;
          const w = 0.42;
          const k = i * 6;
          if (r.axis === 'x') { pos.set([s, 0.06, r.c - w, s, 0.06, r.c + w], k); }
          else { pos.set([r.c - w, 0.06, s, r.c + w, 0.06, s], k); }
          if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.setIndex(idx);
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        scene.add(m);
        strips.push({ r, g, N });
      }
    }

    // recommended alternate route ribbon
    let routeMat;
    {
      const path = [[-66, 0], [-12, 0], [-12, 36], [48, 36], [48, 0], [66, 0]];
      const pos = [], along = [], idx = [];
      let acc = 0, v = 0;
      for (let i = 0; i < path.length - 1; i++) {
        const [x0, z0] = path[i], [x1, z1] = path[i + 1];
        const len = Math.hypot(x1 - x0, z1 - z0);
        const nx = -(z1 - z0) / len * 0.35, nz = (x1 - x0) / len * 0.35;
        pos.push(x0 + nx, 0.09, z0 + nz, x0 - nx, 0.09, z0 - nz, x1 + nx, 0.09, z1 + nz, x1 - nx, 0.09, z1 - nz);
        along.push(acc, acc, acc + len, acc + len);
        idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
        v += 4; acc += len;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
      g.setIndex(idx);
      routeMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 }, uShow: { value: 0 } },
        vertexShader: 'attribute float along; varying float vA; void main(){ vA = along; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `
          uniform float uTime; uniform float uShow; varying float vA;
          void main(){
            float dash = step(fract(vA * 0.12 - uTime * 0.9), 0.5);
            float reveal = smoothstep(uShow * 260.0, uShow * 260.0 - 8.0, vA);
            float a = (0.25 + dash * 0.75) * reveal * 0.85;
            gl_FragColor = vec4(vec3(0.23, 0.51, 0.96) * a, a);
          }`
      });
      scene.add(new THREE.Mesh(g, routeMat));
    }

    // vehicles
    const COUNT = mobile ? 600 : 1400;
    const TRAIL = 3;
    const cars = [];
    {
      const rand = mulberry(5);
      const weighted = [];
      for (const r of roads) for (let k = 0; k < (r.art ? 4 : 1); k++) weighted.push(r);
      for (let i = 0; i < COUNT; i++) {
        const r = weighted[(rand() * weighted.length) | 0];
        const dir = rand() < 0.5 ? 1 : -1;
        const lane = r.art ? (rand() < 0.5 ? 0.55 : 1.45) : 0.55;
        cars.push({ r, dir, off: lane * dir, s: -EXT + rand() * 2 * EXT, base: (r.art ? 9 : 6) * (0.75 + rand() * 0.5) });
      }
    }
    const vPos = new Float32Array(COUNT * TRAIL * 3);
    const vCol = new Float32Array(COUNT * TRAIL * 3);
    const vSize = new Float32Array(COUNT * TRAIL);
    for (let i = 0; i < COUNT; i++) for (let t = 0; t < TRAIL; t++) vSize[i * TRAIL + t] = [3.4, 2.5, 1.7][t];
    const vg = new THREE.BufferGeometry();
    vg.setAttribute('position', new THREE.BufferAttribute(vPos, 3));
    vg.setAttribute('color', new THREE.BufferAttribute(vCol, 3));
    vg.setAttribute('size', new THREE.BufferAttribute(vSize, 1));
    const vMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 300 } },
      vertexShader: `
        attribute vec3 color; attribute float size; uniform float uScale; varying vec3 vC;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        varying vec3 vC;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d); gl_FragColor = vec4(vC * a, a); }`
    });
    const points = new THREE.Points(vg, vMat);
    points.frustumCulled = false;
    scene.add(points);

    // labels
    const labels = {};
    function setLabels(list) {
      for (const item of list) {
        let el = labels[item.id];
        if (!el) {
          el = document.createElement('div');
          el.className = 'h-label';
          labelsEl.appendChild(el);
          labels[item.id] = el;
        }
        el.dataset.level = item.level;
        el.innerHTML = `<b>${item.code} · ${item.name}</b>${item.vehicles} veh <span>· ${item.text}</span>`;
      }
    }

    function setLoads(map) {
      for (const id in hotspotMeshes) {
        const p = map[id] != null ? map[id] : 0.4;
        const h = hotspotMeshes[id];
        h.target = Math.max(0, Math.min(1, (p - 0.5) / 0.42));
        h.mat.uniforms.uColor.value.copy(colorFor(p));
      }
    }
    function colorFor(p) {
      const css = TX.loadColor(p, 1).match(/\d+/g).map(Number);
      return new THREE.Color(css[0] / 255, css[1] / 255, css[2] / 255);
    }

    function slowAt(x, z) {
      let f = 0;
      for (const id in hotspotMeshes) {
        const h = hotspotMeshes[id];
        if (h.intensity <= 0.01) continue;
        const d2 = (x - h.x) * (x - h.x) + (z - h.z) * (z - h.z);
        f += h.intensity * Math.exp(-d2 / (2 * 10 * 10));
      }
      return Math.min(1, f);
    }

    function updateStrips() {
      for (const st of strips) {
        const col = st.g.attributes.color.array;
        for (let i = 0; i <= st.N; i++) {
          const s = -EXT + (2 * EXT * i) / st.N;
          const x = st.r.axis === 'x' ? s : st.r.c, z = st.r.axis === 'x' ? st.r.c : s;
          const f = slowAt(x, z);
          const fade = 1 - Math.pow(Math.abs(s) / EXT, 3);
          const c = colorFor(0.38 + f * 0.6);
          const a = (0.3 + f * 0.9) * fade;
          col.set([c.r * a, c.g * a, c.b * a, c.r * a, c.g * a, c.b * a], i * 6);
        }
        st.g.attributes.color.needsUpdate = true;
      }
    }

    // camera rig
    let w = 0, h = 0, angle = 0.62, mx = 0, my = 0, tmx = 0, tmy = 0, scrollK = 0;
    function resize() {
      w = canvas.clientWidth; h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      if (w > 900) camera.setViewOffset(w, h, -w * 0.2, 0, w, h);
      else camera.clearViewOffset();
      camera.updateProjectionMatrix();
      vMat.uniforms.uScale.value = h * 0.62;
    }
    resize();
    new ResizeObserver(resize).observe(canvas);
    window.addEventListener('pointermove', (e) => { tmx = e.clientX / window.innerWidth - 0.5; tmy = e.clientY / window.innerHeight - 0.5; }, { passive: true });
    window.addEventListener('scroll', () => { scrollK = Math.min(1, window.scrollY / Math.max(1, window.innerHeight)); }, { passive: true });

    let visible = true, raf = null, last = performance.now(), time = 0, stripTimer = 0, routeShow = 0;
    new IntersectionObserver((es) => {
      visible = es[0].isIntersecting;
      if (visible && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
    }).observe(canvas);

    const tmp = new THREE.Vector3();
    const white = [1, 0.9, 0.76], red = [1, 0.22, 0.14], amber = [1, 0.58, 0.12];

    function frame(t) {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t; time += dt;
      const speedK = reduced ? 0.3 : 1;

      for (const id in hotspotMeshes) {
        const hs = hotspotMeshes[id];
        hs.intensity += (hs.target - hs.intensity) * Math.min(1, dt * 1.5);
        hs.mat.uniforms.uI.value = hs.intensity;
        hs.mat.uniforms.uTime.value = time + hs.x * 0.01;
        hs.beam.scale.y = 6 + hs.intensity * 20;
        hs.beam.visible = hs.intensity > 0.05;
      }
      stripTimer -= dt;
      if (stripTimer <= 0) { updateStrips(); stripTimer = 0.25; }
      routeShow = Math.min(1, routeShow + dt * 0.25);
      routeMat.uniforms.uTime.value = time;
      routeMat.uniforms.uShow.value = routeShow;

      for (let i = 0; i < COUNT; i++) {
        const c = cars[i];
        const x = c.r.axis === 'x' ? c.s : c.r.c + c.off;
        const z = c.r.axis === 'x' ? c.r.c + c.off : c.s;
        const f = 1 - slowAt(x, z) * 0.93;
        c.s += c.base * f * dt * c.dir * speedK;
        if (c.s > EXT) c.s = -EXT; else if (c.s < -EXT) c.s = EXT;
        const head = c.dir > 0 ? (f > 0.6 ? white : mix3(red, amber, f / 0.6)) : red;
        const edge = 1 - Math.pow(Math.min(1, Math.abs(c.s) / EXT), 4);
        for (let k = 0; k < TRAIL; k++) {
          const back = k * (0.35 + f * 0.55) * c.dir;
          const j = (i * TRAIL + k) * 3;
          if (c.r.axis === 'x') { vPos[j] = c.s - back; vPos[j + 1] = 0.35; vPos[j + 2] = c.r.c + c.off; }
          else { vPos[j] = c.r.c + c.off; vPos[j + 1] = 0.35; vPos[j + 2] = c.s - back; }
          const b = [1, 0.45, 0.2][k] * edge;
          vCol[j] = head[0] * b; vCol[j + 1] = head[1] * b; vCol[j + 2] = head[2] * b;
        }
      }
      vg.attributes.position.needsUpdate = true;
      vg.attributes.color.needsUpdate = true;

      mx += (tmx - mx) * Math.min(1, dt * 2);
      my += (tmy - my) * Math.min(1, dt * 2);
      angle += dt * 0.03 * speedK;
      const a = angle + mx * 0.25;
      const radius = (mobile ? 118 : 92) - scrollK * 10;
      const height = (mobile ? 104 : 80) + my * 8 + scrollK * 14;
      camera.position.set(Math.cos(a) * radius, height, Math.sin(a) * radius);
      camera.lookAt(0, 0, 4);

      renderer.render(scene, camera);

      // project labels
      for (const id in labels) {
        const hs = hotspotMeshes[id];
        tmp.set(hs.x, 6 + hs.intensity * 20, hs.z).project(camera);
        const el = labels[id];
        const sx = (tmp.x * 0.5 + 0.5) * w, sy = (-tmp.y * 0.5 + 0.5) * h;
        const ok = tmp.z < 1 && sx > w * 0.42 && sx < w - 40 && sy > 70 && sy < h - 80;
        el.style.opacity = ok ? 1 : 0;
        el.style.transform = `translate(${sx.toFixed(1)}px, ${(sy - 34).toFixed(1)}px)`;
      }

      raf = visible ? requestAnimationFrame(frame) : null;
    }
    raf = requestAnimationFrame(frame);

    return { setLoads, setLabels };
  }

  function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function mulberry(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  TX.Hero3D = { create };
})();
