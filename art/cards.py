"""花火：代码画的牌框、数字、角标、未知牌背、提示叠加图、迷你牌、空位、标记变体。
烟火图（PixelLab）按 selection.json 选定的种子取来，量化到每色色阶后放进牌框。

用法：python cards.py faces   # 用 selection.json 导出 25 张牌面和其他代码图到 out/final
      python cards.py preview <seed>  # 用某个种子拼一套 25 张预览，存 out/r1/preview-faces-s<seed>.png
"""
import json, math, pathlib, random, sys
from PIL import Image, ImageDraw

ART = pathlib.Path(__file__).parent
R1 = ART / "out" / "r1"
FINAL = ART / "out" / "final"

RAMP = {
    "R": ["#6e1420", "#d02a33", "#ff5b4f", "#ffc4b4"],
    "Y": ["#7a5200", "#e8a90c", "#ffd93d", "#fff6c4"],
    "G": ["#0d4a2a", "#23a052", "#52e07f", "#ccf8d8"],
    "B": ["#123a8a", "#2f7de8", "#63b8ff", "#d4eeff"],
    "W": ["#5a5a6e", "#b4b4c8", "#ececf4", "#ffffff"],
}
COLORS = list(RAMP)
P = {
    "ink": "#0b0f22", "sky0": "#141b3a", "sky1": "#202b56", "paper": "#ece2c8", "paper2": "#b9a57e",
    "vermilion": "#d8432b", "gold": "#f0c060", "gold2": "#a8782a", "star": "#5a6496",
}


def hx(c, a=255):
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4)) + (a,)


# ---------- 像素字 ----------
DIG = {  # 6x9
    "1": ["..XX..", ".XXX..", "XXXX..", "..XX..", "..XX..", "..XX..", "..XX..", "..XX..", "XXXXXX"],
    "2": [".XXXX.", "XX..XX", "....XX", "....XX", "...XX.", "..XX..", ".XX...", "XX....", "XXXXXX"],
    "3": [".XXXX.", "XX..XX", "....XX", "....XX", "..XXX.", "....XX", "....XX", "XX..XX", ".XXXX."],
    "4": ["...XX.", "..XXX.", ".XXXX.", "XX.XX.", "XX.XX.", "XXXXXX", "...XX.", "...XX.", "...XX."],
    "5": ["XXXXXX", "XX....", "XX....", "XXXXX.", "....XX", "....XX", "....XX", "XX..XX", ".XXXX."],
}
TINY = {  # 3x5
    "1": [".X.", "XX.", ".X.", ".X.", "XXX"], "2": ["XX.", "..X", ".X.", "X..", "XXX"],
    "3": ["XX.", "..X", ".X.", "..X", "XX."], "4": ["X.X", "X.X", "XXX", "..X", "..X"],
    "5": ["XXX", "X..", "XX.", "..X", "XX."],
}


