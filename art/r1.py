"""花火正式美术第 1 轮候选：烟火牌面 25×3 套、背景夜/傍晚、封面、牌背、展示架、v2 小图标。一个进程，线程池 10。"""
import sys, pathlib, json
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import pixellab as px
ART = pathlib.Path(__file__).parent; OUT = ART / "out" / "r1"; OUT.mkdir(parents=True, exist_ok=True)
NEG = "text, letters, numbers, kanji, characters, writing, signature, watermark, logo, frame, border, card"
RAMP = {
 "R": ["#6e1420", "#d02a33", "#ff5b4f", "#ffc4b4"],
 "Y": ["#7a5200", "#e8a90c", "#ffd93d", "#fff6c4"],
 "G": ["#0d4a2a", "#23a052", "#52e07f", "#ccf8d8"],
 "B": ["#123a8a", "#2f7de8", "#63b8ff", "#d4eeff"],
 "W": ["#5a5a6e", "#b4b4c8", "#ececf4", "#ffffff"],
}
SHAPE = {
 "R": "a round peony firework burst, a dense solid sphere of glowing red sparks evenly filling a perfect circle, red",
 "Y": "a golden willow firework, sparks shoot up then droop down in long hanging golden yellow trails like a weeping willow tree, dome shape on top, yellow",
 "G": "a ring firework, a thin hollow circle of bright green sparks with an empty center, like a halo ring, green",
 "B": "a chrysanthemum firework, long straight light blue streaks radiating from a bright center like a spiky star with glowing tips, blue",
 "W": "a crackling glitter firework, a loose bunch of many tiny white twinkling star sparkles scattered in a cloud, white and silver",
}
RANKS = {1: (32, "small simple"), 2: (36, "small"), 3: (44, "medium"), 4: (48, "large"), 5: (56, "huge spectacular layered")}
FW_SEEDS = (5101, 5102, 5103)

def palette(c):
    p = OUT / f"pal-{c}.png"
    if not p.exists():
        cols = ["#0b0f22"] + RAMP[c]
        im = Image.new("RGB", (len(cols) * 4, 4))
        for i, h in enumerate(cols):
            for x in range(4):
                for y in range(4): im.putpixel((i * 4 + x, y), tuple(int(h[k:k + 2], 16) for k in (1, 3, 5)))
        im.save(p)
    return p

JOBS = []
for c in RAMP:
    for r, (sz, adj) in RANKS.items():
        for s in FW_SEEDS:
            JOBS.append((f"fw-{c}{r}-s{s}", "/create-image-pixflux", {
                "description": f"pixel art, {adj} {SHAPE[c]}, single firework explosion centered, night festival, transparent background",
                "image_size": {"width": sz, "height": sz}, "no_background": True, "outline": "lineless",
                "negative_description": NEG, "seed": s + r * 10, "color_image": ("pal", c)}))
E = "Edo period Japanese summer fireworks festival on a riverbank, wooden arched bridge low on the left, strings of plain blank round paper lanterns with no writing along the top edge, pagoda silhouette on the right, calm river at the bottom reflecting lights, open empty sky in the middle, ukiyo-e woodblock palette of deep indigo, vermilion, gold and cream, absolutely no text, no characters, no signs"
for s in (5201, 5202, 5203):
    JOBS.append((f"bg-night-s{s}", "/create-image-pixen", {"description": "pixel art night scene, deep indigo starry sky, a few colorful firework bursts high in the sky, " + E, "image_size": {"width": 512, "height": 288}, "seed": s}))
for s in (5301, 5302, 5303):
    JOBS.append((f"bg-day-s{s}", "/create-image-pixen", {"description": "pixel art early evening scene at sunset, bright warm peach, coral and light blue sky, light airy colors, a few small fireworks starting in the bright sky, " + E, "image_size": {"width": 512, "height": 288}, "seed": s}))
STYLE = "cozy 16-bit pixel art game cover illustration, rich warm colors, soft lighting, crisp clean pixels, no text, no letters, no logo"
for s, extra in ((5401, "seen from the river bank"), (5402, "seen from above the water, a small wooden boat with a lantern"), (5403, "close up of the bridge railing with lanterns, fireworks behind")):
    JOBS.append((f"cover-s{s}", "/create-image-pixflux", {"description": f"a Japanese summer fireworks festival over a river at night in the Edo period, giant firework bursts in red, yellow, green, blue and white filling the indigo sky, wooden arched bridge with plain paper lanterns, reflections on the water, {extra}, no people, {STYLE}", "image_size": {"width": 384, "height": 192}, "negative_description": NEG + ", people, person", "seed": s}))
