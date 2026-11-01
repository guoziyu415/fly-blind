import json, shutil, os
B = "/tmp/lown_traces/"
items = json.load(open(B + "items.json"))
c1 = json.load(open(B + "out/img/credits.json"))
c2 = json.load(open(B + "cand/credits.json"))
allc = {**{"out/img/" + k: v for k, v in c1.items()}, **{"cand/" + k: v for k, v in c2.items()}}
final = {}
for it in items:
    src = it["src"]
    data = open(B + src + ".jpg", "rb").read()
    final[it["id"]] = allc[src]
    final[it["id"]]["_data"] = data
for f in os.listdir(B + "out/img"):
    os.remove(B + "out/img/" + f)
cred = {}
for k, v in final.items():
    open(B + f"out/img/{k}.jpg", "wb").write(v.pop("_data"))
    cred[k] = v
json.dump(cred, open(B + "out/credits.json", "w"), ensure_ascii=False, indent=1)
print(sorted(os.listdir(B + "out/img")), len(cred))
for k, v in cred.items():
    print(k, v["license"], "|", v["author"][:60], "|", v["title"][:60])
