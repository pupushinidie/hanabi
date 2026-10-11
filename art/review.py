"""定稿总览：夜间背景上一份、白底上一份，牌 2×、小图 2×，右边一列 1× 看实际大小。"""
import pathlib
from PIL import Image
import cards as C
ART = pathlib.Path(__file__).parent; F = ART / "out" / "final"
def L(p): return Image.open(F / p).convert("RGBA")
def x2(im, k=2): return im.resize((im.width * k, im.height * k), Image.NEAREST)
def panel(bg):
    W, H = 1500, 1080
    o = Image.new("RGBA", (W, H), bg if not isinstance(bg, str) else (0, 0, 0, 255))
    if bg == "night":
        b = Image.open(F / "bg/night@3x.png").convert("RGBA").crop((0, 0, W, H)) if False else x2(L("bg/night.png"), 3).crop((0, 0, W, H))
        o = b; o.alpha_composite(Image.new("RGBA", (W, H), (0, 0, 0, 77)))
    elif bg == "day":
        b = x2(L("bg/day.png"), 3).crop((0, 0, W, H)); o = b; o.alpha_composite(Image.new("RGBA", (W, H), (255, 255, 255, 38)))
    y = 10
    for c in C.COLORS:  # 每色 1-5，1× 一排
        for r in range(1, 6):
            o.alpha_composite(L(f"cards/{c}{r}.png"), (10 + (r - 1) * 68, y))
        y += 100
    # 2× 的一排 4
    x = 360
    for i, c in enumerate(C.COLORS):
        o.alpha_composite(x2(L(f"cards/{c}4.png")), (x + i * 134, 10))
    o.alpha_composite(x2(L("cards/back.png")), (x, 210))
    u = L("cards/unknown.png"); u.alpha_composite(L("clue/rank-3.png"), (5, 5)); u.alpha_composite(L("clue/not-color-R.png"), (5, 66)); u.alpha_composite(L("clue/not-color-B.png"), (18, 66)); u.alpha_composite(L("clue/not-color-W.png"), (31, 66)); u.alpha_composite(L("clue/not-rank-1.png"), (5, 79)); u.alpha_composite(L("clue/not-rank-5.png"), (18, 79))
    o.alpha_composite(x2(u), (x + 134, 210))
    for i, c in enumerate("RGW"):
        uc = L(f"cards/unknown-{c}.png")
        if c == "G": uc.alpha_composite(L("clue/rank-2.png"), (5, 5))
        o.alpha_composite(x2(uc), (x + 268 + i * 134, 210))
    o.alpha_composite(x2(L("cards/glow.png")), (x + 670 - 8, 210 - 8))
    yy = 420
    for i, t in enumerate(["clue", "clue", "clue-used", "miss", "miss", "boom", "miss-empty", "boom-empty"]):
        o.alpha_composite(x2(L(f"tokens/{t}.png")), (x + i * 72, yy))
    for i, t in enumerate(["play", "discard", "deck", "clue-color", "clue-rank"]):
        o.alpha_composite(x2(L(f"icons/{t}.png")), (x + i * 72, yy + 80))
    for i, c in enumerate(C.COLORS):
        o.alpha_composite(x2(L(f"clue/color-{c}.png")), (x + 380 + i * 40, yy + 80))
    rack = x2(L("ui/rack.png"))
    o.alpha_composite(rack, (x, 1060 - rack.height))
    for i, c in enumerate(C.COLORS):
        im = x2(L(f"cards/{c}{i+1}.png") if i < 3 else L(f"ui/slot-{c}.png"))
        o.alpha_composite(im, (x + 72 * 2 * i + 8, 1060 - rack.height - 150))
    for i, c in enumerate(C.COLORS):
        for r in range(1, 6):
            o.alpha_composite(x2(L(f"cards/mini/{c}{r}.png")), (1180 + (r - 1) * 52, 420 + i * 72))
    return o
for k in ("night", "day", (255, 255, 255, 255)):
    p = panel(k); n = k if isinstance(k, str) else "white"
    p.save(ART / "out" / "review" / f"final-{n}.png")
print("ok")