def glyph(rows, scale, col, shadow=None):
    w, h = len(rows[0]) * scale, len(rows) * scale
    im = Image.new("RGBA", (w + (1 if shadow else 0), h + (1 if shadow else 0)), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    layers = ([(1, 1, shadow)] if shadow else []) + [(0, 0, col)]
    for ox, oy, c in layers:
        for y, row in enumerate(rows):
            for x, v in enumerate(row):
                if v == "X":
                    d.rectangle([ox + x * scale, oy + y * scale, ox + x * scale + scale - 1, oy + y * scale + scale - 1], fill=c)
    return im


def outlined(im, col=P["ink"]):
    """透明图外面加 1px 描边，尺寸各边 +1。"""
    w, h = im.size
    out = Image.new("RGBA", (w + 2, h + 2), (0, 0, 0, 0))
    a = im.getchannel("A")
    ink = Image.new("RGBA", im.size, hx(col))
    for dx, dy in ((0, 1), (2, 1), (1, 0), (1, 2), (0, 0), (2, 0), (0, 2), (2, 2)):
        out.paste(ink, (dx, dy), a)
    out.alpha_composite(im, (1, 1))
    return out


# ---------- 角标图形（10x10），色弱靠它认颜色 ----------
def _circle(fill, r0, r1):
    rows = []
    for y in range(10):
        rows.append("".join("X" if r0 <= math.hypot(x - 4.5, y - 4.5) <= r1 else "." for x in range(10)))
    return rows


ICON = {
    "R": _circle(True, 0, 4.8),
    "Y": ["...XXXX...", ".XXXXXXXX.", "XXXXXXXXXX", "XXXXXXXXXX", "X.X.XX.X.X", "X.X.XX.X.X",
          "X..X..X..X", "X..X..X..X", "X........X", "X........X"],
    "G": _circle(False, 3.0, 4.8),
    "B": ["X...XX...X", ".X..XX..X.", "..X.XX.X..", "...XXXX...", "XXXXXXXXXX", "XXXXXXXXXX", "...XXXX...",
          "..X.XX.X..", ".X..XX..X.", "X...XX...X"],
    "W": ["..X.......", ".XXX...X..", "..X...XXX.", ".......X..", "....X.....", "...XXX....", "....X..X..",
          ".X....XXX.", "XXX....X..", ".X........"],
}


def icon(c, col=None, outline=True):
    im = glyph(ICON[c], 1, hx(col or RAMP[c][2]))
    return outlined(im) if outline else im


# ---------- 牌框 ----------
CW, CH = 64, 96


def card_base(border=P["paper"], border2=P["paper2"], sky=(P["sky0"], P["sky1"]), seed=0, stars=True):
    c = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    d = ImageDraw.Draw(c)
    d.rectangle([0, 0, CW - 1, CH - 1], fill=hx(P["ink"]))
    d.rectangle([1, 1, CW - 2, CH - 2], fill=hx(border))
    d.rectangle([3, 3, CW - 4, CH - 4], fill=hx(border2))
    s0, s1 = hx(sky[0]), hx(sky[1])
    for y in range(4, CH - 4):
        t = (y - 4) / (CH - 9)
        col = tuple(round(s0[i] + (s1[i] - s0[i]) * t) for i in range(3)) + (255,)
        d.line([4, y, CW - 5, y], fill=col)
    if stars:
        rnd = random.Random(seed)
        for _ in range(9):
            x, y = rnd.randrange(6, CW - 6), rnd.randrange(28, CH - 12)
            d.point((x, y), fill=hx(P["star"]))
    for (x, y) in ((0, 0), (CW - 1, 0), (0, CH - 1), (CW - 1, CH - 1)):  # 圆角
        c.putpixel((x, y), (0, 0, 0, 0))
    for (x, y) in ((1, 1), (CW - 2, 1), (1, CH - 2), (CW - 2, CH - 2)):
        c.putpixel((x, y), hx(P["ink"]))
    return c


def quantize(im, c):
    """烟火图量化到该色的 4 级色阶（按 RGB 最近），去掉半透明杂边。"""
    ramp = [hx(h) for h in RAMP[c]]
    im = im.convert("RGBA").copy()
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a < 128:
                px[x, y] = (0, 0, 0, 0)
                continue
            L = 0.3 * r + 0.59 * g + 0.11 * b
            if L < 40:  # 几乎是黑的：当背景去掉
                px[x, y] = (0, 0, 0, 0)
                continue
            best = min(ramp, key=lambda q: (q[0] - r) ** 2 + (q[1] - g) ** 2 + (q[2] - b) ** 2 + 2 * (0.3 * q[0] + 0.59 * q[1] + 0.11 * q[2] - L) ** 2)
            px[x, y] = best
    bb = im.getbbox()
    return im.crop(bb) if bb else im


def firework(c, r, seed):
    p = R1 / f"fw-{c}{r}-s{seed}.png"
    return quantize(Image.open(p), c)


FW_BOX = (4, 26, CW - 4, 86)  # 烟火可用区域


def face(c, r, fw):
    card = card_base(seed=COLORS.index(c) * 10 + r)
    bw, bh = FW_BOX[2] - FW_BOX[0], FW_BOX[3] - FW_BOX[1]
    if fw.width > bw or fw.height > bh:  # 极少数超出：整数倍缩不了，只能居中裁
        fw = fw.crop(((fw.width - min(fw.width, bw)) // 2, (fw.height - min(fw.height, bh)) // 2,
                      (fw.width + min(fw.width, bw)) // 2, (fw.height + min(fw.height, bh)) // 2))
    card.alpha_composite(fw, (FW_BOX[0] + (bw - fw.width) // 2, FW_BOX[1] + (bh - fw.height) // 2))
    card.alpha_composite(glyph(DIG[str(r)], 2, hx(RAMP[c][2] if c != "W" else RAMP[c][3]), shadow=hx(P["ink"])), (6, 6))
    card.alpha_composite(icon(c), (CW - 6 - 12, 6))
    d = ImageDraw.Draw(card)
    x0 = (CW - (r * 4 - 2)) // 2
    for i in range(r):
        d.rectangle([x0 + i * 4, 88, x0 + i * 4 + 1, 89], fill=hx(RAMP[c][2]))
    return card


# ---------- 牌背 ----------
def code_back():
    c = card_base(sky=("#1b2552", "#1b2552"), stars=False)
    d = ImageDraw.Draw(c)
    wave = hx("#30418a")
    for cy in range(10, CH - 4, 6):
        for cx in range(4 + (cy // 6 % 2) * 5, CW - 3, 10):
            for rr in (5, 3, 1):
                d.arc([cx - rr, cy - rr, cx + rr, cy + rr], 180, 360, fill=wave)
    cx, cy = CW // 2, CH // 2
    d.ellipse([cx - 15, cy - 15, cx + 15, cy + 15], fill=hx("#141b3a"), outline=hx(P["gold"]))
    for a in range(12):
        dx, dy = math.cos(a * math.pi / 6), math.sin(a * math.pi / 6)
        d.line([cx + dx * 4, cy + dy * 4, cx + dx * 11, cy + dy * 11], fill=hx(P["gold"] if a % 2 else P["vermilion"]))
    d.rectangle([cx - 1, cy - 1, cx, cy], fill=hx("#ffffff"))
    return c


def dim(im, k=0.55, sat=0.6):
    im = im.copy()
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            l = 0.3 * r + 0.59 * g + 0.11 * b
            r, g, b = (l + (v - l) * sat for v in (r, g, b))
            px[x, y] = (int(r * k), int(g * k), int(b * k), a)
    return im


def dashed_rect(d, box, col, dash=2):
    x0, y0, x1, y1 = box
    for x in range(x0, x1 + 1):
        if (x - x0) // dash % 2 == 0:
            d.point((x, y0), fill=col); d.point((x, y1), fill=col)
    for y in range(y0, y1 + 1):
        if (y - y0) // dash % 2 == 0:
            d.point((x0, y), fill=col); d.point((x1, y), fill=col)


def _shade(im, box, rgba):
    """半透明色块叠在不透明的牌上（混色，不把牌挖成半透明）。"""
    ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ImageDraw.Draw(ov).rectangle(list(box), fill=rgba)
    im.alpha_composite(ov)


def unknown(back):
    c = dim(back, 0.6, 0.5)
    d = ImageDraw.Draw(c)
    ov = Image.new("RGBA", c.size, (0, 0, 0, 0)); od = ImageDraw.Draw(ov)
    slot = hx(P["paper"], 150)
    dashed_rect(od, (5, 5, 20, 26), slot)       # 数字位 16x22
    dashed_rect(od, (CW - 21, 5, CW - 6, 20), slot)  # 颜色位 16x16
    c.alpha_composite(ov)
    _shade(c, (4, 65, CW - 5, 91), (8, 10, 24, 170))  # 排除信息位 56x27：上排排除颜色、下排排除数字，各最多 4 个
    return c


def unknown_colored(back, c):
    base = card_base(border=RAMP[c][2], border2=RAMP[c][1], sky=(P["sky0"], RAMP[c][0]), stars=False)
    big = glyph(ICON[c], 3, hx(RAMP[c][1], 120))
    base.alpha_composite(big, ((CW - big.width) // 2, 34))
    ov = Image.new("RGBA", base.size, (0, 0, 0, 0))
    dashed_rect(ImageDraw.Draw(ov), (5, 5, 20, 26), hx(P["paper"], 150))
    base.alpha_composite(ov)
    base.alpha_composite(clue_color(c), (CW - 21, 5))
    _shade(base, (4, 65, CW - 5, 91), (8, 10, 24, 150))
    return base


def glow():
    g = Image.new("RGBA", (CW + 8, CH + 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(g)
    for i, a in enumerate((60, 120, 200, 255)):
        d.rounded_rectangle([i, i, g.width - 1 - i, g.height - 1 - i], radius=4 - i if i < 4 else 0, outline=hx(P["gold"], a))
    return g


# ---------- 提示叠加 ----------
def clue_color(c):
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([0, 0, 15, 15], fill=hx(P["ink"]))
    d.ellipse([1, 1, 14, 14], fill=hx(RAMP[c][1] if c != "W" else RAMP[c][2]))
    ic = glyph(ICON[c], 1, hx("#ffffff") if c != "W" else hx(P["ink"]))
    im.alpha_composite(ic, (3, 3))
    return im


def clue_rank(r):
    im = Image.new("RGBA", (16, 22), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 15, 21], fill=hx(P["ink"]))
    d.rectangle([1, 1, 14, 20], fill=hx(P["paper"]))
    im.alpha_composite(glyph(DIG[str(r)], 2, hx(P["ink"])), (2, 2))
    return im


def slash(im, col=hx(P["vermilion"])):
    d = ImageDraw.Draw(im)
    d.line([0, im.height - 1, im.width - 1, 0], fill=col, width=2)
    return im


def _not_chip():
    im = Image.new("RGBA", (12, 12), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 11, 11], fill=hx(P["ink"], 230))
    d.rectangle([0, 0, 11, 11], outline=hx("#3a4270"))
    return im


def _not_slash(im):
    d = ImageDraw.Draw(im)
    d.line([1, 10, 10, 1], fill=hx(P["ink"]), width=3)
    d.line([1, 10, 10, 1], fill=hx(P["paper"]), width=1)
    return im


def not_color(c):
    """排除颜色：深色小方块里放该色角标图形，再压一道和纸色斜杠。"""
    im = _not_chip()
    im.alpha_composite(glyph(ICON[c], 1, hx(RAMP[c][2])), (1, 1))
    return _not_slash(im)


def not_rank(r):
    im = _not_chip()
    im.alpha_composite(glyph(TINY[str(r)], 2, hx(P["paper"]))[0:0] if False else glyph(TINY[str(r)], 2, hx(P["paper"])).crop((0, 0, 6, 10)), (3, 1))
    return _not_slash(im)


# ---------- 迷你牌 24x34 ----------
def mini(c=None, r=None, kind="face"):
    im = Image.new("RGBA", (24, 34), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 23, 33], fill=hx(P["ink"]))
    if kind == "back":
        d.rectangle([1, 1, 22, 32], fill=hx("#1b2552"))
        d.rectangle([2, 2, 21, 31], outline=hx(P["gold"]))
        d.ellipse([8, 13, 15, 20], outline=hx(P["vermilion"]))
    elif kind == "unknown":
        d.rectangle([1, 1, 22, 32], fill=hx("#2a2f4a"))
        dashed_rect(d, (3, 3, 20, 30), hx(P["paper"], 120))
    else:
        d.rectangle([1, 1, 22, 32], fill=hx(RAMP[c][1] if c != "W" else RAMP[c][2]))
        d.line([1, 1, 22, 1], fill=hx(RAMP[c][3])); d.line([1, 1, 1, 32], fill=hx(RAMP[c][3]))
        fg = hx("#ffffff") if c != "W" else hx(P["ink"])
        im.alpha_composite(glyph(DIG[str(r)], 2, fg, shadow=hx(RAMP[c][0]) if c != "W" else None), (6, 3))
        im.alpha_composite(glyph(ICON[c], 1, fg), (7, 22))
    for (x, y) in ((0, 0), (23, 0), (0, 33), (23, 33)):
        im.putpixel((x, y), (0, 0, 0, 0))
    return im


def slot(c):
    im = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([1, 1, CW - 2, CH - 2], fill=(10, 14, 34, 110))
    dashed_rect(d, (1, 1, CW - 2, CH - 2), hx(RAMP[c][2], 200), dash=3)
    big = glyph(ICON[c], 3, hx(RAMP[c][1], 150))
    im.alpha_composite(big, ((CW - big.width) // 2, (CH - big.height) // 2))
    return im


def icon_clue_color():
    im = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.line([12, 23, 12, 14], fill=hx("#7a5230"), width=2)  # 扇柄
    d.pieslice([1, 1, 22, 22], 180, 360, fill=hx(P["ink"]))
    for i, c in enumerate(COLORS):
        a0 = 180 + i * 36
        d.pieslice([2, 2, 21, 21], a0, a0 + 36, fill=hx(RAMP[c][1] if c != "W" else RAMP[c][2]))
    d.ellipse([10, 10, 13, 13], fill=hx(P["paper"]))
    return outlined(im.crop(im.getbbox())).crop((0, 0, 24, 24)) if False else im


def icon_clue_rank():
    im = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rectangle([5, 1, 18, 22], fill=hx(P["ink"]))
    d.rectangle([6, 2, 17, 21], fill=hx(P["paper"]))
    for y in (6, 10, 14):
        d.line([8, y, 15, y], fill=hx(P["ink"]))
    d.rectangle([8, 17, 9, 18], fill=hx(P["vermilion"])); d.rectangle([12, 17, 13, 18], fill=hx(P["vermilion"]))
    return im


# ---------- 标记变体 ----------
def miss_empty():
    im = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for a in range(0, 360, 20):
        d.arc([3, 3, 28, 28], a, a + 10, fill=hx(RAMP["R"][1], 200), width=2)
    return im


def save(im, rel):
    p = FINAL / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    im.save(p)
    return p


def preview(seed):
    """某一个种子的 25 张牌面拼成一张，放大 2 倍。"""
    sheet = Image.new("RGBA", ((CW + 6) * 5 + 6, (CH + 6) * 5 + 6), hx("#2a2a35"))
    for i, c in enumerate(COLORS):
        for r in range(1, 6):
            try:
                f = face(c, r, firework(c, r, seed))
            except FileNotFoundError:
                continue
            sheet.alpha_composite(f, (6 + (r - 1) * (CW + 6), 6 + i * (CH + 6)))
    sheet = sheet.resize((sheet.width * 2, sheet.height * 2), Image.NEAREST)
    out = R1 / f"preview-faces-s{seed}.png"
    sheet.save(out)
    return out


if __name__ == "__main__":
    if sys.argv[1] == "preview":
        for s in sys.argv[2:]:
            print(preview(int(s)))
