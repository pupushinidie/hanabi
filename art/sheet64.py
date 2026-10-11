"""v2 的 64 个候选拼成 8x8 总览（左半夜间底、右半纸色底不现实，这里用靛蓝底），放大 3 倍，带编号格。"""
import sys, pathlib
from PIL import Image, ImageDraw
ART = pathlib.Path(__file__).parent
def sheet(name, scale=3, bg=(32, 40, 80)):
    d = ART / "out" / "r1" / name
    files = sorted(d.glob(f"{name}*.png"), key=lambda p: int(p.stem.split("-")[-1]) if p.stem.split("-")[-1].isdigit() else 0)
    ims = [Image.open(f).convert("RGBA") for f in files]
    w, h = ims[0].size
    cell = (w * scale + 6, h * scale + 6)
    o = Image.new("RGBA", (cell[0] * 8, cell[1] * ((len(ims) + 7) // 8)), bg + (255,))
    dr = ImageDraw.Draw(o)
    for i, im in enumerate(ims):
        x, y = (i % 8) * cell[0], (i // 8) * cell[1]
        o.alpha_composite(im.resize((w * scale, h * scale), Image.NEAREST), (x + 3, y + 3))
        dr.text((x + 2, y + 1), str(i), fill=(255, 255, 0, 255))
    out = ART / "out" / "review" / f"{name}-64.png"
    o.save(out); return out
if __name__ == "__main__":
    for n in sys.argv[1:]: print(sheet(n))
