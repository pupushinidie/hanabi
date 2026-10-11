"""按 selection.json 导出全部定稿到 out/final（目录结构 = apps/web/public/art）。
python build.py            # 全部导出
"""
import json, pathlib, shutil
from PIL import Image, ImageDraw
import cards as C
import fx

ART = pathlib.Path(__file__).parent
R1 = ART / "out" / "r1"
FINAL = ART / "out" / "final"
SEL = json.loads((ART / "selection.json").read_text())


def v2(name, idx):
    p = R1 / name / (f"{name}.png" if idx == 0 else f"{name}-{idx}.png")
    return Image.open(p).convert("RGBA")


def trim(im):
    a = im.getchannel("A").point(lambda v: 255 if v > 60 else 0)
    bb = a.getbbox()
    im = im.crop(bb)
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            if px[x, y][3] <= 60:
                px[x, y] = (0, 0, 0, 0)
            elif px[x, y][3] < 255:
                px[x, y] = px[x, y][:3] + (255,)
    return im


def pad(im, w, h):
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.alpha_composite(im, ((w - im.width) // 2, (h - im.height) // 2))
    return out


def save(im, rel):
    p = FINAL / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    im.save(p)
    return p


def normalize_back(im):
    """PixelLab 牌背：套上和牌面一样的 1px 深靛描边和圆角。"""
    im = im.convert("RGBA").copy()
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, C.CW - 1, C.CH - 1], outline=C.hx(C.P["ink"]))
    for (x, y) in ((0, 0), (C.CW - 1, 0), (0, C.CH - 1), (C.CW - 1, C.CH - 1)):
        im.putpixel((x, y), (0, 0, 0, 0))
    for (x, y) in ((1, 1), (C.CW - 2, 1), (1, C.CH - 2), (C.CW - 2, C.CH - 2)):
        im.putpixel((x, y), C.hx(C.P["ink"]))
    return im


def white_cluster(r, sparks):
    """白色「千轮」：r+1 朵小火花聚成一簇，簇的大小随数字变大。"""
    layouts = {
        1: [(0, -5), (-6, 6)],
        2: [(-7, -6), (7, -4), (0, 7)],
        3: [(-9, -8), (9, -7), (-8, 8), (8, 9)],
        4: [(0, -13), (-13, -3), (13, -2), (-7, 12), (8, 13)],
        5: [(0, 0), (-16, -12), (15, -13), (-18, 8), (18, 7), (-4, 19), (6, -21)],
    }
    S = 60
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    pts = layouts[r]
    for i, (dx, dy) in enumerate(pts):
        sp = sparks[i % len(sparks)]
        out.alpha_composite(sp, (S // 2 + dx - sp.width // 2, S // 2 + dy - sp.height // 2))
    return C.quantize(out, "W")


def build_rack(src, tube_x, beam_x):
    """取 PixelLab 发射架里的一根竹筒和一段横梁，重排成 5 根等距（中心 x = 36 + 72i）。"""
    im = Image.open(R1 / src).convert("RGBA")
    W, H = 360, im.height
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    seg = im.crop((beam_x[0], 0, beam_x[1], H))
    for x in range(0, W, seg.width):
        out.alpha_composite(seg, (x, 0))
    tube = im.crop((tube_x[0], 0, tube_x[1], H))
    for i in range(5):
        cx = 36 + 72 * i
        out.alpha_composite(tube, (cx - tube.width // 2, 0))
    return trim_rows(out)


def trim_rows(im):
    bb = im.getbbox()
    return im.crop((0, bb[1], im.width, bb[3]))


def main():
    if FINAL.exists():
        shutil.rmtree(FINAL)
    s = SEL
    # 场景
    for k in ("night", "day"):
        bg = Image.open(R1 / s["bg"][k]).convert("RGB")
        save(bg, f"bg/{k}.png")
        save(bg.resize((bg.width * 3, bg.height * 3), Image.NEAREST), f"bg/{k}@3x.png")
    # 烟火牌面
    sparks = [trim(v2("spark-W", i)) for i in s["sparkW"]] if s.get("sparkW") else None
    for c in C.COLORS:
        for r in range(1, 6):
            if c == "W" and sparks:
                fw = white_cluster(r, sparks)
            else:
                fw = C.firework(c, r, s["fw"][c][r - 1])
            save(C.face(c, r, fw), f"cards/{c}{r}.png")
            save(fw, f"cards/fw/{c}{r}.png")
            save(C.mini(c, r), f"cards/mini/{c}{r}.png")
    back = normalize_back(Image.open(R1 / s["back"])) if s["back"] != "code" else C.code_back()
    save(back, "cards/back.png")
    save(C.unknown(back), "cards/unknown.png")
    for c in C.COLORS:
        save(C.unknown_colored(back, c), f"cards/unknown-{c}.png")
        save(C.clue_color(c), f"clue/color-{c}.png")
        save(C.not_color(c), f"clue/not-color-{c}.png")
        save(C.slot(c), f"ui/slot-{c}.png")
    for r in range(1, 6):
        save(C.clue_rank(r), f"clue/rank-{r}.png")
        save(C.not_rank(r), f"clue/not-rank-{r}.png")
    save(C.glow(), "cards/glow.png")
    save(C.mini(kind="back"), "cards/mini/back.png")
    save(C.mini(kind="unknown"), "cards/mini/unknown.png")
    # 标记、图标
    tok = {k: pad(trim(v2(*s["v2"][k])), 32, 32) for k in ("clue", "miss", "boom")}
    save(tok["clue"], "tokens/clue.png")
    save(C.dim(tok["clue"], 0.45, 0.15), "tokens/clue-used.png")
    save(tok["miss"], "tokens/miss.png")
    save(C.miss_empty(), "tokens/miss-empty.png")
    save(tok["boom"], "tokens/boom.png")
    save(C.dim(tok["boom"], 0.5, 0.35), "tokens/boom-empty.png")
    for k in ("play", "discard", "deck"):
        save(pad(trim(v2(*s["v2"][k])), 32, 32), f"icons/{k}.png")
    save(pad(C.icon_clue_color(), 32, 32), "icons/clue-color.png")
    save(pad(C.icon_clue_rank(), 32, 32), "icons/clue-rank.png")
    # 展示架
    rk = s["rack"]
    save(build_rack(rk["src"], rk["tube_x"], rk["beam_x"]), "ui/rack.png")
    # 特效
    fx.export_all(R1 / s["bg"]["night"])
    # 封面（不进 public）
    cov = ART / "out" / "covers"
    cov.mkdir(parents=True, exist_ok=True)
    for i, name in enumerate(s["covers"], 1):
        im = Image.open(R1 / name).convert("RGB")
        px = im.load()
        top = 0
        while top < im.height and max(sum(px[x, top]) for x in range(im.width)) < 40:
            top += 1
        bot = im.height
        while bot > top and max(sum(px[x, bot - 1]) for x in range(im.width)) < 40:
            bot -= 1
        im.crop((0, top, im.width, bot)).save(cov / f"hanabi-c{i}.png")
    print("导出完成", sum(1 for _ in FINAL.rglob("*.png")), "张")


if __name__ == "__main__":
    main()
