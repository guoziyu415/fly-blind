/* Fly Blind / 目を閉じて飛べ: renderer, game loop and UI. Needs window.LG (core.js), window.DATA, window.T (strings). */
(function () {
  "use strict";
  const LG = window.LG, DATA = window.DATA, STR = window.STR;
  const Q = new URLSearchParams(location.search);
  const REC = Q.get("rec") === "1";
  const RM = !REC && window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.__RM = RM;
  const $ = (s) => document.querySelector(s);

  // ---------- language ----------
  let lang = Q.get("lang") || (((navigator.language || "en").toLowerCase().startsWith("ja")) ? "ja" : "en");
  if (!STR[lang]) lang = "en";
  const t = (k, v) => { let s = (STR[lang][k] !== undefined ? STR[lang][k] : STR.en[k]); if (v) for (const x in v) s = s.split("{" + x + "}").join(v[x]); return s; };

  // ---------- canvas ----------
  const W = 270, H = 480;               // low-res pixel buffer
  const HY = 150;                       // horizon
  const GROUND = 362;                   // where the plane flies
  const view = $("#view"), vctx = view.getContext("2d");
  const buf = document.createElement("canvas"); buf.width = W; buf.height = H;
  const b = buf.getContext("2d");
  let scale = 2, cssW = 270, cssH = 480, dpr = 1;
  function resize() {
    const box = $("#stage").getBoundingClientRect();
    dpr = Math.min(3, window.devicePixelRatio || 1);
    cssW = box.width; cssH = box.height;
    view.width = Math.round(cssW * dpr); view.height = Math.round(cssH * dpr);
    view.style.width = cssW + "px"; view.style.height = cssH + "px";
    scale = cssW / W;
    if (window.S3D) window.S3D.resize(cssW, cssH, G && G.lowQ ? 1 : Math.min(/Mobi|iPhone|Android/.test(navigator.userAgent) ? 1.5 : 2, dpr));
  }
  window.addEventListener("resize", resize);

  // ---------- palette ----------
  const PAL = {
    night: { sky: ["#04060f", "#071026", "#0b1838", "#11224a"], city: "#0d1838", city2: "#0a1430", win: "#2c4a7a", road: "#050a18", line: "#1d3a66", fog: "rgba(5,6,15,0)" },
    neon:  { sky: ["#140a2e", "#2b0f4d", "#561a6b", "#a03a7a"], city: "#1a0f35", city2: "#25124a", win: "#ffd36b", road: "#0d0820", line: "#ff4fd8", fog: "rgba(255,80,200,0.06)" }
  };

  // ---------- deterministic stars/buildings ----------
  const R0 = LG.rng(415);
  const stars = Array.from({ length: 70 }, () => [Math.floor(R0() * W), Math.floor(R0() * (HY - 20)), R0()]);
  function makeSkyline(n, minH, maxH, seed) {
    const R = LG.rng(seed); const out = []; let x = -10;
    while (x < W + 10) { const w = 10 + Math.floor(R() * 18), h = minH + Math.floor(R() * (maxH - minH)); const wins = [];
      for (let yy = 4; yy < h - 3; yy += 4) for (let xx = 2; xx < w - 2; xx += 3) if (R() < 0.42) wins.push([xx, yy, R()]);
      out.push({ x: x, w: w, h: h, wins: wins, ant: R() < 0.2 }); x += w + Math.floor(R() * 3); }
    return out;
  }
  const far = makeSkyline(0, 18, 46, 7), near = makeSkyline(0, 30, 78, 11);

  // ---------- perspective ----------
  const DMAX = 10;                          // gate spawn distance
  function sAt(d) { return 1 / (1 + d * 0.9); }  // 1 at plane, ~0.1 at DMAX
  const ROADW = 250;                        // road width at s=1
  function yAt(d) { const s = sAt(d); return HY + (GROUND - HY) * s; }
  function laneX(lane, s) { return W / 2 + (lane - 1) * (ROADW / 3) * s; }

  // ---------- state ----------
  const G = {
    screen: "title", time: 0, eye: 0, eyeTarget: 0, blink: 0, flash: 0, shake: 0,
    levels: [], li: 0, level: null, sess: null, lown: null, lownI: 0,
    gates: [], speed: 1, planeX: 1, planeTarget: 1, override: -1, results: [], words: [],
    iris: 0, irisImg: null, memImg: null, memAge: 0, particles: [], combo: 0, toast: null, sound: false,
    countdown: 0, introT: 0, ghostX: 1, ghostLook: 0, totalLown: null, day: 1, dateStr: ""
  };
  window.__g = G;

  // ---------- images ----------
  const IMG = {};
  function imgFor(item) {
    if (!item.image) return null;
    if (!IMG[item.id]) { const im = new Image(); im.decoding = "async"; im.src = (window.IMG_BASE || "") + item.image; IMG[item.id] = im; }
    return IMG[item.id];
  }

  // ---------- sound (off by default) ----------
  let ac = null;
  function beep(f, d, type, v) {
    if (!G.sound || REC) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type || "square"; o.frequency.value = f; g.gain.value = v || 0.05;
      o.connect(g); g.connect(ac.destination); const n = ac.currentTime;
      g.gain.setValueAtTime(v || 0.05, n); g.gain.exponentialRampToValueAtTime(0.0001, n + d);
      o.start(n); o.stop(n + d + 0.02);
    } catch (e) {}
  }
  function buzz(ms) { if (!REC && navigator.vibrate) try { navigator.vibrate(ms); } catch (e) {} }

  // ---------- level flow ----------
  function todayStr() {
    if (Q.get("date")) return Q.get("date");
    const d = new Date(Date.now() + 9 * 3600 * 1000); // Japan date
    return d.toISOString().slice(0, 10);
  }
  function setupDaily() {
    G.dateStr = todayStr(); G.day = Math.max(1, LG.dayNumber(G.dateStr));
    const items = LG.daily(DATA.items, G.dateStr, lang);
    G.levels = items.map((it, i) => ({ item: it, level: LG.buildLevel(it), speed: [0.85, 1.05, 1.3][i] || 1.3 }));
    G.results = []; G.li = 0;
  }
  function startLevel(i) {
    const L = G.levels[i]; G.li = i; G.level = L.level; G.item = L.item; G.speed = L.speed;
    G.sess = new LG.Session(L.level); G.lown = LG.playLOWN(L.level); G.lownI = 0;
    G.words = L.level.tokens.map((w, i) => (w === null ? undefined : (L.level.auto[i] ? { word: w, ok: true, looked: false, auto: true } : null))); G.space = L.level.space; G.tipCert = false; G.tipWarn = false;
    G.gates = L.level.walls.map((w, k) => ({ w: w, d: 6.5 + k * 2.7, passed: false, res: null, fade: 1 }));
    G.planeX = 1; G.planeTarget = 1; G.override = -1; G.ghostX = 1; G.eye = 0; G.eyeTarget = 0; G.combo = 0;
    G.memImg = null; G.memAge = 0; G.iris = 0;
    imgFor(L.item);
    G.screen = "intro"; G.introT = 0; showIntro();
  }
  function current() { return G.gates.find((g) => !g.passed) || null; }

  // ---------- actions ----------
  function doLook() {
    if (G.screen !== "play") return;
    const g = current(); if (!g || g.d > DMAX - 0.5) return;
    if (G.sess.look()) {
      G.eyeTarget = 1; G.blink = RM ? 0 : 1; G.flash = RM ? 0 : 1; G.iris = 1; G.irisImg = imgFor(G.item); G.memImg = G.irisImg; G.memAge = 0;
      showIris(G.irisImg);
      G.override = -1; beep(880, 0.12, "triangle", 0.06); beep(1320, 0.1, "triangle", 0.04); buzz(15);
      ui();
    }
  }
  let irisTimer = null;
  function showIris(im) {
    const el = $("#iris"), img = el.querySelector("img");
    if (im && im.src) { img.src = im.src; img.style.display = "block"; el.classList.remove("noimg"); } else { img.style.display = "none"; el.classList.add("noimg"); }
    el.classList.add("show"); clearTimeout(irisTimer);
    if (!REC) irisTimer = setTimeout(() => el.classList.remove("show"), 1100); else G.irisUntil = G.time + 1.1;
  }
  function steer(dir) {
    if (G.screen !== "play") return;
    const base = G.override >= 0 ? G.override : Math.round(G.planeTarget);
    G.override = Math.max(0, Math.min(2, base + dir)); beep(440, 0.05, "square", 0.03);
  }
  window.__act = { look: doLook, left: () => steer(-1), right: () => steer(1) };

  function passGate(g) {
    const lane = Math.max(0, Math.min(2, Math.round(G.planeX)));
    const st = G.sess.state();
    const r = G.sess.pass(lane); g.passed = true; g.res = r;
    G.words[g.w.pos] = { word: r.word, ok: r.ok, looked: r.looked };
    if (r.ok) { G.combo = r.looked ? 0 : G.combo + 1; beep(r.looked ? 660 : 520 + Math.min(6, G.combo) * 60, 0.08, "square", 0.04); burst(laneX(lane, 1), yAt(0) - 18, r.looked ? "#6bdcff" : "#5dffa0", 10); }
    else { G.combo = 0; G.shake = RM ? 0 : 1; beep(110, 0.25, "sawtooth", 0.07); buzz(60); burst(laneX(lane, 1), yAt(0) - 18, "#ff4f6a", 22); }
    G.eyeTarget = 0; G.override = -1; G.memAge++;
    // ghost
    const lr = G.lown.log[G.lownI++]; if (lr && lr.action === "look") G.ghostLook = 1;
    ui();
    if (G.sess.done()) setTimeout(endLevel, REC ? 0 : 700), G.endAt = G.time + 0.7;
  }
  function burst(x, y, c, n) { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = 20 + Math.random() * 60; G.particles.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, life: 0.6 + Math.random() * 0.4, c: c }); } }
  if (REC) { // deterministic particles in recording
    let rr = LG.rng(99); Math.random = () => rr();
  }

  function endLevel() {
    if (G.screen !== "play") return;
    const me = G.sess.result(), lown = G.lown, all = LG.playAlways(G.level);
    G.results[G.li] = { me: me, lown: lown, all: all, item: G.item, level: G.level, words: G.words.slice() };
    G.screen = "result"; showResult();
  }

  // ---------- update ----------
  function update(dt) {
    G.time += dt;
    if (G.screen === "title") { G.eyeTarget = 1; }
    G.eye += (G.eyeTarget - G.eye) * Math.min(1, dt * 14);
    G.blink = Math.max(0, G.blink - dt * 5); G.flash = Math.max(0, G.flash - dt * 3); G.shake = Math.max(0, G.shake - dt * 3);
    G.iris = Math.max(0, G.iris - dt * 0.9);
    if (REC && G.irisUntil && G.time > G.irisUntil) { $("#iris").classList.remove("show"); G.irisUntil = 0; }
    const cdEl = $("#cd"); if (G.screen === "countdown") { cdEl.textContent = G.countdown > 0.8 ? "3" : G.countdown > 0.4 ? "2" : "1"; cdEl.classList.add("show"); } else cdEl.classList.remove("show"); G.ghostLook = Math.max(0, G.ghostLook - dt * 1.6);
    for (const p of G.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt; p.life -= dt; }
    G.particles = G.particles.filter((p) => p.life > 0);
    if (G.screen === "countdown") { G.countdown -= dt; if (G.countdown <= 0) { G.screen = "play"; hideOverlays(); ui(); } }
    if (G.screen === "play" || G.screen === "countdown") {
      const v = (G.screen === "play" ? 1 : 0.25) * 1.15 * G.speed;
      for (const g of G.gates) { g.d -= v * dt; if (g.passed) g.fade = Math.max(0, g.fade - dt * 2.5); }
      const c = current();
      if (c) {
        const st = G.sess.state();
        let target = st.looked ? st.wall.truthLane : (st.wall.guessLane >= 0 ? st.wall.guessLane : 1);
        if (G.override >= 0) target = G.override;
        G.planeTarget = target;
        if (G.screen === "play" && c.d <= 0) passGate(c);
        // ghost target
        const lr = G.lown.log[G.lownI]; if (lr) G.ghostX += (lr.lane - G.ghostX) * Math.min(1, dt * 6);
      }
      G.planeX += (G.planeTarget - G.planeX) * Math.min(1, dt * 9);
    }
  }

  // ---------- drawing helpers ----------
  function mix(a, b2, k) { // hex mix
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b2.slice(1), 16);
    const r = ((pa >> 16) & 255) * (1 - k) + ((pb >> 16) & 255) * k, g = ((pa >> 8) & 255) * (1 - k) + ((pb >> 8) & 255) * k, bb = (pa & 255) * (1 - k) + (pb & 255) * k;
    return "rgb(" + (r | 0) + "," + (g | 0) + "," + (bb | 0) + ")";
  }
  function rect(x, y, w, h, c) { b.fillStyle = c; b.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
  function dashedRect(x, y, w, h, c, dash) {
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h); b.fillStyle = c; const d = dash || 2;
    for (let i = 0; i < w; i++) if (((i / d) | 0) % 2 === 0) { b.fillRect(x + i, y, 1, 1); b.fillRect(x + i, y + h - 1, 1, 1); }
    for (let j = 0; j < h; j++) if (((j / d) | 0) % 2 === 0) { b.fillRect(x, y + j, 1, 1); b.fillRect(x + w - 1, y + j, 1, 1); }
  }

  function drawScene() {
    const e = G.eye, P = PAL;
    // sky bands with dither
    const bands = 4, bh = HY / bands;
    for (let i = 0; i < bands; i++) rect(0, i * bh, W, bh + 1, mix(P.night.sky[i], P.neon.sky[i], e));
    for (let i = 0; i < bands - 1; i++) { const y0 = Math.round((i + 1) * bh) - 2; b.fillStyle = mix(P.night.sky[i + 1], P.neon.sky[i + 1], e);
      for (let x = (i % 2); x < W; x += 2) b.fillRect(x, y0, 1, 1); for (let x = ((i + 1) % 2); x < W; x += 2) b.fillRect(x, y0 - 2, 1, 1); }
    // stars
    for (const s of stars) { const tw = 0.5 + 0.5 * Math.sin(G.time * 2 + s[2] * 40); if (tw > 0.3) rect(s[0], s[1], 1, 1, e > 0.5 ? "#ffd1f3" : (s[2] > 0.7 ? "#8fa2d8" : "#3a4570")); }
    // moon
    const mx = 210, my = 34; b.fillStyle = mix("#3b4466", "#ffe9a8", e); b.beginPath(); b.arc(mx, my, 11, 0, 7); b.fill();
    b.fillStyle = mix(P.night.sky[0], P.neon.sky[0], e); b.beginPath(); b.arc(mx + 5, my - 3, 9, 0, 7); b.fill();
    // skyline far (parallax drift)
    const drift = (G.time * 3) % 40;
    for (const k of far) { const x = ((k.x - drift + W + 40) % (W + 40)) - 20; rect(x, HY - k.h * 0.7, k.w, k.h * 0.7, mix(P.night.city2, P.neon.city2, e)); }
    for (const k of near) { const x = k.x; const top = HY - k.h; rect(x, top, k.w, k.h, mix(P.night.city, P.neon.city, e));
      for (const wv of k.wins) { const on = e > 0.5 ? wv[2] < 0.75 : wv[2] < 0.18; if (on) rect(x + wv[0], top + wv[1], 1, 2, e > 0.5 ? (wv[2] < 0.15 ? "#6bdcff" : "#ffd36b") : "#2a3352"); }
      if (k.ant) { rect(x + k.w / 2, top - 6, 1, 6, mix("#1a2140", "#c070ff", e)); if (Math.sin(G.time * 4 + k.x) > 0) rect(x + k.w / 2 - 1, top - 7, 3, 2, e > 0.3 ? "#ff4fd8" : "#5a1a30"); } }
    // ground
    for (let y = HY; y < H; y++) { const k = (y - HY) / (H - HY); rect(0, y, W, 1, mix(mix("#04050b", "#0b061a", e), mix("#080a14", "#1a0b30", e), k)); }
    // road
    const roadL = (y) => { const k = (y - HY) / (GROUND - HY); return W / 2 - (ROADW / 2) * k * 1.0; };
    for (let y = HY + 1; y < H; y++) { const k = (y - HY) / (GROUND - HY); const hw = (ROADW / 2) * k * 1.08; rect(W / 2 - hw, y, hw * 2, 1, mix(P.night.road, P.neon.road, e)); }
    // moving stripes on road edges and lane dividers
    const phase = (G.time * 1.15 * (G.screen === "title" ? 1.4 : G.speed)) % 1;
    for (let i = 0; i < 26; i++) {
      const d = (i - phase) * 0.45; if (d < -0.3) continue; const s = sAt(d), y = yAt(d), s2 = sAt(d + 0.2), y2 = yAt(d + 0.2);
      const hw = (ROADW / 2) * s * 1.08;
      if (i % 2 === 0) {
        rect(W / 2 - hw - 1, y2, 2, Math.max(1, y - y2), mix("#1b2340", "#ff4fd8", e));
        rect(W / 2 + hw - 1, y2, 2, Math.max(1, y - y2), mix("#1b2340", "#ff4fd8", e));
        for (const lx of [-1, 1]) { const x = W / 2 + lx * (ROADW / 6) * s * 1.08; rect(x, y2, 1, Math.max(1, y - y2), mix("#151b33", "#7a3cff", e)); }
      }
    }
    // ground grid beside the road
    for (let i = 0; i < 18; i++) { const d = (i - phase) * 0.7; if (d < -0.2) continue; const y = Math.round(yAt(d)); const s2 = sAt(d); const hw = (ROADW / 2) * s2 * 1.08; b.fillStyle = mix("#0c1a3a", "#3a145e", e); b.fillRect(0, y, Math.max(0, W / 2 - hw - 2), 1); b.fillRect(W / 2 + hw + 2, y, W, 1); }
    for (let k = -6; k <= 6; k++) { if (k === 0) continue; b.fillStyle = mix("#0b1736", "#30104f", e); for (let y = HY + 2; y < H; y += 2) { const kk = (y - HY) / (GROUND - HY); const x = W / 2 + k * 34 * kk * 1.08; if (Math.abs(x - W / 2) > (ROADW / 2) * kk * 1.08 + 2) b.fillRect(Math.round(x), y, 1, 1); } }
    // horizon glow
    if (e > 0.05) { b.fillStyle = "rgba(255,79,216," + (0.25 * e) + ")"; b.fillRect(0, HY - 2, W, 3); }
  }

  function drawGate(g, isCur) {
    if (g.d > DMAX + 0.01 || g.d < -0.6 || g.fade <= 0) return;
    const s = sAt(Math.max(0, g.d)), yb = yAt(Math.max(0, g.d)) - (g.d < 0 ? g.d * 60 : 0);
    const pw = (ROADW / 3) * s * 1.06, ph = Math.max(3, 86 * s), w = g.w;
    const st = isCur ? G.sess.state() : null;
    const looked = isCur && st && st.looked;
    const reveal = looked || g.passed;
    const memLane = isCur && st ? st.memoryLane : -1;
    const cert = isCur && st ? st.certified : false;
    b.globalAlpha = g.fade;
    for (let lane = 0; lane < 3; lane++) {
      const cx = laneX(lane, s), x = cx - pw / 2 + 1, y = yb - ph;
      const isTruth = lane === w.truthLane, isGuess = lane === w.guessLane;
      if (reveal) {
        if (isTruth) { // open gate
          const c = g.passed && g.res && !g.res.ok ? "#ff4f6a" : (g.passed && g.res && g.res.looked ? "#6bdcff" : "#5dffa0");
          rect(x, y, 2, ph, c); rect(x + pw - 4, y, 2, ph, c); rect(x, y, pw - 2, 2, c);
          b.fillStyle = "rgba(93,255,160,0.10)"; b.fillRect(x + 2, y + 2, pw - 6, ph - 2);
        } else { // wall
          rect(x, y, pw - 2, ph, "#3a0f3c"); rect(x, y, pw - 2, 2, "#ff4fd8");
          for (let yy = y + 4; yy < y + ph - 2; yy += Math.max(3, 6 * s)) rect(x + 1, yy, pw - 4, 1, "#5a1a5c");
        }
      } else {
        // eyes closed: only faint outlines; the text-only guess shows as a dashed opening
        if (isGuess) {
          const c = cert ? "#5dffa0" : (isCur && memLane >= 0 ? "#ff4f6a" : "#6bdcff");
          const blinkOn = !(isCur && !cert && memLane >= 0) || Math.sin(G.time * 12) > -0.2;
          if (blinkOn) { dashedRect(x, y, pw - 2, ph, c, cert ? 1000 : 2); dashedRect(x + 1, y + 1, pw - 4, ph - 2, c, cert ? 1000 : 2); }
          if (cert) { b.fillStyle = "rgba(93,255,160,0.12)"; b.fillRect(x + 1, y + 1, pw - 4, ph - 2); }
        } else { dashedRect(x, y, pw - 2, ph, "#34477a", 2); }
        if (isCur && lane === memLane && G.eye < 0.5) { // memory marker: amber diamond above
          const mx = cx, my = y - 6 * s - 3; rect(mx - 1, my - 2, 2, 1, "#ffb648"); rect(mx - 2, my - 1, 4, 2, "#ffb648"); rect(mx - 1, my + 1, 2, 1, "#ffb648");
        }
      }
    }
    b.globalAlpha = 1;
  }

  function drawPlane(xLane, y, ghost) {
    const s = 1, x = laneX(xLane, s);
    const body = ghost ? "#6bdcff" : (G.eye > 0.5 ? "#ffffff" : "#c9d2ff"), wing = ghost ? "#2a8fb8" : (G.eye > 0.5 ? "#ff4fd8" : "#5a6aa8");
    const k = ghost ? 0.9 : 1.45, X = (v) => x + v * k, Y = (v) => y + v * k;
    b.globalAlpha = ghost ? 0.45 : 1;
    rect(X(-1), Y(-12), 3 * k, 18 * k, body); rect(X(-12), Y(-2), 25 * k, 3 * k, wing); rect(X(-5), Y(4), 11 * k, 2 * k, wing);
    rect(X(0), Y(-14), 1 * k, 2 * k, body); rect(X(-1), Y(-8), 3 * k, 3 * k, ghost ? "#1d5d7a" : (G.eye > 0.5 ? "#6bdcff" : "#3a4a8a")); rect(X(-12), Y(-3), 2 * k, 1 * k, ghost ? "#6bdcff" : "#ff4f6a"); rect(X(11), Y(-3), 2 * k, 1 * k, ghost ? "#6bdcff" : "#5dffa0");
    if (!ghost) { const fl = (G.time * 20 | 0) % 2; rect(X(-1), Y(6), 3 * k, (2 + fl) * k, "#ffb648"); rect(X(0), Y(8 + fl), 1 * k, 2 * k, "#ff4f6a"); }
    b.globalAlpha = 1;
  }

  function drawEyelids() {
    const k = G.eye, closed = 1 - k;
    // vignette when closed
    if (closed > 0.05) {
      const gr = b.createRadialGradient(W / 2, H * 0.55, H * 0.18, W / 2, H * 0.55, H * 0.75);
      gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,6," + (0.75 * closed) + ")");
      b.fillStyle = gr; b.fillRect(0, 0, W, H);
      b.fillStyle = "rgba(0,0,0," + (0.22 * closed) + ")";
      for (let y = 0; y < H; y += 2) b.fillRect(0, y, W, 1); // scanlines
    }
    if (G.blink > 0) { const h = Math.round(H / 2 * Math.sin(G.blink * Math.PI)); rect(0, 0, W, h, "#000"); rect(0, H - h, W, h, "#000"); }
  }

  function render() {
    if (window.S3D) { window.S3D.frame(G, G.time); return; }
    b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, W, H);
    const sx = G.shake > 0 ? (Math.random() - 0.5) * 6 * G.shake : 0, sy = G.shake > 0 ? (Math.random() - 0.5) * 6 * G.shake : 0;
    b.setTransform(1, 0, 0, 1, Math.round(sx), Math.round(sy));
    drawScene();
    const cur = current();
    const gs = G.gates.slice().sort((a, c) => c.d - a.d);
    for (const g of gs) drawGate(g, g === cur);
    if (G.screen === "play" || G.screen === "countdown" || G.screen === "result") {
      drawPlane(G.ghostX, yAt(0) + 2 - 30, true);
      drawPlane(G.planeX, yAt(0) + 6, false);
      if (G.ghostLook > 0) { const x = laneX(G.ghostX, 1), y = yAt(0) - 52 - (1 - G.ghostLook) * 8; b.globalAlpha = G.ghostLook; rect(x - 4, y, 9, 4, "#6bdcff"); rect(x - 1, y + 1, 3, 2, "#05060f"); b.globalAlpha = 1; }
    }
    { const sp = (G.screen === "play" ? 1 : G.screen === "title" ? 1.2 : 0.3); const R = LG.rng(7);
      for (let i = 0; i < 26; i++) { const lane = R() < 0.5 ? -1 : 1, off = 0.55 + R() * 0.9, ph2 = (R() + G.time * 0.35 * sp) % 1; const d = DMAX * (1 - ph2); const s3 = sAt(d), y = yAt(d), x = W / 2 + lane * (ROADW / 2) * off * s3 * 1.08;
        const len = Math.max(1, 10 * s3 * s3); b.globalAlpha = Math.min(1, s3 * 1.4) * 0.8; rect(x, y - len, 1, len, G.eye > 0.5 ? "#ff9bf0" : "#4a6fb0"); }
      b.globalAlpha = 1; }
    for (const p of G.particles) { b.globalAlpha = Math.max(0, Math.min(1, p.life * 1.5)); rect(p.x, p.y, 2, 2, p.c); }
    b.globalAlpha = 1;
    drawEyelids();
    if (G.flash > 0) { b.fillStyle = "rgba(255,255,255," + (0.5 * G.flash * G.flash) + ")"; b.fillRect(0, 0, W, H); }

    // compose to the view at device resolution
    vctx.setTransform(1, 0, 0, 1, 0, 0);
    vctx.imageSmoothingEnabled = false;
    vctx.fillStyle = "#05060f"; vctx.fillRect(0, 0, view.width, view.height);
    const sc = view.width / W, oy = (view.height - H * sc) / 2;
    vctx.drawImage(buf, 0, 0, W, H, 0, Math.round(oy), Math.round(W * sc), Math.round(H * sc));
    drawWords(sc, oy);
    if (!document.getElementById("iris")) drawIris(sc, oy);
  }

  // words on gates, at full resolution so they stay readable
  function drawWords(sc, oy) {
    const cur = current();
    const font = lang === "ja" ? "'DotGothic16', monospace" : "'DotGothic16', 'Press Start 2P', monospace";
    vctx.textAlign = "center"; vctx.textBaseline = "middle";
    const gs = G.gates.slice().sort((a, c) => c.d - a.d);
    for (const g of gs) {
      if (g.d > DMAX || g.d < -0.6 || g.fade <= 0) continue;
      const s = sAt(Math.max(0, g.d)); if (s < 0.16) continue;
      const yb = yAt(Math.max(0, g.d)) - (g.d < 0 ? g.d * 60 : 0), ph = Math.max(3, 86 * s);
      const isCur = g === cur, st = isCur ? G.sess.state() : null, reveal = (isCur && st && st.looked) || g.passed;
      const size = Math.max(7, 17 * s) * sc;
      vctx.font = Math.round(size) + "px " + font;
      for (let lane = 0; lane < 3; lane++) {
        const word = g.w.lanes[lane]; if (!word) continue;
        const isTruth = lane === g.w.truthLane, isGuess = lane === g.w.guessLane;
        let col;
        if (reveal) col = isTruth ? "#eafff2" : "#ffb3ef";
        else col = isGuess ? (st && st.certified ? "#b9ffd6" : (st && st.memory !== null ? "#ffc2cc" : "#cfefff")) : "rgba(150,170,230,0.62)";
        const a = Math.min(1, (s - 0.16) / 0.2) * g.fade;
        vctx.globalAlpha = a;
        const x = laneX(lane, s) * sc, y = oy + (yb - ph / 2) * sc;
        let txt = word.length > 9 ? word.slice(0, 8) + "…" : word;
        vctx.fillStyle = "rgba(0,0,0,0.6)"; vctx.fillText(txt, x + sc * 0.6, y + sc * 0.6);
        vctx.fillStyle = col; vctx.fillText(txt, x, y);
      }
      vctx.globalAlpha = 1;
    }
  }

  // the photo seen through the "eye" when the player looks
  function drawIris(sc, oy) {
    const im = G.irisImg; if (!im || !im.complete || !im.naturalWidth || G.iris <= 0) return;
    const k = G.iris; const open = Math.min(1, (1 - k) * 6), close = Math.min(1, k * 3); const a = Math.min(open, close);
    const r = (W * 0.36) * sc * (0.6 + 0.4 * a), cx = view.width / 2, cy = oy + 92 * sc;
    vctx.save(); vctx.globalAlpha = a; vctx.beginPath(); vctx.ellipse(cx, cy, r, r * 0.62, 0, 0, Math.PI * 2); vctx.clip();
    const ar = im.naturalWidth / im.naturalHeight, h = r * 1.3, w = h * ar;
    vctx.imageSmoothingEnabled = true; vctx.drawImage(im, cx - w / 2, cy - h / 2, w, h); vctx.restore();
    vctx.save(); vctx.globalAlpha = a; vctx.strokeStyle = "#6bdcff"; vctx.lineWidth = 2 * sc; vctx.beginPath(); vctx.ellipse(cx, cy, r, r * 0.62, 0, 0, Math.PI * 2); vctx.stroke(); vctx.restore();
  }

  // ---------- DOM UI ----------
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function ui() {
    if (!G.level) return;
    const L = G.level, done = G.sess.i;
    $("#hud-step").textContent = String(Math.min(done + 1, L.walls.length)).padStart(2, "0") + "/" + String(L.walls.length).padStart(2, "0");
    $("#hud-looks").textContent = G.sess.looks; $("#hud-miss").textContent = G.sess.mistakes;
    $("#hud-lv").textContent = t("lv", { n: G.li + 1 });
    const sp = G.space;
    const chips = G.words.map((w, i) => (w === undefined ? "" : (w ? '<span class="chip ' + (w.auto ? "au" : w.ok ? (w.looked ? "lk" : "ok") : "ng") + (sp && i > 0 && !sp[i] ? " join" : "") + '">' + esc(w.word) + "</span>" : '<span class="chip m' + (sp && i > 0 && !sp[i] ? " join" : "") + '">&nbsp;&nbsp;</span>'))).join("");
    $("#hud-sent").innerHTML = chips;
    const st = G.sess.state();
    if (G.screen === "play" && st && G.li === 0 && !REC) {
      if (st.certified && !st.looked && !G.tipCert) { G.tipCert = true; toast(t("tipCert")); }
      else if (st.memory !== null && !st.certified && !st.looked && !G.tipWarn) { G.tipWarn = true; toast(t("tipWarn")); }
    }
    const hint = $("#hint");
    if (G.screen === "play" && st) {
      if (st.looked) hint.textContent = t("hintLooked");
      else if (st.memory === null) hint.textContent = t("hintNoMem");
      else if (st.certified) hint.textContent = t("hintCert");
      else hint.textContent = t("hintDiff");
      hint.className = "hint " + (st.looked ? "lk" : st.memory === null ? "nm" : st.certified ? "ok" : "ng");
    } else hint.textContent = "";
    const mem = $("#mem");
    const hasMem = G.sess.mem.at >= 0;
    if (hasMem) {
      mem.classList.add("on"); $("#memwrap").classList.add("on");
      if (G.memImg) { mem.style.backgroundImage = "url('" + G.memImg.src + "')"; mem.classList.remove("noimg"); mem.textContent = ""; }
      else { mem.style.backgroundImage = "none"; mem.classList.add("noimg"); mem.textContent = "◆"; }
      mem.style.opacity = String(Math.max(0.35, 1 - G.memAge * 0.08)); $("#mem-age").textContent = G.memAge === 0 ? t("memNow") : t("memAge", { n: G.memAge });
    } else { mem.classList.remove("on"); $("#memwrap").classList.remove("on"); }
    $("#eyebtn").disabled = !(G.screen === "play" && st && !st.looked);
  }

  function hideOverlays() { document.querySelectorAll(".ov").forEach((o) => o.classList.remove("show")); document.body.classList.toggle("title-on", G.screen === "title"); document.body.classList.toggle("playing", G.screen === "play" || G.screen === "countdown"); if (G.screen !== "play") { const ir = document.getElementById("iris"); if (ir) ir.classList.remove("show"); } }
  function show(id) { hideOverlays(); document.body.classList.remove("playing"); const ir = document.getElementById("iris"); if (ir) ir.classList.remove("show"); $(id).classList.add("show"); document.body.classList.toggle("title-on", id === "#ov-title" || id === "#ov-how" && G.screen === "title"); }

  function showTitle() {
    G.screen = "title"; show("#ov-title");
    $("#t-day").textContent = t("daily", { n: G.day });
  }
  function showIntro() {
    const it = G.item;
    $("#in-lv").textContent = t("lvOf", { n: G.li + 1, m: G.levels.length });
    $("#in-q").textContent = it.question;
    $("#in-n").textContent = t("inN", { n: G.level.walls.length });
    $("#in-speed").textContent = t("speed" + (G.li + 1));
    show("#ov-intro");
  }
  function go() { G.screen = "countdown"; G.countdown = 1.2; hideOverlays(); ui(); }

  function bar(label, r, cls, steps, msF, msC) {
    const comp = (r.looks * msF + (cls === "all" ? 0 : steps * msC)) / (steps * msF);
    return '<div class="row ' + cls + '"><div class="who">' + label + '</div><div class="nums"><b>👁 ' + r.looks + "</b>/" + steps + ' <span class="x">✕ ' + r.mistakes + '</span></div><div class="meter"><i style="width:' + Math.min(100, comp * 100).toFixed(1) + '%"></i></div><div class="pct">' + Math.round(comp * 100) + "%</div></div>";
  }
  function msOf(item) { return { f: item.ms_full || 1, c: item.ms_cheap || 0 }; }
  function showResult() {
    const R = G.results[G.li], steps = R.level.walls.length, ms = msOf(R.item);
    const rank = LG.compare(R.me, R.lown);
    $("#rs-lv").textContent = t("lvOf", { n: G.li + 1, m: G.levels.length });
    $("#rs-verdict").textContent = rank < 0 ? t("vWin") : rank === 0 ? t("vTie") : t("vLose");
    $("#rs-bars").innerHTML = bar(t("you"), R.me, "me", steps, ms.f, ms.c) + bar("LOWN", R.lown, "lown", steps, ms.f, ms.c) + bar(t("always"), R.all, "all", steps, ms.f, ms.c);
    $("#rs-note").textContent = t("costNote", { p: LG.PENALTY, me: LG.cost(R.me), ai: LG.cost(R.lown) }) + " " + t("computeNote");
    const img = imgFor(R.item);
    $("#rs-img").style.backgroundImage = img ? "url('" + img.src + "')" : "none";
    $("#rs-cap").textContent = R.level.answer;
    const sp2 = R.level.space; $("#rs-yours").innerHTML = R.words.map((w, i) => (w === undefined ? "" : '<span class="chip ' + (w ? (w.auto ? "au" : w.ok ? (w.looked ? "lk" : "ok") : "ng") : "m") + (sp2 && i > 0 && !sp2[i] ? " join" : "") + '">' + (w ? esc(w.word) : "&nbsp;&nbsp;") + "</span>")).join("");
    $("#rs-next").textContent = G.li + 1 < G.levels.length ? t("next") : t("seeAll");
    show("#ov-result");
  }
  function showFinal() {
    G.screen = "final";
    const tot = { looks: 0, mistakes: 0, steps: 0 }, lt = { looks: 0, mistakes: 0, steps: 0 };
    for (const r of G.results) { tot.looks += r.me.looks; tot.mistakes += r.me.mistakes; tot.steps += r.me.steps; lt.looks += r.lown.looks; lt.mistakes += r.lown.mistakes; lt.steps += r.lown.steps; }
    G.total = tot; G.totalLown = lt;
    const rank = LG.compare(tot, lt);
    $("#fn-verdict").textContent = rank < 0 ? t("fWin") : rank === 0 ? t("fTie") : t("fLose");
    $("#fn-me").innerHTML = "👁" + tot.looks + "/" + tot.steps + "<br>✕" + tot.mistakes;
    $("#fn-lown").innerHTML = "👁" + lt.looks + "/" + lt.steps + "<br>✕" + lt.mistakes;
    $("#fn-grid").innerHTML = G.results.map((r) => '<div class="g">' + r.me.log.map((x) => '<i class="' + (!x.ok ? "ng" : x.looked ? "lk" : "ok") + '"></i>').join("") + "</div>").join("");
    G.share = LG.shareText({ levels: G.results.map((r) => r.me), total: tot, lown: lt, day: G.day, lang: lang, url: location.origin + location.pathname });
    show("#ov-final");
  }

  async function shareIt() {
    const txt = G.share;
    try { if (navigator.share && /Mobi|Android|iPhone|iPad/.test(navigator.userAgent)) { await navigator.share({ text: txt }); return; } } catch (e) { return; }
    try { await navigator.clipboard.writeText(txt); toast(t("copied")); } catch (e) { prompt("", txt); }
  }
  function toast(s) { const el = $("#toast"); el.textContent = s; el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 1600); }

  // ---------- input ----------
  function bindInput() {
    $("#eyebtn").addEventListener("click", doLook);
    $("#lbtn").addEventListener("click", () => steer(-1));
    $("#rbtn").addEventListener("click", () => steer(1));
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (G.screen === "play") {
        if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") { steer(-1); e.preventDefault(); }
        else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") { steer(1); e.preventDefault(); }
        else if (e.key === " " || e.key === "ArrowUp" || e.key === "w" || e.key === "W" || e.key === "k" || e.key === "K") { doLook(); e.preventDefault(); }
      } else if ((e.key === "Enter" || e.key === " ") && !(e.target && e.target.closest && e.target.closest("button,a,input")) && document.querySelector(".ov.show .primary")) { document.querySelector(".ov.show .primary").click(); e.preventDefault(); }
    });
    let sx = null, sy = null;
    const st = $("#stage");
    st.addEventListener("touchstart", (e) => { const p = e.touches[0]; sx = p.clientX; sy = p.clientY; }, { passive: true });
    st.addEventListener("touchend", (e) => { if (sx === null) return; const p = e.changedTouches[0], dx = p.clientX - sx, dy = p.clientY - sy;
      if (Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)) steer(dx > 0 ? 1 : -1); else if (dy < -40) doLook(); sx = null; }, { passive: true });
    $("#b-play").addEventListener("click", () => { setupDaily(); startLevel(0); });
    $("#b-how").addEventListener("click", () => show("#ov-how"));
    $("#how-back").addEventListener("click", () => showTitle());
    $("#in-go").addEventListener("click", go);
    $("#rs-next").addEventListener("click", () => { if (G.li + 1 < G.levels.length) startLevel(G.li + 1); else showFinal(); });
    $("#fn-share").addEventListener("click", shareIt);
    $("#fn-again").addEventListener("click", () => { setupDaily(); startLevel(0); });
    $("#fn-learn").addEventListener("click", () => { document.querySelector("#learn").scrollIntoView({ behavior: "smooth" }); });
    $("#snd").addEventListener("click", () => { G.sound = !G.sound; $("#snd").textContent = G.sound ? "🔊" : "🔇"; if (G.sound) beep(660, 0.08, "square", 0.04); });
    document.querySelectorAll("[data-lang]").forEach((el) => el.addEventListener("click", () => { const u = new URL(location.href); u.searchParams.set("lang", el.dataset.lang); location.href = u.toString(); }));
  }

  // ---------- static texts ----------
  function applyTexts() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-t]").forEach((el) => { el.innerHTML = t(el.dataset.t); });
    document.querySelectorAll("[data-lang]").forEach((el) => el.classList.toggle("on", el.dataset.lang === lang));
    // real numbers from the data in this page
    const S = LG.stats(DATA.items.filter((x) => x.lang === lang).length >= 3 ? DATA.items.filter((x) => x.lang === lang) : DATA.items);
    const SA = LG.stats(DATA.items);
    const SM = null; // numbers are recomputed here from the gates the game shows (end-of-text steps excluded)
    const fill = SM ? { items: SM.items, steps: SM.steps, differ: (SM.differ_rate * 100).toFixed(1), looks: (SM.look_rate * 100).toFixed(1), same: SM.same_as_baseline, model: DATA.model, msf: (SM.ms_full_median / 1000).toFixed(1), msc: (SM.ms_cheap_median / 1000).toFixed(2) }
      : { items: SA.items, steps: SA.steps, differ: (SA.differRate * 100).toFixed(1), looks: (SA.lownLookRate * 100).toFixed(1), same: SA.lownSame, model: DATA.model, imgShare: DATA.items[0] && DATA.items[0].tokens_full ? Math.round((1 - DATA.items[0].tokens_cheap / DATA.items[0].tokens_full) * 100) : 94 };
    document.querySelectorAll("[data-tv]").forEach((el) => { el.innerHTML = t(el.dataset.tv, fill); });
    const cr = $("#credits");
    const LIC = { "CC0": "https://creativecommons.org/publicdomain/zero/1.0/", "Public domain": "https://commons.wikimedia.org/wiki/Commons:Public_domain", "CC BY 2.0": "https://creativecommons.org/licenses/by/2.0/", "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/", "CC BY-SA 2.0": "https://creativecommons.org/licenses/by-sa/2.0/", "CC BY-SA 3.0": "https://creativecommons.org/licenses/by-sa/3.0/", "CC BY-SA 4.0": "https://creativecommons.org/licenses/by-sa/4.0/" };
    if (cr) cr.innerHTML = DATA.items.filter((x) => x.image_credit).map((x) => { const c = x.image_credit, lu = LIC[c.license];
      return '<li>' + esc(x.id) + ' · <a href="' + esc(c.url) + '" rel="noopener" target="_blank">' + esc((c.title || x.id).replace(/^File:/, "")) + "</a>, " + esc(c.author || "") + ", " + (lu ? '<a href="' + lu + '" rel="noopener" target="_blank">' + esc(c.license) + "</a>" : esc(c.license || "")) + "</li>"; }).join("");
  }

  // ---------- loop ----------
  let last = 0;
  function frame(ts) {
    const dt = Math.min(0.05, (ts - last) / 1000 || 0); last = ts;
    if (window.S3D && !G.lowQ) { G.fpsAcc = (G.fpsAcc || 0) + dt; G.fpsN = (G.fpsN || 0) + 1; if (G.fpsAcc > 3) { if (G.fpsN / G.fpsAcc < 40) { G.lowQ = true; window.S3D.resize(cssW, cssH, 1); if (window.S3D.setLow) window.S3D.setLow(true); } G.fpsAcc = 0; G.fpsN = 0; } }
    update(dt); render();
    requestAnimationFrame(frame);
  }

  // recording hooks: manual clock and scripted input
  window.__rec = {
    tick: function (ms) { const n = Math.max(1, Math.round(ms / (1000 / 60))); for (let i = 0; i < n; i++) update(ms / 1000 / n); render(); },
    start: function (dateStr) { if (dateStr) Q.set("date", dateStr); setupDaily(); startLevel(0); go(); },
    level: function (i) { startLevel(i); go(); },
    item: function (id, speed) { const it = DATA.items.find((x) => x.id === id); G.levels = [{ item: it, level: LG.buildLevel(it), speed: speed || 1 }]; G.results = []; startLevel(0); go(); },
    state: function () { const st = G.sess && G.sess.state(); return { screen: G.screen, i: G.sess ? G.sess.i : 0, cur: current() ? current().d : null, looked: st ? st.looked : null, cert: st ? st.certified : null, mem: st ? st.memory : null }; },
    look: doLook, left: () => steer(-1), right: () => steer(1), show: show, showFinal: showFinal, setLang: (l) => { lang = l; applyTexts(); }
  };

  window.addEventListener("s3d", () => { document.body.classList.add("has3d"); resize(); render(); });
  function boot() {
    resize(); applyTexts(); bindInput();
    setupDaily();
    showTitle();
    if (REC) document.body.classList.add("rec");
    if (!REC) requestAnimationFrame(frame); else { render(); }
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => { window.__ready = true; render(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
