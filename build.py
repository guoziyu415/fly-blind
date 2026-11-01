import json, sys, os, hashlib
here = os.path.dirname(os.path.abspath(__file__))
src = lambda p: open(os.path.join(here, "src", p), encoding="utf-8").read()
data_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "data", "traces.json")
out_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, "out")
img_base = sys.argv[3] if len(sys.argv) > 3 else ""
mode = sys.argv[4] if len(sys.argv) > 4 else "dev"
THREE = {"dev": ("https://p.test/three/build/three.module.min.js", "https://p.test/three/examples/jsm/"), "site": ("/demos/2026-10-05/arc/a/three/three.module.min.js", "/demos/2026-10-05/arc/a/three/addons/"), "pages": ("vendor/three/three.module.min.js", "vendor/three/addons/")}[mode]
data = json.load(open(data_path, encoding="utf-8"))
page = src("page.html")
page = page.replace("/*@@STRINGS@@*/", src("strings.js"))
page = page.replace("/*@@DATA@@*/", "window.DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\nwindow.IMG_BASE = " + json.dumps(img_base) + ";")
page = page.replace("/*@@CORE@@*/", src("core.js"))
page = page.replace("/*@@GAME@@*/", src("game.js"))
page = page.replace("/*@@SCENE@@*/", src("scene3d.js").replace("export function createScene", "function createScene"))
page = page.replace("@@THREE_MAIN@@", THREE[0]).replace("@@THREE_ADDONS@@", THREE[1])
assert "@@" not in page
os.makedirs(out_dir, exist_ok=True)
open(os.path.join(out_dir, "index.html"), "w", encoding="utf-8").write(page)
print(os.path.join(out_dir, "index.html"), len(page), hashlib.sha256(page.encode()).hexdigest()[:8])
