// Fly Blind 3D scene (Three.js r169). Reads game state from window.__g each frame and draws it.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const LANE = 6.2;            // lane spacing
const ALT = 5.2;             // flight altitude
const ZK = 9;                // world units per game distance unit
const TILE = 120, NTILE = 6; // city tiles
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: /[?&]rec=1/.test(location.search) });
  renderer.setClearColor(0x03040b, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const scene = new THREE.Scene();
  const fogNight = new THREE.Color(0x040817), fogNeon = new THREE.Color(0x3a1248);
  scene.fog = new THREE.FogExp2(fogNight.clone(), 0.012);
  const camera = new THREE.PerspectiveCamera(62, 9 / 16, 0.1, 900);

  // ---------- sky dome ----------
  const skyU = { uEye: { value: 0 }, uTime: { value: 0 } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `uniform float uEye; uniform float uTime; varying vec3 vP;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      void main(){
        float y = clamp(vP.y*1.6+0.08, 0.0, 1.0);
        vec3 n0 = vec3(0.02,0.035,0.09), n1 = vec3(0.005,0.01,0.03);
        vec3 e0 = vec3(0.55,0.12,0.42), e1 = vec3(0.05,0.02,0.14);
        vec3 c = mix(mix(n0,n1,y), mix(e0,e1,pow(y,0.6)), uEye);
        vec2 sp = floor(vP.xz/max(0.15,vP.y+0.2)*220.0);
        float st = step(0.9975, h(sp)) * smoothstep(0.08,0.4,vP.y);
        st *= 0.6+0.4*sin(uTime*3.0+h(sp)*40.0);
        c += st * mix(vec3(0.45,0.55,0.9), vec3(1.0,0.8,0.95), uEye);
        gl_FragColor = vec4(c,1.0);
      }`
  }));
  scene.add(sky);
  // moon
  const moonTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d");
    const g = x.createRadialGradient(128, 128, 30, 128, 128, 128); g.addColorStop(0, "rgba(255,240,200,1)"); g.addColorStop(0.42, "rgba(255,230,180,1)"); g.addColorStop(0.46, "rgba(255,170,220,0.35)"); g.addColorStop(1, "rgba(255,120,220,0)");
    x.fillStyle = g; x.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c); })();
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, fog: false, transparent: true, depthWrite: false }));
  moon.scale.set(90, 90, 1); moon.position.set(120, 150, -520); scene.add(moon);

  // ---------- window texture for buildings ----------
  function windowTex(seed) {
    const R = rng(seed), c = document.createElement("canvas"); c.width = 128; c.height = 256; const x = c.getContext("2d");
    x.fillStyle = "#000"; x.fillRect(0, 0, 128, 256);
    for (let yy = 6; yy < 250; yy += 9) for (let xx = 6; xx < 122; xx += 10) {
      const r = R(); if (r < 0.5) continue;
      x.fillStyle = r < 0.62 ? "#5ad8ff" : r < 0.7 ? "#ff58d8" : "#ffcf6a"; x.globalAlpha = 0.5 + R() * 0.5; x.fillRect(xx, yy, 5, 4);
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; return t;
  }
  const winTex = windowTex(7);
  const bldU = { uEye: { value: 0 } };
  const bldMat = new THREE.MeshStandardMaterial({ color: 0x0b0f22, roughness: 0.55, metalness: 0.4, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 0.15 });
  bldMat.onBeforeCompile = (sh) => { sh.uniforms.uEye = bldU.uEye; sh.fragmentShader = "uniform float uEye;\n" + sh.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n totalEmissiveRadiance *= mix(0.12, 1.6, uEye);"); };
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x4fd6ff, transparent: true, opacity: 0.85, fog: true, blending: THREE.AdditiveBlending, depthWrite: false });

  // ---------- city tiles ----------
  const tiles = [];
  for (let ti = 0; ti < NTILE; ti++) {
    const R = rng(100 + ti), group = new THREE.Group(), geos = [];
    for (const side of [-1, 1]) {
      let z = 0;
      while (z < TILE) {
        const w = 6 + R() * 10, d = 6 + R() * 12, h = 12 + Math.pow(R(), 1.6) * 90;
        const x = side * (15 + R() * 4 + w / 2) + side * (R() < 0.35 ? 14 + R() * 18 : 0);
        const g = new THREE.BoxGeometry(w, h, d); g.translate(x, h / 2 - 2, -z - d / 2);
        const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 10, uv.getY(i) * h / 22);
        geos.push(g); z += d + 1 + R() * 3;
        if (R() < 0.25) { const g2 = new THREE.BoxGeometry(w * 0.5, h * 0.25, d * 0.5); g2.translate(x, h + h * 0.125 - 2, -z + d / 2); geos.push(g2); }
      }
    }
    const merged = mergeBoxes(geos);
    const mesh = new THREE.Mesh(merged, bldMat); group.add(mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(merged, 30), edgeMat); group.add(edges);
    // rooftop beacons
    group.position.z = -ti * TILE; scene.add(group); tiles.push(group);
  }
  function mergeBoxes(list) {
    let n = 0, ni = 0; for (const g of list) { n += g.attributes.position.count; ni += g.index.count; }
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uvs = new Float32Array(n * 2), idx = new Uint32Array(ni);
    let o = 0, oi = 0;
    for (const g of list) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); uvs.set(g.attributes.uv.array, o * 2);
      const gi = g.index.array; for (let i = 0; i < gi.length; i++) idx[oi + i] = gi[i] + o; o += g.attributes.position.count; oi += gi.length; g.dispose(); }
    const m = new THREE.BufferGeometry(); m.setAttribute("position", new THREE.BufferAttribute(pos, 3)); m.setAttribute("normal", new THREE.BufferAttribute(nor, 3)); m.setAttribute("uv", new THREE.BufferAttribute(uvs, 2)); m.setIndex(new THREE.BufferAttribute(idx, 1)); return m;
  }

  // ---------- ground and road ----------
  const groundU = { uEye: { value: 0 }, uScroll: { value: 0 } };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 900), new THREE.ShaderMaterial({
    uniforms: Object.assign({ fogColor: { value: scene.fog.color }, fogDensity: { value: 0.012 } }, groundU), fog: false,
    vertexShader: "varying vec2 vW; varying float vD; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xz; vec4 mv = viewMatrix*w; vD = -mv.z; gl_Position = projectionMatrix*mv; }",
    fragmentShader: `uniform float uEye; uniform float uScroll; uniform vec3 fogColor; uniform float fogDensity; varying vec2 vW; varying float vD;
      float line(float v, float w){ float f = abs(fract(v)-0.5); return smoothstep(w, 0.0, f-0.5+w); }
      void main(){
        float z = vW.y + uScroll;
        float road = step(abs(vW.x), 9.6);
        vec3 base = mix(vec3(0.01,0.015,0.035), vec3(0.03,0.01,0.06), uEye);
        vec3 col = base;
        float gx = line(vW.x/6.0, 0.03), gz = line(z/6.0, 0.03);
        vec3 gridC = mix(vec3(0.08,0.35,0.6), vec3(0.75,0.15,0.75), uEye);
        col += (1.0-road) * (gx+gz) * gridC * 0.55;
        // road edges and lane dividers
        float edge = smoothstep(0.25,0.0,abs(abs(vW.x)-9.6));
        float lane = smoothstep(0.12,0.0,abs(abs(vW.x)-3.1)) * step(0.5, fract(z/7.0));
        col += road*0.6*vec3(0.01,0.01,0.02);
        col += edge * mix(vec3(0.2,0.75,1.0), vec3(1.0,0.3,0.85), uEye) * 1.6;
        col += lane * mix(vec3(0.15,0.35,0.7), vec3(0.6,0.35,1.0), uEye) * 0.9;
        float fog = 1.0 - exp(-fogDensity*fogDensity*vD*vD);
        gl_FragColor = vec4(mix(col, fogColor, fog), 1.0);
      }`
  }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, -2, -380); scene.add(ground);

  // lights
  const hemi = new THREE.HemisphereLight(0x6a7cff, 0x100018, 0.6); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffc0f0, 0.8); key.position.set(-30, 60, 20); scene.add(key);

  // ---------- plane ----------
  function makePlane(ghost) {
    const g = new THREE.Group();
    const bodyM = ghost ? new THREE.MeshBasicMaterial({ color: 0x6bdcff, transparent: true, opacity: 0.28, depthWrite: false })
      : new THREE.MeshStandardMaterial({ color: 0xc9d3f2, metalness: 0.55, roughness: 0.35, emissive: 0x1a2a55, emissiveIntensity: 0.6 });
    const accM = ghost ? bodyM : new THREE.MeshStandardMaterial({ color: 0xff4fd8, emissive: 0xff2fc8, emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.3 });
    const glassM = ghost ? bodyM : new THREE.MeshStandardMaterial({ color: 0x0a2a44, emissive: 0x3fc6ff, emissiveIntensity: 0.9, metalness: 0.9, roughness: 0.1 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.62, 4.2, 10), bodyM); body.rotation.x = Math.PI / 2; g.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.6, 10), bodyM); nose.rotation.x = -Math.PI / 2; nose.position.z = -2.9; g.add(nose);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.38, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), glassM); glass.scale.set(1, 0.7, 1.8); glass.position.set(0, 0.35, -1.3); g.add(glass);
    const wingShape = new THREE.Shape(); wingShape.moveTo(0, 0.9); wingShape.lineTo(3.6, -0.6); wingShape.lineTo(3.6, -1.1); wingShape.lineTo(0, -1.2);
    const wingG = new THREE.ExtrudeGeometry(wingShape, { depth: 0.12, bevelEnabled: false });
    for (const sgn of [-1, 1]) { const w = new THREE.Mesh(wingG, bodyM); w.rotation.x = -Math.PI / 2; w.scale.x = sgn; w.position.set(0, -0.05, 0.2); g.add(w);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.7), accM); tip.position.set(sgn * 3.55, 0, 1.0); g.add(tip); }
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 1.1), accM); fin.position.set(0, 0.7, 1.6); g.add(fin);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.7), bodyM); tail.position.set(0, 0.1, 1.8); g.add(tail);
    if (!ghost) {
      const fl = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.3, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      fl.rotation.x = Math.PI / 2; fl.position.z = 2.9; g.add(fl); g.userData.flame = fl;
      const light = new THREE.PointLight(0xff7ad8, 2.5, 10, 1.6); light.position.set(0, -0.5, 0); g.add(light);
    }
    if (!ghost) { const em = new THREE.LineBasicMaterial({ color: 0x8fe3ff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }); g.userData.edgeMat = em;
      g.traverse((m) => { if (m.isMesh && m.geometry && m !== g.userData.flame) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25), em)); }); }
    return g;
  }
  const plane = makePlane(false); plane.scale.setScalar(0.62); scene.add(plane);
  const ghost = makePlane(true); ghost.scale.setScalar(0.5); scene.add(ghost);

  // ---------- engine trail particles ----------
  const TRAIL = 140, trailPos = new Float32Array(TRAIL * 3), trailAge = new Float32Array(TRAIL);
  const trailGeo = new THREE.BufferGeometry(); trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3)); trailGeo.setAttribute("age", new THREE.BufferAttribute(trailAge, 1));
  const trail = new THREE.Points(trailGeo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: "attribute float age; varying float vA; void main(){ vA = age; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = (1.0-age)*55.0/ -mv.z; gl_Position = projectionMatrix*mv; }",
    fragmentShader: "varying float vA; void main(){ float d = length(gl_PointCoord-0.5); if(d>0.5) discard; vec3 c = mix(vec3(1.0,0.75,0.35), vec3(1.0,0.25,0.8), vA); gl_FragColor = vec4(c, (1.0-vA)*(1.0-d*2.0)*0.8); }" }));
  trail.frustumCulled = false; scene.add(trail); let trailHead = 0;
  for (let i = 0; i < TRAIL; i++) trailAge[i] = 1;

  // ---------- burst particles ----------
  const BN = 400, bPos = new Float32Array(BN * 3), bVel = new Float32Array(BN * 3), bLife = new Float32Array(BN), bCol = new Float32Array(BN * 3);
  const bGeo = new THREE.BufferGeometry(); bGeo.setAttribute("position", new THREE.BufferAttribute(bPos, 3)); bGeo.setAttribute("life", new THREE.BufferAttribute(bLife, 1)); bGeo.setAttribute("col", new THREE.BufferAttribute(bCol, 3));
  const bursts = new THREE.Points(bGeo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: "attribute float life; attribute vec3 col; varying float vL; varying vec3 vC; void main(){ vL = life; vC = col; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = life*70.0/ -mv.z; gl_Position = projectionMatrix*mv; }",
    fragmentShader: "varying float vL; varying vec3 vC; void main(){ float d = length(gl_PointCoord-0.5); if(d>0.5||vL<=0.0) discard; gl_FragColor = vec4(vC*1.6, vL*(1.0-d*2.0)); }" }));
  bursts.frustumCulled = false; scene.add(bursts); let bHead = 0;
  function burst(x, y, z, color, n, speed) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) { const k = bHead++ % BN; const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.3) * Math.PI, v = speed * (0.4 + Math.random());
      bPos[k * 3] = x; bPos[k * 3 + 1] = y; bPos[k * 3 + 2] = z; bVel[k * 3] = Math.cos(a) * Math.cos(b) * v; bVel[k * 3 + 1] = Math.sin(b) * v; bVel[k * 3 + 2] = Math.sin(a) * Math.cos(b) * v; bLife[k] = 1; bCol[k * 3] = c.r; bCol[k * 3 + 1] = c.g; bCol[k * 3 + 2] = c.b; }
  }

  // ---------- gate panels ----------
  const fontFam = () => (document.documentElement.lang === "ja" ? "'DotGothic16', sans-serif" : "'DotGothic16', 'Press Start 2P', sans-serif");
  const texCache = new Map();
  const WORDCOL = { wall: 0xffd0f4, open: 0xeafff3, guess: 0xd6f6ff, cert: 0xd2ffe4, warn: 0xffd2da, dim: 0x9fb2ff };
  function wordTex(word) {
    if (texCache.has(word)) return texCache.get(word);
    const c = document.createElement("canvas"); c.width = 320; c.height = 160; const x = c.getContext("2d");
    let fs = 70; x.font = fs + "px " + fontFam(); while (x.measureText(word).width > 290 && fs > 26) { fs -= 4; x.font = fs + "px " + fontFam(); }
    x.textAlign = "center"; x.textBaseline = "middle";
    x.shadowColor = "#fff"; x.shadowBlur = 12; x.fillStyle = "#fff"; x.fillText(word, 160, 84); x.shadowBlur = 0; x.fillText(word, 160, 84);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; texCache.set(word, t); return t;
  }
  function clearWordTex() { for (const t of texCache.values()) t.dispose(); texCache.clear(); }
  const panelGeo = new THREE.PlaneGeometry(5.6, 3.4), wordGeo = new THREE.PlaneGeometry(5.4, 2.7);
  const frameGeo = (() => { const s = new THREE.Shape(); s.moveTo(-2.9, -1.8); s.lineTo(2.9, -1.8); s.lineTo(2.9, 1.8); s.lineTo(-2.9, 1.8); s.lineTo(-2.9, -1.8);
    const hole = new THREE.Path(); hole.moveTo(-2.65, -1.55); hole.lineTo(-2.65, 1.55); hole.lineTo(2.65, 1.55); hole.lineTo(2.65, -1.55); hole.lineTo(-2.65, -1.55); s.holes.push(hole); return new THREE.ShapeGeometry(s); })();
  const gateObjs = new Map();
  function gateObj(g) {
    if (gateObjs.has(g)) return gateObjs.get(g);
    const grp = new THREE.Group(), lanes = [];
    for (let l = 0; l < 3; l++) {
      const lg = new THREE.Group(); lg.position.x = (l - 1) * LANE;
      const panel = new THREE.Mesh(panelGeo, new THREE.MeshBasicMaterial({ color: 0xff3fd0, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide }));
      const frame = new THREE.Mesh(frameGeo, new THREE.MeshBasicMaterial({ color: 0x4fd6ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
      const word = new THREE.Mesh(wordGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide }));
      word.position.z = 0.05;
      // stripes on wall panels
      lg.add(panel); lg.add(frame); lg.add(word); lanes.push({ g: lg, panel, frame, word, kind: "" });
      grp.add(lg);
    }
    const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), new THREE.MeshBasicMaterial({ color: 0xffb648 })); marker.visible = false; grp.add(marker);
    grp.position.y = ALT; scene.add(grp);
    const o = { grp, lanes, marker, shattered: false }; gateObjs.set(g, o); return o;
  }
  // shards for crashes
  const shardGeo = new THREE.BoxGeometry(0.5, 0.5, 0.08), shards = [];
  function shatter(x, y, z) {
    for (let i = 0; i < 26; i++) { const m = new THREE.Mesh(shardGeo, new THREE.MeshBasicMaterial({ color: i % 3 ? 0xff3fd0 : 0xff4f6a, transparent: true }));
      m.position.set(x + (Math.random() - 0.5) * 5, y + (Math.random() - 0.5) * 3, z); m.userData.v = new THREE.Vector3((Math.random() - 0.5) * 18, (Math.random() - 0.2) * 12, -8 - Math.random() * 14); m.userData.r = new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9); m.userData.life = 1; scene.add(m); shards.push(m); }
  }

  // ---------- post ----------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.9, 0.55, 0.2); composer.addPass(bloom);
  const blind = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uEye: { value: 0 }, uTime: { value: 0 }, uFlash: { value: 0 }, uHit: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uEye, uTime, uFlash, uHit; uniform vec2 uRes; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
      void main(){
        vec2 uv = vUv;
        float ca = 0.004*uHit + 0.002*uFlash;
        vec3 c = vec3(texture2D(tDiffuse, uv+vec2(ca,0.0)).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv-vec2(ca,0.0)).b);
        float blind = 1.0-uEye;
        // eyes closed: cold monochrome with scanlines and grain
        float l = dot(c, vec3(0.3,0.59,0.11));
        vec3 mono = vec3(0.25,0.75,1.0)*pow(l,0.85)*1.25;
        float scan = 0.82+0.18*sin(uv.y*uRes.y*1.6);
        float grain = (h(uv*uRes+uTime*60.0)-0.5)*0.06;
        vec3 closedC = mono*scan + grain;
        float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
        float keep = smoothstep(0.22, 0.45, mx - mn) * smoothstep(0.25, 0.5, mx);
        c = mix(c, closedC, blind * 0.85 * (1.0 - keep));
        // vignette like eyelids
        vec2 q = uv-0.5; q.x *= 0.75; float v = smoothstep(0.75, 0.25 - 0.1*blind, length(q)*(1.0+0.5*blind));
        c *= mix(0.25, 1.0, v);
        c += vec3(0.75,0.9,1.0)*uFlash*0.3;
        c = mix(c, c*vec3(1.4,0.45,0.5), uHit*0.6);
        gl_FragColor = vec4(c,1.0);
      }`
  });
  composer.addPass(blind);
  composer.addPass(new OutputPass());

  // ---------- resize ----------
  let W = 1, H = 1;
  function resize(w, h, dpr) {
    W = w; H = h; renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); composer.setPixelRatio(dpr); composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix(); blind.uniforms.uRes.value.set(w * dpr, h * dpr); bloom.resolution.set(w * dpr / 2, h * dpr / 2);
  }

  // ---------- per frame ----------
  let lastT = null, travel = 0, camShake = 0, prevPassed = new Set(), bank = 0, prevX = 1;
  const camPos = new THREE.Vector3(0, ALT + 3.2, 11);
  function frame(G, now) {
    const dt = lastT === null ? 0.016 : clamp(now - lastT, 0, 0.05); lastT = now;
    const eye = G.eye;
    skyU.uEye.value = eye; skyU.uTime.value = G.time; bldU.uEye.value = eye; groundU.uEye.value = eye;
    scene.fog.color.copy(fogNight).lerp(fogNeon, eye); scene.fog.density = lerp(0.0075, 0.0068, eye);
    ground.material.uniforms.fogDensity.value = scene.fog.density;
    edgeMat.color.set(eye > 0.5 ? 0xff5fd8 : 0x4fd6ff); edgeMat.opacity = lerp(0.9, 0.35, eye);
    hemi.intensity = lerp(0.25, 0.75, eye); key.intensity = lerp(0.3, 1.0, eye);
    bloom.strength = lerp(1.0, 0.85, eye); bloom.threshold = lerp(0.42, 0.58, eye); bloom.radius = 0.45;
    blind.uniforms.uEye.value = eye; blind.uniforms.uTime.value = G.time; blind.uniforms.uFlash.value = G.flash * G.flash; blind.uniforms.uHit.value = G.shake;

    // world scroll
    const moving = G.screen === "play" ? 1.15 * G.speed : G.screen === "title" ? 1.3 : G.screen === "countdown" ? 0.4 : 0.3;
    travel += moving * ZK * dt;
    for (let i = 0; i < NTILE; i++) { let z = ((-i * TILE + travel) % (TILE * NTILE)); if (z > 30) z -= TILE * NTILE; tiles[i].position.z = z; }
    groundU.uScroll.value = -travel;

    // plane
    const px = (G.planeX - 1) * LANE, gx = (G.ghostX - 1) * LANE;
    const vx = (G.planeX - prevX) / Math.max(dt, 1e-3); prevX = G.planeX;
    bank = lerp(bank, clamp(-vx * 0.16, -0.45, 0.45), Math.min(1, dt * 6));
    const bob = Math.sin(G.time * 2.1) * 0.18;
    plane.position.set(px, ALT + bob, 0); plane.rotation.set(0.04 + Math.sin(G.time * 1.3) * 0.02, 0, bank);
    if (plane.userData.edgeMat) plane.userData.edgeMat.opacity = lerp(0.9, 0.15, eye);
    if (plane.userData.flame) { plane.userData.flame.scale.set(1, 0.8 + Math.random() * 0.5, 1); }
    ghost.position.set(gx, ALT + 1.8 + Math.sin(G.time * 2 + 1) * 0.15, -4.5); ghost.rotation.z = bank * 0.5;
    const showPlanes = G.screen !== "title";
    plane.visible = showPlanes; ghost.visible = showPlanes && G.screen !== "intro";
    // trail
    for (let i = 0; i < TRAIL; i++) { trailAge[i] = Math.min(1, trailAge[i] + dt * 1.8); trailPos[i * 3 + 2] += moving * ZK * dt; }
    if (showPlanes) for (let k = 0; k < 2; k++) { const i = trailHead++ % TRAIL; trailPos[i * 3] = px + (Math.random() - 0.5) * 0.2; trailPos[i * 3 + 1] = ALT + bob - 0.05; trailPos[i * 3 + 2] = 1.9; trailAge[i] = 0; }
    trailGeo.attributes.position.needsUpdate = true; trailGeo.attributes.age.needsUpdate = true;

    // gates
    const cur = G.gates.find((g) => !g.passed) || null;
    const st = G.sess && cur ? G.sess.state() : null;
    const live = new Set();
    for (const g of G.gates) {
      if (g.d > 10.5 || g.fade <= 0.02) { const o = gateObjs.get(g); if (o) o.grp.visible = false; continue; }
      const o = gateObj(g); live.add(g); o.grp.visible = true;
      o.grp.position.z = -g.d * ZK;
      const past = clamp(1 - (o.grp.position.z + 1.5) / 2.5, 0, 1); if (past <= 0) { o.grp.visible = false; }
      const gf = g.fade * past;
      const isCur = g === cur, w = g.w, looked = isCur && st && st.looked, reveal = looked || g.passed;
      const memLane = isCur && st ? st.memoryLane : -1, cert = isCur && st ? st.certified : false;
      const near = clamp(1 - g.d / 10, 0, 1);
      for (let l = 0; l < 3; l++) {
        const L = o.lanes[l], isT = l === w.truthLane, isG = l === w.guessLane;
        let kind, fc, fo, po, pc, wo;
        if (reveal) {
          if (isT) { kind = "open"; const bad = g.passed && g.res && !g.res.ok, lk = g.passed && g.res && g.res.looked; fc = bad ? 0xff4f6a : lk ? 0x6bdcff : 0x5dffa0; fo = 1; po = 0.08; pc = fc; wo = 1; }
          else { kind = "wall"; fc = 0xff4fd8; fo = 1; po = 0.55; pc = 0x7a1070; wo = 1; }
        } else if (isG) {
          const warn = isCur && memLane >= 0 && !cert;
          kind = cert ? "cert" : warn ? "warn" : "guess"; fc = cert ? 0x5dffa0 : warn ? 0xff4f6a : 0x6bdcff;
          fo = warn ? (window.__RM || Math.sin(G.time * 12) > -0.2 ? 1 : 0.25) : 1; po = cert ? 0.12 : 0.06; pc = fc; wo = 1;
        } else { kind = "dim"; fc = 0x3a5aa8; fo = 0.45; po = 0.02; pc = 0x3a5aa8; wo = 0.55; }
        if (!L.word.material.map) { L.word.material.map = wordTex(w.lanes[l]); L.word.material.needsUpdate = true; }
        if (L.kind !== kind) { L.word.material.color.setHex(WORDCOL[kind]); L.kind = kind; }
        L.frame.material.color.setHex(fc); L.frame.material.opacity = fo * (0.35 + 0.65 * near) * gf;
        L.panel.material.color.setHex(pc); L.panel.material.opacity = po * gf;
        L.word.material.opacity = wo * clamp((near - 0.05) * 2.2, 0, 1) * gf;
        L.g.visible = !(g.passed && g.res && !g.res.ok && l === g.res.lane && o.shattered);
      }
      o.marker.visible = isCur && memLane >= 0 && !reveal;
      if (o.marker.visible) { o.marker.position.set((memLane - 1) * LANE, 2.6 + Math.sin(G.time * 4) * 0.15, 0); o.marker.rotation.y = G.time * 2; }
      // pass events
      if (g.passed && !prevPassed.has(g)) {
        prevPassed.add(g);
        const lx = (g.res.lane - 1) * LANE;
        if (g.res.ok) burst(lx, ALT, o.grp.position.z, g.res.looked ? 0x6bdcff : 0x5dffa0, 60, 9);
        else { shatter(lx, ALT, o.grp.position.z); o.shattered = true; burst(lx, ALT, o.grp.position.z, 0xff4f6a, 90, 14); camShake = 1; }
      }
    }
    let removed = false;
    for (const [g, o] of gateObjs) if (!G.gates.includes(g)) { scene.remove(o.grp); o.grp.traverse((m) => { if (m.material && m.material !== edgeMat) m.material.dispose(); }); gateObjs.delete(g); prevPassed.delete(g); removed = true; }
    if (removed && gateObjs.size === 0) clearWordTex();

    // bursts
    for (let i = 0; i < BN; i++) { if (bLife[i] <= 0) continue; bLife[i] -= dt * 1.4; bPos[i * 3] += bVel[i * 3] * dt; bPos[i * 3 + 1] += bVel[i * 3 + 1] * dt; bPos[i * 3 + 2] += bVel[i * 3 + 2] * dt + moving * ZK * dt; bVel[i * 3 + 1] -= 6 * dt; }
    bGeo.attributes.position.needsUpdate = true; bGeo.attributes.life.needsUpdate = true; bGeo.attributes.col.needsUpdate = true;
    for (let i = shards.length - 1; i >= 0; i--) { const m = shards[i]; const u = m.userData; u.life -= dt * 0.9; m.position.addScaledVector(u.v, dt); m.position.z += moving * ZK * dt; u.v.y -= 14 * dt;
      m.rotation.x += u.r.x * dt; m.rotation.y += u.r.y * dt; m.material.opacity = Math.max(0, u.life); if (u.life <= 0) { scene.remove(m); m.material.dispose(); shards.splice(i, 1); } }

    // camera
    camShake = window.__RM ? 0 : Math.max(camShake - dt * 2.2, G.shake * 0.8);
    const title = G.screen === "title";
    const tx = title ? Math.sin(G.time * 0.25) * 4 : px * 0.25, ty = title ? ALT + 8 : ALT + 3.4, tz = title ? 18 : 13.5;
    camPos.x = lerp(camPos.x, tx, Math.min(1, dt * 4)); camPos.y = lerp(camPos.y, ty, Math.min(1, dt * 3)); camPos.z = lerp(camPos.z, tz, Math.min(1, dt * 3));
    camera.position.copy(camPos);
    if (camShake > 0) { camera.position.x += (Math.random() - 0.5) * 0.8 * camShake; camera.position.y += (Math.random() - 0.5) * 0.6 * camShake; }
    camera.lookAt(px * 0.2, ALT + (title ? 3 : 1.6), -60);
    camera.rotation.z += bank * 0.12;
    const fovT = (G.screen === "play" ? 64 : 58) + G.flash * 6;
    camera.fov = lerp(camera.fov, fovT, Math.min(1, dt * 4)); camera.updateProjectionMatrix();

    if (window.__dbgNoGround !== undefined) { ground.visible = !window.__dbgNoGround; for (const t of tiles) t.visible = !window.__dbgNoCity; }
    composer.render(dt);
  }
  function setLow(on) { bloom.enabled = !on; }
  return { resize, frame, renderer, setLow };
}
