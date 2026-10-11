"""核对 spec.md 里的每个定稿文件都在 out/final 里，尺寸对。"""
import pathlib
from PIL import Image
F = pathlib.Path(__file__).parent / "out" / "final"
C5, R5 = "RYGBW", range(1, 6)
exp = {"bg/night.png": (512, 288), "bg/day.png": (512, 288), "bg/night@3x.png": (1536, 864), "bg/day@3x.png": (1536, 864),
       "fx/lanterns-night.png": (2048, 288), "cards/back.png": (64, 96), "cards/unknown.png": (64, 96), "cards/glow.png": (72, 104),
       "cards/mini/back.png": (24, 34), "cards/mini/unknown.png": (24, 34),
       "tokens/clue.png": (32, 32), "tokens/clue-used.png": (32, 32), "tokens/miss.png": (32, 32), "tokens/miss-empty.png": (32, 32),
       "tokens/boom.png": (32, 32), "tokens/boom-empty.png": (32, 32), "ui/rack.png": (360, 49),
       "fx/launch.png": (128, 96), "fx/misfire.png": (768, 64), "fx/clue.png": (576, 104)}
for k in ("play", "discard", "deck", "clue-color", "clue-rank"): exp[f"icons/{k}.png"] = (32, 32)
for c in C5:
    exp[f"cards/unknown-{c}.png"] = (64, 96); exp[f"clue/color-{c}.png"] = (16, 16); exp[f"clue/not-color-{c}.png"] = (12, 12)
    exp[f"ui/slot-{c}.png"] = (64, 96); exp[f"fx/burst-{c}.png"] = (1536, 96)
    for r in R5:
        exp[f"cards/{c}{r}.png"] = (64, 96); exp[f"cards/mini/{c}{r}.png"] = (24, 34); exp[f"cards/fw/{c}{r}.png"] = None
for r in R5:
    exp[f"clue/rank-{r}.png"] = (16, 22); exp[f"clue/not-rank-{r}.png"] = (12, 12)
for t in range(6): exp[f"fx/finale-{t}.png"] = (6144, 144)
bad = 0
for k, sz in exp.items():
    p = F / k
    if not p.exists(): print("缺", k); bad += 1; continue
    if sz and Image.open(p).size != sz: print("尺寸不对", k, Image.open(p).size, sz); bad += 1
extra = {str(p.relative_to(F)) for p in F.rglob("*.png")} - set(exp)
print(f"应有 {len(exp)}，缺或不对 {bad}，多出 {sorted(extra)}")
