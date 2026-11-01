"""LLaDA-V (GSAI-ML/LLaDA-V, fp16) on Apple MPS with layer-streamed weights.

The 16.9 GB fp16 checkpoint does not fit next to the machine's existing wired
memory, so decoder layers and the LM head are read from the safetensors shards
one unit at a time (F_NOCACHE reads, double buffered), copied to MPS, used for
BOTH the image-conditioned (full) and text-only (cheap) sequence, then freed.
Vision tower, projector, image_newline and final norm stay resident on MPS.
Per-pass compute times are measured with torch.mps.synchronize around each
pass's work on each resident unit (weight transfer excluded and reported
separately as wall time).
"""
import os, sys, json, time, struct, fcntl, types
os.environ["HF_HOME"] = "/tmp/lown_traces/hf"
os.environ["HF_HUB_OFFLINE"] = "1"
sys.path.insert(0, "/tmp/lown_traces/src/LOWN")
import numpy as np
import torch, torch.nn as nn, torch.nn.functional as F
from concurrent.futures import ThreadPoolExecutor

SNAP = "/tmp/lown_traces/hf/hub/models--GSAI-ML--LLaDA-V/snapshots/a10ba1790083e10e07cfcab6e7be93e1823f5792"
DEV = torch.device("mps")
DT = torch.float16
MASK_ID, EOT = 126336, 126348
SUPPRESS = (126081, 126080, 126346, 126347)  # same as LOWN lown.py
NL, H, NH, HD, V = 32, 4096, 32, 128, 126349
LAYER_KEYS = ["input_layernorm.weight", "self_attn.q_proj.weight", "self_attn.k_proj.weight", "self_attn.v_proj.weight",
              "self_attn.o_proj.weight", "post_attention_layernorm.weight", "mlp.gate_proj.weight", "mlp.up_proj.weight",
              "mlp.down_proj.weight"]
HEAD_CHUNKS = 3


def sync():
    torch.mps.synchronize()


class Store:
    def __init__(self):
        wm = json.load(open(SNAP + "/model.safetensors.index.json"))["weight_map"]
        self.meta = {}
        for fn in sorted(set(wm.values())):
            path = SNAP + "/" + fn
            with open(path, "rb") as f:
                n = struct.unpack("<Q", f.read(8))[0]
                h = json.loads(f.read(n))
            for k, v in h.items():
                if k == "__metadata__":
                    continue
                assert v["dtype"] == "F16", (k, v["dtype"])
                a, b = v["data_offsets"]
                self.meta[k] = (path, 8 + n + a, b - a, v["shape"])
        self.files = {}

    def f(self, path):
        if path not in self.files:
            fo = open(path, "rb", buffering=0)
            try:
                fcntl.fcntl(fo.fileno(), 48, 1)  # F_NOCACHE: do not grow the page cache
            except OSError:
                pass
            self.files[path] = fo
        return self.files[path]

    def read_segments(self, segs, buf):
        """segs: list of (name, path, offset, nbytes, shape) -> {name: (buf_off, nbytes, shape)}"""
        out, off = {}, 0
        for name, path, o, nb, shape in segs:
            fo = self.f(path)
            fo.seek(o)
            mv = memoryview(buf)[off:off + nb]
            got = 0
            while got < nb:
                r = fo.readinto(mv[got:])
                if not r:
                    raise IOError("short read " + name)
                got += r
            out[name] = (off, nb, shape)
            off += nb
        return out

    def seg(self, k):
        p, o, nb, shape = self.meta[k]
        return (k, p, o, nb, shape)

    def load(self, k, dev=DEV):
        p, o, nb, shape = self.meta[k]
        buf = np.empty(nb, np.uint8)
        self.read_segments([self.seg(k)], buf)
        t = torch.from_numpy(buf).view(torch.float16).view(*shape)
        return t.to(dev) if dev is not None else t