JOBS.append(("cover-s5404", "/create-image-pixflux", {"description": f"a traditional Edo period Japanese town by a river at night during a summer fireworks festival, wooden houses with tiled roofs and a pagoda, strings of plain paper lanterns, a wooden arched bridge, giant firework bursts in red, yellow, green, blue and white over the indigo sky reflected in the water, no modern buildings, no people, {STYLE}", "image_size": {"width": 384, "height": 192}, "negative_description": NEG + ", people, person, skyscraper, modern city", "seed": 5404}))
for s in (5501, 5502, 5503):
    JOBS.append((f"back-s{s}", "/create-image-pixflux", {"description": "pixel art playing card back design, deep indigo blue with a fine gold japanese seigaiha wave pattern, a round gold crest of a stylized firework flower in the center, cream outer border, perfectly symmetrical, no text", "image_size": {"width": 64, "height": 96}, "negative_description": "text, letters, numbers, kanji", "seed": s}))
for s in (5601, 5602, 5603):
    JOBS.append((f"rack-s{s}", "/create-image-pixflux", {"description": "pixel art, side view of a long low dark wooden stand holding five upright bamboo fireworks launch tubes evenly spaced in a row, bound with straw rope, Edo period, transparent background", "image_size": {"width": 320, "height": 64}, "no_background": True, "negative_description": NEG, "seed": s}))
V2 = {
 "spark-W": ("pixel art, one tiny round white firework sparkle burst, glittering silver white star sparks radiating from a bright center, transparent background, fills the canvas", 24),
 "tok-miss2": ("pixel art game token, round vermilion red lacquered wooden coin with a dark grey puff of smoke and a broken cracked black paper ball emblem in the center, thin gold rim, bold dark outline, simple, readable, fills the canvas", 32),
 "tok-clue": ("pixel art game token, round indigo blue lacquered wooden coin with a white japanese uchiwa round paper fan emblem in the center, thin gold rim, bold dark outline, simple, readable, fills the canvas", 32),
 "tok-miss": ("pixel art game token, round vermilion red lacquered wooden coin with a black round firework shell bomb with a short lit fuse emblem in the center, thin gold rim, bold dark outline, simple, readable, fills the canvas", 32),
 "tok-boom": ("pixel art explosion, a jagged red and orange blast burst with black smoke puffs and flying sparks, star shaped, bold dark outline, simple, readable, fills the canvas", 40),
 "ic-play": ("pixel art icon of a small red paper firework rocket launching straight up with a bright sparkling yellow trail, bold dark outline, simple, readable, fills the canvas", 32),
 "ic-discard": ("pixel art icon of a small wooden water bucket with a burnt out firework stick dunked in it and a splash of blue water, bold dark outline, simple, readable, fills the canvas", 32),
 "ic-deck": ("pixel art icon of a small open wooden box full of round paper wrapped firework shells, Edo period, bold dark outline, simple, readable, fills the canvas", 32),
}
for k, (d, sz) in V2.items():
    JOBS.append((k, "/generate-image-v2", {"description": d, "image_size": {"width": sz, "height": sz}, "no_background": True, "seed": 5700 + len(JOBS)}))

def run(job):
    name, ep, body = job
    body = dict(body)
    if isinstance(body.get("color_image"), tuple): body["color_image"] = px.b64_image(palette(body["color_image"][1]))
    try:
        if ep == "/generate-image-v2":
            if (OUT / name / f"{name}.png").exists(): return name, "skip"
            return name, len(px.generate_async(name, body, OUT / name, endpoint=ep))
        if (OUT / f"{name}.png").exists(): return name, "skip"
        if ep == "/create-image-pixen": body["detail"] = "highly detailed"
        return name, str(px.generate_image(name, body, OUT, endpoint=ep).name)
    except Exception as e:
        return name, f"ERR {str(e)[:200]}"

if __name__ == "__main__":
    want = sys.argv[1:]
    jobs = [j for j in JOBS if not want or any(j[0].startswith(w) for w in want)]
    # 慢的（pixen、v2）先提交
    jobs.sort(key=lambda j: 0 if j[1] != "/create-image-pixflux" else 1)
    print("jobs", len(jobs), flush=True)
    with ThreadPoolExecutor(max_workers=10) as pool:
        for n, r in pool.map(run, jobs): print(n, r, flush=True)
    print("全部完成", flush=True)
