import sys, json, os, time, statistics
sys.path.insert(0, "/tmp/lown_traces")
from PIL import Image
import torch
import engine

B = "/tmp/lown_traces/"
OUT = B + "out/traces.json"
Q = {"en": "Describe the picture in one short sentence.", "ja": "この写真を短い一文で説明してください。"}
ids = sys.argv[1].split(",") if len(sys.argv) > 1 and sys.argv[1] != "all" else None
Lover = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
items = json.load(open(B + "items.json"))
cred = json.load(open(B + "out/credits.json"))
NOTE = ("Real LLaDA-V forward passes (fp16, Apple M4 Pro GPU via PyTorch MPS) on real Wikimedia Commons photos. "
        "Baseline = always look: each step one full image-conditioned pass unmasks the single highest-confidence masked "
        "position with its argmax; at every step a cheap text-only pass (LOWN style: visual rows removed, original "
        "absolute positions kept) is run on the same partially unmasked canvas. Both distributions are recorded. "
        "lown = replay of the LOWN rule on this baseline trajectory (memory = full prediction from the last look; "
        "trust when the cheap argmax at the chosen position equals the memory argmax, else look and refresh); the "
        "canvas is the baseline's at every step, so it is a counterfactual replay, not a separate LOWN decode. "
        "Image preprocessing uses LLaDA-V's anyres path restricted to a single 384x384 grid (base view + 1 tile, "
        "~1.4k visual tokens) to fit memory and time; the paper uses up to anyres_max_4. Tokens 126080/126081/126346/"
        "126347 suppressed as in LOWN's lown.py; decoding stops at the first committed <|eot_id|> (positions after it "
        "are dropped), as in LOWN. Logits computed for answer positions only, softmax in float32 (MPS has no float64). "
        "Because 16.9 GB of fp16 weights did not fit beside the machine's existing wired memory, decoder layers and "
        "the LM head were streamed from disk one layer at a time; ms_full / ms_cheap are GPU compute times with the "
        "layer resident (synchronised per layer, weight transfer excluded), median over steps; ms_step_wall includes "
        "streaming. Probabilities are rounded to 4 decimals. Not the authors' setup; numbers are from this run only.")


def load():
    try:
        return json.load(open(OUT))
    except Exception:
        return {"model": "GSAI-ML/LLaDA-V", "model_url": "https://huggingface.co/GSAI-ML/LLaDA-V",
                "revision": "a10ba1790083e10e07cfcab6e7be93e1823f5792", "license": "",
                "device": "mps", "dtype": "float16", "modality": "image", "note": NOTE, "items": []}


def save(doc):
    tmp = OUT + ".tmp"
    json.dump(doc, open(tmp, "w"), ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUT)


doc = load()
doc["note"] = NOTE
done = {it["id"] for it in doc["items"]}
E = engine.Engine()
print("LOAD", round(E.load_s, 1), "s", flush=True)
doc["load_seconds"] = round(E.load_s, 1)
for it in items:
    if ids and it["id"] not in ids:
        continue
    if it["id"] in done:
        continue
    L = int(Lover.get(it["id"], Lover.get(it["lang"], 12)))
    img = Image.open(B + f"out/img/{it['id']}.jpg").convert("RGB")
    t0 = time.time()
    print(f"== {it['id']} L={L} size={img.size}", flush=True)
    r = E.run(img, Q[it["lang"]], L, log=lambda s: print(s, flush=True))
    lw, dr = engine.lown_replay(r["steps"])
    steps = []
    for s in r["steps"]:
        steps.append({"t": s["t"], "pick": s["pick"], "masked": s["masked"], "full": s["full"], "cheap": s["cheap"],
                      "lown_look": s["lown_look"]})
    c = cred[it["id"]]
    rec = {"id": it["id"], "lang": it["lang"], "image": f"img/{it['id']}.jpg",
           "image_credit": {"title": c["title"], "author": c["author"], "license": c["license"], "url": c["url"]},
           "scene": it["scene"], "question": Q[it["lang"]], "L": L, "answer": r["answer"],
           "answer_tokens": r["answer_tokens"], "answer_ids": r["ans_ids"],
           "answer_token_space": [E.tok.decode([x]).startswith(" ") for x in r["ans_ids"]], "steps": steps,
           "lown": lw, "differ_rate": round(dr, 4),
           "ms_full": round(statistics.median(r["msF"])), "ms_cheap": round(statistics.median(r["msC"])),
           "ms_step_wall": round(statistics.median(r["wall"])), "ms_vision": round(r["ms_vision"]),
           "tokens_full": r["P"] + L, "tokens_cheap": r["P_text"] + L, "image_tiles": r["tiles"]}
    doc["items"] = [x for x in doc["items"] if x["id"] != it["id"]] + [rec]
    doc["items"].sort(key=lambda x: x["id"])
    save(doc)
    print(f"DONE {it['id']} answer={r['answer']!r} looks={lw['looks']}/{lw['steps']} same={lw['same_as_baseline']} "
          f"differ={dr:.2f} msF={rec['ms_full']} msC={rec['ms_cheap']} item_s={time.time() - t0:.0f}", flush=True)
print("ALLDONE", flush=True)
