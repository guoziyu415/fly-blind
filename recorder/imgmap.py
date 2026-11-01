import json, hashlib
from PIL import Image
import numpy as np
B = "/tmp/lown_traces/"
cands = {}
for l in open(B + "cands.jsonl"):
    d = json.loads(l)
    cands.setdefault(d["page"], d)
cred = json.load(open(B + "out/credits.json"))
out = {}
for k, v in sorted(cred.items()):
    data = open(B + f"out/img/{k}.jpg", "rb").read()
    a = np.asarray(Image.open(B + f"out/img/{k}.jpg").convert("RGB"), dtype=np.float64)
    out[k] = {"thumb": cands[v["url"]]["thumb"], "q": v["q"], "size": v["size"], "bytes": len(data),
              "md5": hashlib.md5(data).hexdigest(), "mean": round(float(a.mean()), 3)}
json.dump(out, open(B + "out/imgmap.json", "w"), indent=0)
print(json.dumps(out))
