import json, re, sys, urllib.parse, urllib.request
UA = {"User-Agent": "LOWN-trace-research/0.1 (contact: code415.dev)"}
OK = re.compile(r"^(public domain|pd|cc0|cc by \d|cc-by-\d|cc by-\d|cc by \d\.\d)", re.I)

def search(q, n=12):
    p = {"action": "query", "format": "json", "generator": "search", "gsrsearch": q + " filetype:bitmap",
         "gsrnamespace": 6, "gsrlimit": n, "prop": "imageinfo", "iiprop": "url|extmetadata|size|mime",
         "iiurlwidth": 768}
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(p)
    import time
    for a in range(6):
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30)); break
        except urllib.error.HTTPError as e:
            if e.code != 429: raise
            time.sleep(10 * (a + 1))
    time.sleep(4)
    out = []
    for pg in (d.get("query", {}).get("pages", {}) or {}).values():
        ii = pg["imageinfo"][0]; m = ii.get("extmetadata", {})
        lic = m.get("LicenseShortName", {}).get("value", "")
        if "SA" in lic.upper().replace("USA", "") or "NC" in lic.upper() or "ND" in lic.upper():
            continue
        if not OK.match(lic.strip()):
            continue
        if ii.get("mime") not in ("image/jpeg", "image/png"):
            continue
        artist = re.sub("<[^>]+>", "", m.get("Artist", {}).get("value", "")).strip()
        out.append({"title": pg["title"], "license": lic, "author": artist[:80], "w": ii["width"], "h": ii["height"],
                    "thumb": ii.get("thumburl"), "page": ii.get("descriptionurl")})
    return out

for q in sys.argv[1:]:
    print("##", q)
    for r in search(q):
        print(json.dumps(r, ensure_ascii=False))