class Streamer:
    def __init__(self, store):
        self.store = store
        self.units = []
        for i in range(NL):
            self.units.append([store.seg(f"model.layers.{i}.{k}") for k in LAYER_KEYS])
        p, o, nb, shape = store.meta["lm_head.weight"]
        rows = shape[0]
        step = (rows + HEAD_CHUNKS - 1) // HEAD_CHUNKS
        for c in range(HEAD_CHUNKS):
            r0, r1 = c * step, min(rows, (c + 1) * step)
            self.units.append([(f"head{c}", p, o + r0 * shape[1] * 2, (r1 - r0) * shape[1] * 2, [r1 - r0, shape[1]])])
        size = max(sum(s[3] for s in u) for u in self.units)
        self.bufs = [np.empty(size, np.uint8) for _ in range(2)]
        self.ex = ThreadPoolExecutor(1)
        self.read_s = 0.0

    def _read(self, u):
        t = time.perf_counter()
        r = self.store.read_segments(self.units[u], self.bufs[u % 2])
        self.read_s += time.perf_counter() - t
        return r

    def __iter__(self):
        futs = {0: self.ex.submit(self._read, 0), 1: self.ex.submit(self._read, 1)}
        n = len(self.units)
        for u in range(n):
            lay = futs.pop(u).result()
            buf = self.bufs[u % 2]
            W = {k: torch.from_numpy(buf[o:o + nb]).view(torch.float16).view(*shape).to(DEV) for k, (o, nb, shape) in lay.items()}
            sync()  # copies done -> staging buffer may be refilled
            if u + 2 < n:
                futs[u + 2] = self.ex.submit(self._read, u + 2)
            yield u, W
            del W


def rms(x, w, eps=1e-5):
    xf = x.float()
    xf = xf * torch.rsqrt(xf.pow(2).mean(-1, keepdim=True) + eps)
    return w * xf.to(x.dtype)


def rope(pos):
    inv = 1.0 / (500000.0 ** (torch.arange(0, HD, 2, dtype=torch.int64).float() / HD))
    fr = pos.float().cpu()[:, None] * inv[None, :]
    emb = torch.cat([fr, fr], -1)
    return emb.cos().to(DEV, DT), emb.sin().to(DEV, DT)


