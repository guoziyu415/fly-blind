import json
B = "/tmp/lown_traces/out/"
d = json.load(open(B + "traces.json"))
d["license"] = ("No license is declared on the Hugging Face model card for GSAI-ML/LLaDA-V (checked 2026-11-01 via the HF "
                "API: cardData has no license field). The LLaDA-V code (github.com/ML-GSAI/LLaDA-V, train/LICENSE) and "
                "the LOWN llava subset are Apache-2.0.")
d["lown_repo"] = "https://github.com/hyeon9698/LOWN"
d["paper"] = "arXiv 2610.36671"
d["language_note"] = ("Japanese was tested first (flamingo photo, L=14) and LLaDA-V answered "
                      "'雪の中に多くの flamingoがあります。' (code-switching), so all 24 items use the English question.")
steps = sum(it["lown"]["steps"] for it in d["items"])
diff = sum(round(it["differ_rate"] * it["lown"]["steps"]) for it in d["items"])
looks = sum(it["lown"]["looks"] for it in d["items"])
d["summary"] = {"items": len(d["items"]), "steps": steps, "cheap_ne_full_at_pick": diff,
                "differ_rate": round(diff / steps, 4), "lown_looks": looks, "look_rate": round(looks / steps, 4),
                "same_as_baseline": sum(it["lown"]["same_as_baseline"] for it in d["items"]),
                "ms_full_median": sorted(it["ms_full"] for it in d["items"])[len(d["items"]) // 2],
                "ms_cheap_median": sorted(it["ms_cheap"] for it in d["items"])[len(d["items"]) // 2]}
json.dump(d, open(B + "traces.json", "w"), ensure_ascii=False, separators=(",", ":"))
print(json.dumps(d["summary"]))
for it in d["items"]:
    print(it["id"], "|", it["answer"], "|", f"{it['lown']['looks']}/{it['lown']['steps']}", it["lown"]["same_as_baseline"],
          it["lown"]["mismatch_steps"], it["differ_rate"], it["ms_full"], it["ms_cheap"], it["tokens_full"], it["tokens_cheap"])
