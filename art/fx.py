"""花火：代码画的特效动画（横排精灵图）+ GIF 预览。
burst-<色>：每色按自己的轮廓炸开（牡丹实心球 / 垂柳下垂 / 光环 / 菊放射线 / 千轮连环小爆）。
launch：升空火线。misfire：哑火冒烟。clue：提示金光。finale-0..5：结算六档大烟火（循环）。
lanterns-night：夜间背景灯笼火光闪烁叠加层。
"""
import math, pathlib, random, sys
from PIL import Image, ImageDraw
from cards import RAMP, COLORS, P, hx, FINAL, ART

PREV = ART / "out" / "fxpreview"


def strip(frames):
    w, h = frames[0].size
    s = Image.new("RGBA", (w * len(frames), h), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        s.alpha_composite(f, (i * w, 0))
    return s


def gif(frames, path, ms, bg=(20, 27, 58), scale=2):
    PREV.mkdir(parents=True, exist_ok=True)
    out = []
    for f in frames:
        b = Image.new("RGBA", f.size, bg + (255,))
        b.alpha_composite(f)
        out.append(b.convert("RGB").resize((f.width * scale, f.height * scale), Image.NEAREST))
    out[0].save(path, save_all=True, append_images=out[1:], duration=ms, loop=0, disposal=2)


def age_color(c, t):
    """t: 0..1 粒子寿命进度 → 高光、亮、中、暗。"""
    r = RAMP[c]
    return hx(r[3] if t < 0.2 else r[2] if t < 0.5 else r[1] if t < 0.78 else r[0])


def dot(d, x, y, col, size=1):
    x, y = round(x), round(y)
    if size == 1:
        d.point((x, y), fill=col)
    else:
        d.rectangle([x, y, x + size - 1, y + size - 1], fill=col)


def draw_burst(d, c, cx, cy, R, age, life, rnd_seed=0):
    """在 d 上画一朵 c 色烟火在 age 帧时的样子（age<0 或 >=life 不画）。"""
    if age < 0 or age >= life:
        return
    t = age / (life - 1)
    rnd = random.Random(rnd_seed)
    ease = 1 - (1 - min(1, t * 1.6)) ** 2  # 前段快速炸开
    if age == 0:
        d.ellipse([cx - 2, cy - 2, cx + 2, cy + 2], fill=hx(RAMP[c][3]))
        return
    if 1 <= age <= 4 and c in "RGB":  # 刚炸开时一圈淡淡的光晕
        rr = R * ease * 0.9
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=hx(RAMP[c][1], 34 - age * 6))
    big = 2 if t < 0.55 else 1
    if c == "R":  # 牡丹：三层实心球，每颗火星带短尾
        for shell, n in ((1.0, 40), (0.7, 28), (0.4, 14)):
            for i in range(n):
                a = i / n * 2 * math.pi + shell * 1.3
                r = R * shell * ease
                fall = t * t * R * 0.18
                x, y = cx + math.cos(a) * r, cy + math.sin(a) * r + fall
                if t > 0.6 and rnd.random() < (t - 0.6) * 2:
                    continue
                if t < 0.7:
                    x0, y0 = cx + math.cos(a) * r * 0.85, cy + math.sin(a) * r * 0.85 + fall
                    d.line([x0, y0, x, y], fill=age_color(c, min(1, t + 0.3)))
                dot(d, x, y, age_color(c, t), big)
    elif c == "Y":  # 垂柳：向上向外，然后长长垂落拖尾
        for i in range(22):
            a = -math.pi - 0.25 + i / 21 * (math.pi + 0.5)
            a += rnd.uniform(-0.06, 0.06)
            pts = []
            for k in range(age + 1):
                tt = k / (life - 1)
                e = 1 - (1 - min(1, tt * 1.8)) ** 2
                pts.append((cx + math.cos(a) * R * 0.8 * e, cy + math.sin(a) * R * 0.55 * e + (tt ** 1.5) * R * 1.0))
            tail = pts[-9:]
            for j in range(len(tail) - 1):
                tj = t + (len(tail) - 2 - j) * 0.07
                d.line([tail[j], tail[j + 1]], fill=age_color(c, min(1, tj + 0.15)))
            dot(d, tail[-1][0], tail[-1][1], age_color(c, t * 0.7), big)
    elif c == "G":  # 光环：双线圆环，略扁
        n = 40
        for ring, k in ((1.0, 0), (0.9, 1)):
            for i in range(n):
                a = i / n * 2 * math.pi + k * 0.08
                x, y = cx + math.cos(a) * R * ring * ease, cy + math.sin(a) * R * 0.85 * ring * ease + t * t * R * 0.12
                if t > 0.7 and rnd.random() < (t - 0.7) * 2.5:
                    continue
                dot(d, x, y, age_color(c, min(1, t + 0.1 * k)), big if k == 0 else 1)
    elif c == "B":  # 菊：放射长线 + 亮尖
        n = 20
        for i in range(n):
            a = i / n * 2 * math.pi
            r1 = R * ease * (1.0 if i % 2 == 0 else 0.82)
            r0 = max(0, r1 - R * (0.6 if t < 0.6 else 0.3))
            x0, y0 = cx + math.cos(a) * r0, cy + math.sin(a) * r0 + t * t * 3
            x1, y1 = cx + math.cos(a) * r1, cy + math.sin(a) * r1 + t * t * 3
            d.line([x0, y0, x1, y1], fill=age_color(c, min(1, t + 0.25)), width=1)
            dot(d, x1 - (big - 1), y1 - (big - 1), age_color(c, t * 0.6), big)
    elif c == "W":  # 千轮：一簇小爆依次闪
        subs = [(rnd.uniform(-0.65, 0.65) * R, rnd.uniform(-0.6, 0.6) * R, rnd.randrange(0, max(1, life // 2))) for _ in range(10)]
        for sx, sy, s0 in subs:
            k = age - s0
            sl = life // 2 + 1
            if 0 <= k < sl:
                tt = k / (sl - 1)
                rr = 2 + tt * R * 0.32
                col = age_color(c, tt)
                for j in range(8):
                    a = j / 8 * 2 * math.pi + s0
                    dot(d, cx + sx + math.cos(a) * rr, cy + sy + math.sin(a) * rr, col, 2 if tt < 0.3 and j % 2 == 0 else 1)
                if tt < 0.5:  # 十字闪光
                    x, y = round(cx + sx), round(cy + sy)
                    L = 3 if tt < 0.25 else 2
                    d.line([x - L, y, x + L, y], fill=hx(RAMP[c][3])); d.line([x, y - L, x, y + L], fill=hx(RAMP[c][3]))


def burst(c, size=96, frames=16):
    out = []
    for f in range(frames):
        im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        if f < frames - 1:
            draw_burst(ImageDraw.Draw(im), c, size // 2, size // 2 - 4, size * 0.4, f, frames - 1, rnd_seed=7)
        out.append(im)
    return out


def launch(frames=8):
    out = []
    for f in range(frames):
        im = Image.new("RGBA", (16, 96), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        if f == frames - 1:  # 末帧空：接着播 burst
            out.append(im); continue
        y = 92 - f * 14
        for k in range(6):
            yy = y + k * 3
            if yy < 96:
                d.point((8 + (k % 2) * (1 if f % 2 else -1), yy), fill=hx(P["gold"] if k < 2 else "#a8782a", 255 - k * 35))
        d.rectangle([7, y - 1, 8, y], fill=hx("#fff6c4"))
        out.append(im)
    return out


def misfire(frames=12):
    out = []
    rnd = random.Random(3)
    sparks = [(rnd.uniform(0, 2 * math.pi), rnd.uniform(6, 22)) for _ in range(14)]
    puffs = [(rnd.uniform(-12, 12), rnd.uniform(-6, 6), rnd.uniform(3, 7)) for _ in range(7)]
    for f in range(frames):
        im = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        t = f / (frames - 1)
        if f < frames - 1:
            if f < 3:  # 闷闷的红光
                d.ellipse([32 - 6 - f * 2, 34 - 6 - f * 2, 32 + 6 + f * 2, 34 + 6 + f * 2], fill=hx(RAMP["R"][1], 200 - f * 50))
            for px_, py_, pr in puffs:  # 黑烟上升变大变淡
                r = pr * (0.5 + t)
                a = int(220 * (1 - t))
                y = 34 + py_ - t * 18
                d.ellipse([32 + px_ - r, y - r, 32 + px_ + r, y + r], fill=(58, 58, 70, a))
                d.ellipse([32 + px_ - r * 0.6 - 1, y - r * 0.6 - 1, 32 + px_ + r * 0.3, y + r * 0.2], fill=(96, 96, 110, a))
            for a, sp in sparks:  # 乱溅的火星往下掉
                if t < 0.75:
                    x = 32 + math.cos(a) * sp * min(1, t * 2.2)
                    y = 34 + math.sin(a) * sp * min(1, t * 2.2) + t * t * 20
                    d.point((x, y), fill=hx("#ff9a3c" if t < 0.4 else "#a8432b"))
        out.append(im)
    return out


def clue_glow(frames=8):
    out = []
    for f in range(frames):
        im = Image.new("RGBA", (72, 104), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        k = math.sin(f / (frames - 1) * math.pi)
        for i in range(4):
            a = int(255 * k * (i + 1) / 4)
            d.rectangle([i, i, 71 - i, 103 - i], outline=hx(P["gold"], a))
        # 一个亮点沿边框跑一圈
        per = 2 * (72 + 104)
        pos = f / frames * per
        x, y = (pos, 0) if pos < 72 else (71, pos - 72) if pos < 176 else (71 - (pos - 176), 103) if pos < 248 else (0, 103 - (pos - 248))
        d.rectangle([x - 1, y - 1, x + 2, y + 2], fill=hx("#fff6c4", int(255 * max(k, 0.3))))
        out.append(im)
    return out


TIERS = {  # 每档一个循环里放哪些烟火：(颜色, 半径, 起始帧)
    0: [],
    1: [("Y", 22, 4)],
    2: [("R", 26, 2), ("G", 22, 13)],
    3: [("B", 30, 1), ("Y", 26, 9), ("R", 22, 16)],
    4: [("R", 34, 0), ("G", 28, 5), ("B", 30, 10), ("W", 30, 15), ("Y", 32, 19)],
    5: [("R", 40, 0), ("Y", 44, 3), ("G", 34, 6), ("B", 40, 9), ("W", 36, 12), ("R", 28, 15), ("B", 30, 18), ("G", 30, 21), ("Y", 36, 22)],
}


def finale(tier, frames=24, w=256, h=144):
    rnd = random.Random(tier * 31 + 5)
    n = max(1, len(TIERS[tier]))
    order = list(range(n)); rnd.shuffle(order)
    shows = []  # 横向均匀铺开（错开先后），纵向留出炸开半径和垂柳下垂的空间
    for i, (c, R, s) in enumerate(TIERS[tier]):
        x = int((order[i] + 0.5) * w / n + rnd.uniform(-8, 8))
        x = max(R + 2, min(w - R - 2, x))
        y_lo, y_hi = R + 2, max(R + 3, h - R - (34 if c == "Y" else 12))
        shows.append((c, R, s, x, rnd.randrange(y_lo, min(y_hi, 78) if y_hi > y_lo else y_lo + 1)))
    out = []
    life = 14
    for f in range(frames):
        im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        if tier == 0:  # 哑火：一根火线升到一半，冒一团烟
            k = f % frames
            if k < 8:
                y = h - 8 - k * 7
                d.rectangle([w // 2, y, w // 2 + 1, y + 3], fill=hx("#a8782a"))
            elif k < 22:
                t = (k - 8) / 14
                for j, (dx, dy) in enumerate(((-6, 0), (5, -3), (0, -8), (-2, 5))):
                    r = 4 + t * 8 + j
                    cx, cy = w // 2 + dx, h - 64 + dy - t * 10
                    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(70, 70, 84, int(200 * (1 - t))))
                for j in range(4):
                    d.point((w // 2 - 6 + j * 4, h - 60 + t * t * 40 + j * 2), fill=hx("#a8432b"))
        for c, R, s, cx, cy in shows:
            age = (f - s) % frames
            if age < 3:  # 升空
                y = h - (h - cy) * (age + 1) / 3
                d.rectangle([cx, y, cx + 1, y + 4], fill=hx(P["gold"]))
            else:
                draw_burst(d, c, cx, cy, R, age - 3, life, rnd_seed=cx)
        out.append(im)
    return out


def lanterns(bg_path, frames=4, region=(0, 60, 330, 230)):
    """找夜间背景里的灯笼（暖色高亮团），给每个加一圈随帧变化的半透明暖光。"""
    bg = Image.open(bg_path).convert("RGB")
    W, H = bg.size
    px = bg.load()
    mask = [[False] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            r, g, b = px[x, y]
            if r > 215 and g > 175 and 100 < b < 225 and r - b > 40:  # 灯笼纸的奶油暖色
                mask[y][x] = True
    seen = [[False] * W for _ in range(H)]
    blobs = []
    for y in range(H):
        for x in range(W):
            if mask[y][x] and not seen[y][x]:
                st = [(x, y)]; seen[y][x] = True; pts = []
                while st:
                    a, b = st.pop(); pts.append((a, b))
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        u, v = a + dx, b + dy
                        if 0 <= u < W and 0 <= v < H and mask[v][u] and not seen[v][u]:
                            seen[v][u] = True; st.append((u, v))
                xs, ys = [p[0] for p in pts], [p[1] for p in pts]
                bw, bh = max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
                # 灯笼是实心的小团；烟火是稀疏的细线，填充率低
                cx0, cy0 = sum(xs) / len(xs), sum(ys) / len(ys)
                inside = region[0] <= cx0 <= region[2] and region[1] <= cy0 <= region[3]  # 只取灯笼串所在区域（这张图左半到中间），避开天上的烟火亮心
                if inside and len(pts) >= 4 and bw >= 2 and bh >= 2 and len(pts) / (bw * bh) > 0.55 and 0.4 < bw / bh < 2.5:
                    blobs.append((sum(xs) / len(xs), sum(ys) / len(ys), max(2, (max(xs) - min(xs) + max(ys) - min(ys)) / 3)))
    rnd = random.Random(9)
    phases = [rnd.uniform(0, 2 * math.pi) for _ in blobs]
    out = []
    for f in range(frames):
        im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        for (cx, cy, r), ph in zip(blobs, phases):
            k = 0.5 + 0.5 * math.sin(ph + f / frames * 2 * math.pi)
            rr = r + 1 + k * 1.5
            d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(255, 190, 90, int(25 + 45 * k)))
        out.append(im)
    return out, len(blobs)


def export_all(night_bg=None):
    for c in COLORS:
        fr = burst(c)
        strip(fr).save(FINAL / f"fx/burst-{c}.png") if (FINAL / "fx").mkdir(parents=True, exist_ok=True) is None else None
        gif(fr, PREV / f"burst-{c}.gif", 60)
    for name, fr, ms in (("launch", launch(), 50), ("misfire", misfire(), 70), ("clue", clue_glow(), 60)):
        strip(fr).save(FINAL / f"fx/{name}.png"); gif(fr, PREV / f"{name}.gif", ms)
    for t in range(6):
        fr = finale(t)
        strip(fr).save(FINAL / f"fx/finale-{t}.png"); gif(fr, PREV / f"finale-{t}.gif", 80)
    if night_bg:
        fr, n = lanterns(night_bg)
        strip(fr).save(FINAL / "fx/lanterns-night.png")
        base = Image.open(night_bg).convert("RGBA")
        frames = []
        for f in fr:
            b = base.copy(); b.alpha_composite(f); frames.append(b)
        gif(frames, PREV / "lanterns-night.gif", 200, scale=1)
        print("灯笼", n)


if __name__ == "__main__":
    export_all(sys.argv[1] if len(sys.argv) > 1 else None)
