/* LOWN game core: level building from real traces, the LOWN rule, scoring.
   Works in the browser (window.LG) and in Node (module.exports). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LG = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Small deterministic PRNG (mulberry32) so a level looks the same for everyone.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  const top1 = (list) => (list && list.length ? list[0][0] : null);
  const top1p = (list) => (list && list.length ? list[0][1] : 0);

  /* Build a playable level from one trace item.
     Each step t of the always-look run becomes one wall.
     wall.truth  = what the image-conditioned (full) pass writes at that step (the baseline token)
     wall.guess  = what the text-only (cheap) pass predicts for the same position at the same step
     wall.lanes  = 3 candidate words: the full pass top-3, with the cheap guess forced in if missing
     wall.full   = full-pass top-1 for every masked position at this step (used to refresh memory on a look) */
  // end-of-text and padding tokens are filled automatically and never become a gate
  const isSpecial = (w) => !w || /^<\|.*\|>$/.test(w) || w === "<eos>" || w === "</s>";
  // punctuation is filled in automatically: it is shown in the sentence but never becomes a gate
  const isAuto = (w) => !!w && /^[\s.,!?;:'"。、！？…-]+$/.test(w);
  function buildLevel(item, opts) {
    opts = opts || {};
    const R = rng(hash(item.id + (opts.salt || "")));
    const walls = item.steps.filter(function (s) { const w = item.answer_tokens[s.pick]; return !isSpecial(w) && !isAuto(w); }).map(function (s) {
      const p = String(s.pick);
      const full = s.full[p] || [];
      const cheap = s.cheap[p] || [];
      const truth = item.answer_tokens[s.pick];
      const guess = top1(cheap);
      let cands = full.filter((x) => !isSpecial(x[0]) && !isAuto(x[0])).slice(0, 3).map((x) => x[0]);
      if (cands.indexOf(truth) < 0) cands[0] = truth;
      cands = cands.filter((w, i) => cands.indexOf(w) === i);
      if (guess !== null && cands.indexOf(guess) < 0) {
        if (cands.length >= 3) cands[cands.length - 1] = guess; else cands.push(guess);
      }
      const fillers = cheap.slice(1).map((x) => x[0]).concat(full.slice(3).map((x) => x[0])).filter((w) => !isSpecial(w) && !isAuto(w));
      for (const f of fillers) { if (cands.length >= 3) break; if (cands.indexOf(f) < 0) cands.push(f); }
      while (cands.length < 3) cands.push("…".repeat(cands.length));
      // deterministic shuffle
      for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); const t = cands[i]; cands[i] = cands[j]; cands[j] = t; }
      const fullTop = {};
      for (const k of Object.keys(s.full)) fullTop[k] = top1(s.full[k]);
      return {
        t: s.t, pos: s.pick, truth: truth, guess: guess,
        guessP: top1p(cheap), truthP: top1p(full),
        lanes: cands, truthLane: cands.indexOf(truth), guessLane: guess === null ? -1 : cands.indexOf(guess),
        full: fullTop
      };
    });
    return { id: item.id, lang: item.lang, scene: item.scene, question: item.question, L: item.L,
      answer: item.answer, tokens: item.answer_tokens.map((w) => (isSpecial(w) ? null : w)), auto: item.answer_tokens.map((w) => isAuto(w)), space: item.answer_token_space || null, walls: walls, joiner: item.lang === "ja" ? "" : " " };
  }

  /* Memory = the full-pass prediction stored at the last look, for every position masked at that time. */
  function newMemory() { return { at: -1, map: {} }; }
  function look(memory, wall) { memory.at = wall.t; memory.map = Object.assign({}, wall.full); return memory; }
  function memoryAt(memory, wall) { return memory.at < 0 ? null : (memory.map[String(wall.pos)] || null); }

  /* LOWN's certification condition for one position: the text-only guess agrees with the stored image-conditioned prediction. */
  function certified(memory, wall) {
    const m = memoryAt(memory, wall);
    return m !== null && wall.guess !== null && m === wall.guess;
  }

  /* The LOWN rule, one token per step: trust when certified, otherwise look. */
  function playLOWN(level) {
    const mem = newMemory();
    const out = [];
    let looks = 0, mistakes = 0;
    for (const w of level.walls) {
      if (certified(mem, w)) {
        const ok = w.guess === w.truth;
        if (!ok) mistakes++;
        out.push({ t: w.t, action: "trust", lane: w.guessLane, ok: ok, word: w.guess });
      } else {
        look(mem, w); looks++;
        out.push({ t: w.t, action: "look", lane: w.truthLane, ok: true, word: w.truth });
      }
    }
    return { looks: looks, mistakes: mistakes, steps: level.walls.length, log: out };
  }

  function playAlways(level) {
    return { looks: level.walls.length, mistakes: 0, steps: level.walls.length };
  }

  /* Player session for one level. */
  function Session(level) {
    this.level = level; this.i = 0; this.mem = newMemory();
    this.looks = 0; this.mistakes = 0; this.log = []; this.lookedThis = false;
  }
  Session.prototype.wall = function () { return this.level.walls[this.i] || null; };
  Session.prototype.state = function () {
    const w = this.wall();
    if (!w) return null;
    const m = memoryAt(this.mem, w);
    return { wall: w, memory: m, memoryLane: m === null ? -1 : w.lanes.indexOf(m), certified: certified(this.mem, w), looked: this.lookedThis };
  };
  Session.prototype.look = function () {
    const w = this.wall();
    if (!w || this.lookedThis) return false;
    look(this.mem, w); this.looks++; this.lookedThis = true; return true;
  };
  // pass the wall in a lane; returns the result
  Session.prototype.pass = function (lane) {
    const w = this.wall();
    if (!w) return null;
    const word = w.lanes[lane];
    const ok = lane === w.truthLane;
    if (!ok) this.mistakes++;
    const r = { t: w.t, lane: lane, word: word, ok: ok, looked: this.lookedThis, certified: certified(this.mem, w) };
    this.log.push(r); this.i++; this.lookedThis = false;
    return r;
  };
  Session.prototype.done = function () { return this.i >= this.level.walls.length; };
  Session.prototype.result = function () { return { looks: this.looks, mistakes: this.mistakes, steps: this.level.walls.length, log: this.log }; };

  // rank: cost = looks + 3 per mistake (a wrong word costs more than a look); ties go to fewer mistakes
  const PENALTY = 3;
  function cost(r) { return r.looks + PENALTY * r.mistakes; }
  function compare(a, b) { return cost(a) - cost(b) || a.mistakes - b.mistakes; }

  /* Real statistics of a trace set, computed in the page from the data itself. */
  function stats(items) {
    let steps = 0, differ = 0, lownLooks = 0, lownSame = 0, lownMiss = 0;
    for (const it of items) {
      const lv = buildLevel(it);
      for (const w of lv.walls) { steps++; if (w.guess !== w.truth) differ++; }
      const r = playLOWN(lv);
      lownLooks += r.looks; lownMiss += r.mistakes; if (r.mistakes === 0) lownSame++;
    }
    return { items: items.length, steps: steps, differ: differ, differRate: steps ? differ / steps : 0,
      lownLooks: lownLooks, lownLookRate: steps ? lownLooks / steps : 0, lownMistakes: lownMiss, lownSame: lownSame };
  }

  /* Difficulty: share of steps where the text-only guess is wrong. */
  function difficulty(item) {
    const lv = buildLevel(item);
    let d = 0; for (const w of lv.walls) if (w.guess !== w.truth) d++;
    return lv.walls.length ? d / lv.walls.length : 0;
  }

  /* Daily set: 3 items of one language, easy -> hard, chosen by date seed. */
  function daily(items, dateStr, lang) {
    const pool = items.filter((x) => x.lang === lang);
    const use = pool.length >= 3 ? pool : items;
    const sorted = use.slice().sort((a, b) => difficulty(a) - difficulty(b) || (a.id < b.id ? -1 : 1));
    const n = sorted.length, R = rng(hash("daily:" + dateStr));
    const third = Math.max(1, Math.floor(n / 3));
    const pick = (lo, hi) => sorted[Math.min(n - 1, lo + Math.floor(R() * Math.max(1, hi - lo)))];
    const a = pick(0, third), b = pick(third, 2 * third), c = pick(2 * third, n);
    const out = [a, b, c].filter((x, i, arr) => arr.indexOf(x) === i);
    for (const x of sorted) { if (out.length >= 3) break; if (out.indexOf(x) < 0) out.push(x); }
    return out;
  }

  function dayNumber(dateStr) {
    const d0 = Date.UTC(2026, 10, 1), d = Date.parse(dateStr + "T00:00:00Z");
    return Math.floor((d - d0) / 86400000) + 1;
  }

  /* Wordle-like share text. ok trust = 🟩, look = 👁, mistake = 🟥 */
  function shareText(opts) {
    const rows = opts.levels.map((lv) => lv.log.map((r) => (!r.ok ? "🟥" : r.looked ? "🟦" : "🟩")).join(""));
    const me = opts.total, lown = opts.lown, ja = opts.lang === "ja";
    const head = ja
      ? "目を閉じて飛べ #" + opts.day + "\n私 👁" + me.looks + "/" + me.steps + " ✕" + me.mistakes + "  AI(LOWN) 👁" + lown.looks + "/" + lown.steps + " ✕" + lown.mistakes
      : "Fly Blind #" + opts.day + "\nMe 👁" + me.looks + "/" + me.steps + " ✕" + me.mistakes + "  AI (LOWN) 👁" + lown.looks + "/" + lown.steps + " ✕" + lown.mistakes;
    const legend = ja ? "🟩信じた 🟦見た 🟥ミス" : "🟩trusted 🟦looked 🟥wrong";
    return head + "\n" + rows.join("\n") + "\n" + legend + (opts.url ? "\n" + opts.url : "");
  }

  return { rng: rng, hash: hash, buildLevel: buildLevel, newMemory: newMemory, look: look, memoryAt: memoryAt,
    certified: certified, playLOWN: playLOWN, playAlways: playAlways, Session: Session, compare: compare,
    stats: stats, difficulty: difficulty, isSpecial: isSpecial, isAuto: isAuto, cost: cost, PENALTY: PENALTY, daily: daily, dayNumber: dayNumber, shareText: shareText };
});
