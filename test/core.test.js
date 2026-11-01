// Unit tests for the LOWN rule and scoring. Run: node test/core.test.js [traces.json]
const LG = require("../src/core.js");
const path = require("path");
let n = 0, fail = 0;
const ok = (c, m) => { n++; if (!c) { fail++; console.log("FAIL", m); } };
// tiny synthetic item: 3 positions, one-token-per-step baseline
function step(t, pick, masked, full, cheap) { return { t, pick, masked, full, cheap }; }
const item = { id: "t1", lang: "en", L: 3, answer: "a blue lobster", answer_tokens: ["a", "blue", "lobster"],
  steps: [
    step(0, 0, [0, 1, 2], { 0: [["a", .9], ["the", .05]], 1: [["blue", .6], ["red", .3]], 2: [["lobster", .7], ["crab", .2]] },
                          { 0: [["a", .8], ["the", .1]], 1: [["red", .7], ["blue", .1]], 2: [["lobster", .5], ["crab", .4]] }),
    step(1, 2, [1, 2], { 1: [["blue", .7], ["red", .2]], 2: [["lobster", .8], ["crab", .1]] },
                       { 1: [["red", .6], ["blue", .2]], 2: [["lobster", .6], ["crab", .3]] }),
    step(2, 1, [1], { 1: [["blue", .9], ["red", .05]] }, { 1: [["red", .55], ["blue", .3]] })
  ] };
const lv = LG.buildLevel(item);
ok(lv.walls.length === 3, "one wall per step");
ok(lv.walls.every((w) => w.lanes.length === 3), "three lanes");
ok(lv.walls.every((w) => w.lanes[w.truthLane] === w.truth), "truth lane holds the baseline token");
ok(lv.walls.every((w) => w.guessLane >= 0 && w.lanes[w.guessLane] === w.guess), "guess lane holds the text-only argmax");
ok(lv.walls[2].truth === "blue" && lv.walls[2].guess === "red", "wall 3 is a trap");
// LOWN: step0 no memory -> look; step1 cheap lobster == memory lobster -> trust ok; step2 cheap red vs memory blue -> look
const r = LG.playLOWN(lv);
ok(r.looks === 2 && r.mistakes === 0, "LOWN looks 2, no mistakes: got " + JSON.stringify([r.looks, r.mistakes]));
ok(r.log.map((x) => x.action).join(",") === "look,trust,look", "LOWN decisions");
// memory is stale-able: certified but wrong
const item2 = JSON.parse(JSON.stringify(item));
item2.steps[2].full[1] = [["red", .5], ["blue", .4]]; item2.answer_tokens[1] = "red"; // after step0 memory says blue at pos1, cheap says red -> look (not certified)
const r2 = LG.playLOWN(LG.buildLevel(item2));
ok(r2.mistakes === 0, "disagreement triggers a look");
const item3 = JSON.parse(JSON.stringify(item));
item3.steps[2].cheap[1] = [["blue", .5], ["red", .4]]; item3.steps[2].full[1] = [["navy", .6], ["blue", .3]]; item3.answer_tokens[1] = "navy";
const r3 = LG.playLOWN(LG.buildLevel(item3));
ok(r3.mistakes === 1, "certified by a stale memory can still be wrong, as in the paper");
// session
const s = new LG.Session(lv);
ok(s.state().memory === null && !s.state().certified, "no memory at start");
ok(s.look() === true && s.look() === false, "one look per wall");
ok(s.pass(lv.walls[0].truthLane).ok, "pass truth lane");
ok(s.state().certified === true, "wall 2 certified after looking at wall 1");
ok(s.pass(lv.walls[1].guessLane).ok, "trusting a certified guess is right here");
ok(s.state().certified === false && s.state().memory === "blue", "wall 3 disagrees with memory");
const res = s.pass(lv.walls[2].guessLane); ok(!res.ok, "trusting the trap is a mistake");
ok(s.done() && s.result().looks === 1 && s.result().mistakes === 1, "session totals");
ok(LG.compare({ mistakes: 0, looks: 3 }, { mistakes: 1, looks: 1 }) < 0, "a mistake costs 3 looks"); ok(LG.compare({ mistakes: 0, looks: 11 }, { mistakes: 1, looks: 6 }) > 0, "looking every time does not win");
ok(LG.compare({ mistakes: 1, looks: 2 }, { mistakes: 1, looks: 3 }) < 0, "fewer looks win at equal mistakes");
const txt = LG.shareText({ levels: [s.result()], total: s.result(), lown: r, day: 1, lang: "en" });
ok(/Fly Blind #1/.test(txt) && /🟥/.test(txt) && /🟦/.test(txt), "share text");
ok(LG.dayNumber("2026-11-01") === 1 && LG.dayNumber("2026-11-02") === 2, "day numbers");
// optional: real data
if (process.argv[2]) {
  const D = require(path.resolve(process.argv[2]));
  ok(D.items.length >= 3, "data has items");
  for (const it of D.items) {
    const L2 = LG.buildLevel(it);
    ok(L2.walls.length === it.steps.filter((s) => !LG.isSpecial(it.answer_tokens[s.pick]) && !LG.isAuto(it.answer_tokens[s.pick])).length && L2.walls.length >= 8, it.id + " walls");
    ok(L2.walls.every((w) => w.truthLane >= 0), it.id + " truth in lanes");
    const rr = LG.playLOWN(L2);
    if (it.lown && typeof it.lown.looks === "number" && !it.answer_tokens.some((w) => LG.isSpecial(w) || LG.isAuto(w))) ok(rr.looks === it.lown.looks, it.id + " LOWN looks match the recorder: " + rr.looks + " vs " + it.lown.looks);
  }
  const d = LG.daily(D.items, "2026-11-01", "en"); ok(d.length === 3, "daily picks 3");
}
console.log(n - fail + "/" + n + " checks passed"); process.exit(fail ? 1 : 0);