def rot_half(x):
    return torch.cat((-x[..., HD // 2:], x[..., :HD // 2]), -1)


def layer_fwd(h, W, p, cos, sin):
    T = h.shape[1]
    x = rms(h, W[p + "input_layernorm.weight"])
    q = F.linear(x, W[p + "self_attn.q_proj.weight"]).view(1, T, NH, HD).transpose(1, 2)
    k = F.linear(x, W[p + "self_attn.k_proj.weight"]).view(1, T, NH, HD).transpose(1, 2)
    v = F.linear(x, W[p + "self_attn.v_proj.weight"]).view(1, T, NH, HD).transpose(1, 2)
    q = q * cos + rot_half(q) * sin
    k = k * cos + rot_half(k) * sin
    a = F.scaled_dot_product_attention(q, k, v, is_causal=False)  # bidirectional (MDM)
    a = a.transpose(1, 2).reshape(1, T, H)
    h = h + F.linear(a, W[p + "self_attn.o_proj.weight"])
    x = rms(h, W[p + "post_attention_layernorm.weight"])
    h = h + F.linear(F.silu(F.linear(x, W[p + "mlp.gate_proj.weight"])) * F.linear(x, W[p + "mlp.up_proj.weight"]),
                     W[p + "mlp.down_proj.weight"])
    return h


class Engine:
    def __init__(self, grid=((384, 384),)):
        t0 = time.time()
        from transformers import AutoTokenizer
        from llava.model.multimodal_encoder.siglip_encoder import SigLipVisionTower, SigLipVisionModel, SigLipVisionConfig
        from llava.model.multimodal_projector.builder import build_vision_projector
        from llava.model.llava_arch import LlavaMetaForCausalLM
        self.tok = AutoTokenizer.from_pretrained(SNAP)
        cfgd = json.load(open(SNAP + "/config.json"))
        cfgd["image_grid_pinpoints"] = [list(g) for g in grid]  # fewest tiles: base view + 1 tile
        self.cfg = types.SimpleNamespace(**cfgd)
        self.store = Store()
        st = self.store
        # vision tower: build on meta, assign checkpoint weights (no hub download)
        with torch.device("meta"):
            vm = SigLipVisionModel(SigLipVisionConfig())
        del vm.vision_model.encoder.layers[-1:]
        vm.vision_model.head = nn.Identity()
        pre = "model.vision_tower.vision_tower."
        sd = {k[len(pre):]: st.load(k) for k in st.meta if k.startswith(pre)}
        res = vm.load_state_dict(sd, strict=False, assign=True)
        vm.vision_model.embeddings.position_ids = torch.arange(729, device=DEV).expand((1, -1))
        for n_, b_ in list(vm.named_parameters()) + list(vm.named_buffers()):
            assert not b_.is_meta, n_
        self.load_report = {"vision_missing": list(res.missing_keys), "vision_unexpected": list(res.unexpected_keys)}
        vm.eval().requires_grad_(False)
        vt = SigLipVisionTower("google/siglip2-so400m-patch14-384", vision_tower_cfg=types.SimpleNamespace(), delay_load=True)
        vt.vision_tower = vm
        vt.is_loaded = True
        self.vt = vt
        proj = build_vision_projector(self.cfg)
        proj.load_state_dict({k[len("model.mm_projector."):]: st.load(k, None) for k in st.meta if k.startswith("model.mm_projector.")})
        proj = proj.to(DEV, DT).eval()
        newline = st.load("model.image_newline")
        self.norm = st.load("model.norm.weight")
        p, o, nb, shape = st.meta["model.embed_tokens.weight"]
        mm = np.memmap(p, dtype=np.float16, mode="r", offset=o, shape=tuple(shape))
        self.embW = mm

        eng = self

        class Emb(nn.Module):
            def forward(self, ids):
                ids_np = ids.detach().cpu().numpy()
                return torch.from_numpy(np.ascontiguousarray(eng.embW[ids_np])).to(DEV)

        self.embed = Emb()

        class Inner(nn.Module):
            def __init__(s):
                super().__init__()
                s.vision_tower = vt
                s.mm_projector = proj
                s.embed_tokens = eng.embed
                s.image_newline = newline

            def get_vision_tower(s):
                return s.vision_tower

        class Fake(LlavaMetaForCausalLM):
            def __init__(s, cfg, inner):
                s.config = cfg
                s.model = inner

            def get_model(s):
                return s.model

            @property
            def device(s):
                return DEV

        self.fake = Fake(self.cfg, Inner())
        self.streamer = Streamer(st)
        sync()
        self.load_s = time.time() - t0

    def prepare(self, image, question):
        from llava.mm_utils import process_images, tokenizer_image_token
        from llava.constants import IMAGE_TOKEN_INDEX, IGNORE_INDEX
        messages = [
            {"role": "system", "content": ("You are a helpful language and vision assistant. "
                                           "You are able to understand the visual content that the user provides, "
                                           "and assist the user with a variety of tasks using natural language.")},
            {"role": "user", "content": "<image>\n" + question},
        ]
        prompt = self.tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        ids = tokenizer_image_token(prompt, self.tok, IMAGE_TOKEN_INDEX, return_tensors="pt")[None]
        imgs = [t.to(DEV, DT) for t in process_images([image], self.vt.image_processor, self.cfg)]
        t = time.perf_counter()
        prep = self.fake.prepare_inputs_labels_for_multimodal(
            ids, None, torch.ones_like(ids, dtype=torch.bool), None, torch.zeros_like(ids), imgs, ["image"],
            image_sizes=[image.size])
        sync()
        ms_vision = (time.perf_counter() - t) * 1000
        prefix, labels = prep[4].to(DEV, DT), prep[5]
        visual = labels[0].eq(IGNORE_INDEX).cpu()
        return prefix, visual, ms_vision, int(imgs[0].shape[0])

    def forward_pair(self, hF, hC, rF, rC, L):
        """One weight stream; both sequences run on each resident unit."""
        tF = tC = 0.0
        partsF, partsC = [], []
        t_wall = time.perf_counter()
        xF = xC = None
        for u, W in self.streamer:
            if u < NL:
                p = f"model.layers.{u}."
                a = time.perf_counter(); hF = layer_fwd(hF, W, p, *rF); sync(); b = time.perf_counter(); tF += b - a
                hC = layer_fwd(hC, W, p, *rC); sync(); tC += time.perf_counter() - b
                if u == NL - 1:
                    a = time.perf_counter(); xF = rms(hF[:, -L:], self.norm)[0]; sync(); b = time.perf_counter(); tF += b - a
                    xC = rms(hC[:, -L:], self.norm)[0]; sync(); tC += time.perf_counter() - b
            else:
                w = W[f"head{u - NL}"]
                a = time.perf_counter(); partsF.append(F.linear(xF, w).float()); sync(); b = time.perf_counter(); tF += b - a
                partsC.append(F.linear(xC, w).float()); sync(); tC += time.perf_counter() - b
        lF, lC = torch.cat(partsF, -1), torch.cat(partsC, -1)
        for lg in (lF, lC):
            lg[:, list(SUPPRESS)] = -torch.inf
        return lF.softmax(-1).cpu(), lC.softmax(-1).cpu(), tF * 1000, tC * 1000, (time.perf_counter() - t_wall) * 1000

    def tokstr(self, i):
        s = self.tok.decode([int(i)])
        return s.strip() if s.strip() else s

    @torch.no_grad()
    def run(self, image, question, L, log=print):
        prefix, visual, ms_vision, tiles = self.prepare(image, question)
        P = prefix.shape[1]
        text_idx = torch.where(~visual)[0]
        pos_full = torch.arange(P + L)
        pos_cheap = torch.cat([text_idx, torch.arange(P, P + L)])  # LOWN: drop visual rows, keep absolute positions
        rF, rC = rope(pos_full), rope(pos_cheap)
        prefix_text = prefix[:, text_idx.to(DEV)]
        canvas = self.embed(torch.full((1, L), MASK_ID))
        committed = [-1] * L
        end = L
        steps, msF, msC, wall = [], [], [], []
        t = 0
        while True:
            active = [i for i in range(end) if committed[i] < 0]
            if not active:
                break
            hF = torch.cat([prefix, canvas], 1)
            hC = torch.cat([prefix_text, canvas], 1)
            pF, pC, a, b, w = self.forward_pair(hF, hC, rF, rC, L)
            msF.append(a); msC.append(b); wall.append(w)
            confF, amF = pF.max(-1)
            pick = max(active, key=lambda i: (float(confF[i]), -i))
            rec = {"t": t, "pick": pick, "masked": active, "full": {}, "cheap": {}, "_fa": {}, "_ca": {}}
            for i in active:
                for nm, pr in (("full", pF), ("cheap", pC)):
                    v, ix = pr[i].topk(3)
                    rec[nm][str(i)] = [[self.tokstr(x), round(float(y), 4)] for x, y in zip(ix.tolist(), v.tolist())]
                    rec["_fa" if nm == "full" else "_ca"][str(i)] = int(ix[0])
            tokid = int(amF[pick])
            committed[pick] = tokid
            canvas[0, pick] = self.embed(torch.tensor([[tokid]]))[0, 0].to(canvas.dtype)
            end = committed.index(EOT) if EOT in committed else L
            steps.append(rec)
            log(f"  t={t} pick={pick} tok={self.tokstr(tokid)!r} pF={float(confF[pick]):.3f} cheap={rec['cheap'][str(pick)][0]} "
                f"msF={a:.0f} msC={b:.0f} wall={w:.0f} read={self.streamer.read_s:.1f}s")
            t += 1
        ans_ids = committed[:end]
        return {"P": P, "P_text": int(len(text_idx)), "tiles": tiles, "ms_vision": ms_vision, "steps": steps,
                "ans_ids": ans_ids, "answer": self.tok.decode(ans_ids, skip_special_tokens=True).strip(),
                "answer_tokens": [self.tokstr(x) for x in ans_ids], "msF": msF, "msC": msC, "wall": wall}


def lown_replay(steps):
    """Memory = full prediction stored at the last look. Trust if cheap argmax at the chosen
    position equals memory argmax there; else look (full pass) and refresh memory."""
    mem = None
    looks, out_lown, out_base, differ = 0, [], [], 0
    for s in steps:
        k = str(s["pick"])
        full_tok, cheap_tok = s["_fa"][k], s["_ca"][k]
        if cheap_tok != full_tok:
            differ += 1
        if mem is not None and k in mem and mem[k] == cheap_tok:
            out_lown.append(mem[k])
            look = False
        else:
            looks += 1
            mem = dict(s["_fa"])
            out_lown.append(mem[k])
            look = True
        s["lown_look"] = look
        out_base.append(full_tok)
    n = len(steps)
    return {"looks": looks, "steps": n, "same_as_baseline": out_lown == out_base,
            "mismatch_steps": [i for i, (x, y) in enumerate(zip(out_lown, out_base)) if x != y]}, (differ / n if n else 0.0)
