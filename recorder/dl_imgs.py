import json, sys, io, time, re, urllib.request, html
from PIL import Image
UA = {"User-Agent": "LOWN-trace-research/0.2 (code415.dev; research demo)"}
cands = {}
for l in open("/tmp/lown_traces/cands.jsonl"):
    d = json.loads(l)
    cands.setdefault(d["title"], d)
sel = json.load(open(sys.argv[1]))  # [{"id":..., "title":...}]
outdir = sys.argv[2]
credits = {}
try:
    credits = json.load(open(outdir + "/credits.json"))
except Exception:
    pass
for s in sel:
    d = cands.get(s["title"])
    if d is None:
        m = [v for k, v in cands.items() if k.startswith(s["title"][:60])]
        if len(m) != 1:
            print("NOMATCH", s, len(m), flush=True); continue
        d = m[0]
    for a in range(5):
        try:
            raw = urllib.request.urlopen(urllib.request.Request(d["thumb"], headers=UA), timeout=60).read(); break
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            time.sleep(10 * (a + 1))
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    im.thumbnail((768, 768), Image.LANCZOS)
    for q in (88, 82, 76, 70, 64, 58, 50):
        b = io.BytesIO(); im.save(b, "JPEG", quality=q, optimize=True)
        if b.tell() <= 120 * 1024:
            break
    open(f"{outdir}/{s['id']}.jpg", "wb").write(b.getvalue())
    credits[s["id"]] = {"title": d["title"][5:] if d["title"].startswith("File:") else d["title"],
                        "author": html.unescape(re.sub(r"\s+", " ", d["author"])).strip(),
                        "license": d["license"], "url": d["page"], "size": list(im.size), "bytes": b.tell(), "q": q}
    print(s["id"], im.size, b.tell(), q, d["license"], flush=True)
    time.sleep(1.5)
json.dump(credits, open(outdir + "/credits.json", "w"), ensure_ascii=False, indent=1)
print("DONE")
