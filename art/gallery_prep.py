"""生成画廊预览图（out/gallery/）和拍板 JSON（assets/gallery-decision.json，不阻塞）。"""
import json, pathlib, shutil
from PIL import Image, ImageDraw
import cards as C
import build as B

ART = pathlib.Path(__file__).parent
R1 = ART / "out" / "r1"
G = ART / "out" / "gallery"
FINAL = ART / "out" / "final"
SEL = json.loads((ART / "selection.json").read_text())
OUTJSON = ART.parent / "assets" / "gallery-decision.json"
NIGHT = Image.open(R1 / SEL["bg"]["night"]).convert("RGBA")


def x(im, k):
    return im.resize((im.width * k, im.height * k), Image.NEAREST)


def on_halves(im, k=3, pad=10):
    """小图：左半夜间背景、右半白底，放大 k 倍，右下角 1 倍原大。"""
    big = x(im, k)
    W, H = big.width * 2 + pad * 4 + im.width + pad, big.height + pad * 2
    o = Image.new("RGBA", (W, H), (255, 255, 255, 255))
    o.alpha_composite(x(NIGHT, 3).crop((600, 120, 600 + W // 2, 120 + H)), (0, 0))
    o.alpha_composite(big, (pad, pad))
    o.alpha_composite(big, (W // 2 + pad, pad))
    o.alpha_composite(im, (W - im.width - pad, H - im.height - pad))
    return o


def faces_row(c, picks):
    """一色 1–5 五张牌，2 倍，衬在夜间背景上，下面一排 1 倍。"""
    cards = [C.face(c, r, B.white_cluster(r, picks) if c == "W" and isinstance(picks[0], Image.Image) else C.firework(c, r, picks[r - 1])) for r in range(1, 6)]
    W, H = 5 * 136 + 10, 192 + 96 + 30
    o = x(NIGHT, 3).crop((300, 60, 300 + W, 60 + H))
    for i, cd in enumerate(cards):
        o.alpha_composite(x(cd, 2), (10 + i * 136, 10))
        o.alpha_composite(cd, (10 + i * 70, 212))
    return o


def save(im, name):
    G.mkdir(parents=True, exist_ok=True)
    p = G / name
    im.convert("RGB").save(p) if not name.endswith(".gif") else None
    return str(p)


def main():
    if G.exists():
        shutil.rmtree(G)
    Q = []

    def q(qid, question, opts, help_=None):
        d = {"id": qid, "type": "choice", "question": question, "options": opts, "allowOther": True, "required": False}
        if help_:
            d["help"] = help_
        Q.append(d)

    def opt(value, label, images, desc, rec=False):
        o = {"value": value, "label": label, "images": images, "description": desc}
        if rec:
            o["recommended"] = True
        return o

    # 背景
    bgd = {"bg-night-s5201.png": "推荐：满天星和五六朵彩色烟火，木拱桥在左、宝塔在右，中间夜空开阔，牌放上去不挡主体；没有字",
           "bg-night-s5202.png": "灯笼更大更亮，桥占了左半边，夜空偏灰蓝",
           "bg-night-s5203.png": "一排大灯笼横在最上沿，烟火集中在中间，会被牌挡住",
           "bg-night-s12.png": "开工样张那张：偏暗偏棕，灯笼串很满"}
    q("bg-night", "夜间背景（牌桌，默认主题）", [opt(k[:-4], k[3:-4], [str(R1 / k)], v, k == SEL["bg"]["night"]) for k, v in bgd.items()])
    bgd = {"bg-day-s5301.png": "推荐：最亮最暖的傍晚，桃色珊瑚色天空、夕阳、桥和宝塔剪影，白天主题下最好看",
           "bg-day-s5302.png": "构图和夜间推荐那张最像（桥左塔右），但天色偏灰蓝，白天主题下发闷",
           "bg-day-s5303.png": "河道和夕阳，上沿灯笼，烟火在右边",
           "bg-day-s13.png": "开工样张白天版：松树和大灯笼在左，偏暗"}
    q("bg-day", "白天背景（傍晚）", [opt(k[:-4], k[3:-4], [str(R1 / k)], v, k == SEL["bg"]["day"]) for k, v in bgd.items()])
    # 烟火牌面
    names = {"R": ("红", "牡丹（实心圆球）"), "Y": ("黄", "垂柳（上圆下垂）"), "G": ("绿", "光环（空心圆）"), "B": ("蓝", "菊（长直放射线）")}
    why = {"R": "挑的组合：1、2 是小火球，3、4 是实心大圆球，5 是带光芒的大球；不要 5102 那套 5 号的「棒棒糖」（下面有根杆子）和 5101 的 4 号",
           "Y": "挑的组合：一路是垂柳/喷泉形，从小到大；5101 那套 2 号像一棵棕榈树，4 号像水母，没用",
           "G": "挑的组合：五个干净的圆环，从小到大，最整齐；5102 的 4 号太小（比 3 号还小）",
           "B": "挑的组合：放射线越来越长越密，5 号最大；5101 的 5 号比 4 号还小，5102 的 2 号像流星"}
    for c, (cn, shape) in names.items():
        opts = [opt("mix", "我挑的组合", [save(faces_row(c, SEL["fw"][c]), f"faces-{c}-mix.png")], why[c], True)]
        for s in (5101, 5102, 5103):
            opts.append(opt(f"s{s}", f"整套种子 {s}", [save(faces_row(c, [s] * 5), f"faces-{c}-s{s}.png")], "同一个种子出的 1–5"))
        q(f"faces-{c}", f"{cn}色牌面：{shape}，数字越大烟火越大", opts,
          "数字、角标图形、底部点数都是代码画的（不会有乱码字）。每色轮廓不同，色弱也能靠形状认；右上角的小图形同样区分颜色。")
    sparks = [B.trim(B.v2("spark-W", i)) for i in SEL["sparkW"]]
    opts = [opt("cluster", "千轮（一簇小火花）", [save(faces_row("W", sparks), "faces-W-cluster.png")],
                "推荐：PixelLab 出 64 朵小火花挑 7 朵，代码按数字排成一簇（1 号 2 朵 … 5 号 7 朵），轮廓是「一团散点」，和蓝色的放射线完全不同", True)]
    for s in (5101, 5102, 5103):
        opts.append(opt(f"s{s}", f"直接出图 种子 {s}", [save(faces_row("W", [s] * 5), f"faces-W-s{s}.png")],
                        "模型画成了放射状，和蓝色太像（色弱分不清），所以没用" + ("；3 号还带灰底" if s == 5102 else "")))
    q("faces-W", "白色牌面：千轮（一簇小星星）", opts)
    # 牌背
    backs = {"back-s5502.png": "推荐：靛蓝细纹底 + 金色圆纹章，简洁，和牌面的和纸边框一个味道",
             "back-s5501.png": "花纹更繁复，上下的小花饰偏西洋",
             "back-s5503.png": "金色太阳纹，四角回纹",
             "code": "代码画的青海波 + 朱金小烟火（开工样张那种）"}
    opts = []
    for k, v in backs.items():
        im = C.code_back() if k == "code" else B.normalize_back(Image.open(R1 / k))
        opts.append(opt(k.replace(".png", ""), k.replace(".png", ""), [save(on_halves(im, 3), f"back-{k.replace('.png', '')}.png")], v, k == SEL["back"]))
    q("back", "牌背（牌堆；自己看不到的手牌用它调暗的版本）", opts)
    # 标记和图标
    v2q = [("clue", "提示标记（蓝）", {62: "推荐：亮蓝底、团扇有蓝色扇骨，在牌桌上一眼是「蓝」", 30: "蓝底，团扇纯白", 54: "蓝底偏暗"}),
           ("miss", "失误标记（红，第 1、2 个）", {36: "推荐：朱红漆币，一团灰烟 + 裂开的黑火药球（哑火）", 20: "同一类，烟更大", 2: "金边更亮"}),
           ("boom", "第 3 个失误位：爆炸", {28: "推荐：最大最醒目的锯齿爆炸，一看就是「再错就完了」", 2: "小一号", 13: "带四散火星"}),
           ("play", "「出牌」图标", {1: "推荐：橙红条纹的冲天炮 + 火焰，不带星星（红底黄星的那些像国旗，没用）", 9: "纯红", 33: "斜条纹"}),
           ("discard", "「弃牌」图标", {17: "推荐：木桶里泡着熄灭的烟火，水花溅起来，意思清楚", 9: "水花小一点", 35: "水花更大"}),
           ("deck", "牌堆图标", {43: "推荐：木箱装满橙色烟火弹，箱子上没有字（很多候选箱子上有像「火」的字，没用）", 14: "木箱斜放", 11: "烟火弹偏红"})]
    for key, title, cands in v2q:
        folder = SEL["v2"][key][0]
        opts = []
        for i, why_ in cands.items():
            im = B.pad(B.trim(B.v2(folder, i)), 32, 32)
            opts.append(opt(f"{folder}-{i}", f"#{i}", [save(on_halves(im, 4), f"{key}-{i}.png")], why_, i == SEL["v2"][key][1]))
        q(key, title, opts, f"PixelLab 一次出 64 个，全部总览：{ART / 'out' / 'review' / (folder + '-64.png')}")
    # 展示架
    rack = Image.open(FINAL / "ui/rack.png").convert("RGBA")
    demo = x(NIGHT, 2).crop((0, 200, 720 + 20, 200 + 260))
    for i, c in enumerate(C.COLORS):
        im = Image.open(FINAL / (f"cards/{c}{i + 1}.png" if i < 3 else f"ui/slot-{c}.png")).convert("RGBA")
        demo.alpha_composite(x(im, 2), (10 + 144 * i + 8, 10))
    demo.alpha_composite(x(rack, 2), (10, 260 - rack.height * 2 - 4))
    raw = Image.open(R1 / "rack-s5603.png").convert("RGBA")
    q("rack", "烟火展示区：5 根竹筒发射架", [
        opt("rack", "竹筒架（代码重排）", [save(demo, "rack-demo.png")], "推荐：PixelLab 出的发射架根数不对（9 根），取其中一根竹筒和一段横梁，代码排成 5 根等距，正好对准 5 列牌；没打的颜色显示虚线空位", True),
        opt("none", "不要架子，只放空位", [save(on_halves(Image.open(FINAL / "ui/slot-B.png").convert("RGBA"), 2), "slot-only.png")], "只用虚线空位 + 该色图形"),
        opt("raw", "PixelLab 原图", [save(on_halves(raw, 2), "rack-raw.png")], "9 根竹筒、高矮不齐，不能直接用")])
    # 动画（只有一个版本，代码画的）
    gifs = [str(ART / "out" / "fxpreview" / f) for f in ("burst-R.gif", "burst-Y.gif", "burst-G.gif", "burst-B.gif", "burst-W.gif")]
    q("fx-burst", "打出牌 / 完成一色：每色按自己的轮廓炸开", [opt("code", "代码粒子动画", gifs, "代码按每色的色阶和轮廓画（牡丹球、垂柳、光环、菊、千轮），16 帧播一次；颜色和牌面完全一致", True)])
    gifs = [str(ART / "out" / "fxpreview" / f"finale-{t}.gif") for t in range(6)]
    q("fx-finale", "结算大烟火（六档评价各一条，循环）", [opt("code", "代码粒子动画", gifs, "0 档哑火冒烟 → 5 档满天五色；24 帧无缝循环", True)])
    gifs = [str(ART / "out" / "fxpreview" / f) for f in ("misfire.gif", "clue.gif", "lanterns-night.gif")]
    q("fx-other", "打错、收到提示、夜间灯笼闪烁", [opt("code", "代码动画", gifs, "打错：哑火冒黑烟火星乱溅；提示：被标中的牌闪一圈金光；夜间背景上 54 盏灯笼的火光轻轻闪", True)])
    # 封面
    covd = {"cover-s5402.png": "推荐：满天彩色烟火、红漆木桥、河上一条小船，颜色最丰富，缩小在大厅卡片上也热闹",
            "cover-s5404.png": "江户河边町屋 + 鸟居，水面倒影，很有味道，但烟火小一些",
            "cover-s5403.png": "红漆桥 + 灯笼，三朵大烟火在右上"}
    opts = []
    for i, (k, v) in enumerate(covd.items(), 1):
        opts.append(opt(k[:-4], f"c{i}", [str(ART / "out" / "covers" / f"hanabi-c{i}.png")], v, i == 1))
    q("cover", "大厅封面（384×192，不画字、不画人）", opts, "上线时由制作人装进大厅。另一张 cover-s5401 画成了现代城市天际线，不合江户方向，没放进来")

    intro = ("花火正式美术（方向：江户夏祭）的候选，每样一题。标「推荐」的是美术自查后挑定、已经导出到 "
             "~/projects/pipeline/games/hanabi/art/out/final 的那张，不选就按推荐上线；想换哪张随时来换，都不满意选「其他」写备注，美术重画。\n\n"
             "牌上的数字、点数、角标图形、提示叠加图（已知颜色/数字、排除信息）、迷你牌都是代码画的，保证准确、没有乱码字，所以只有一个版本。"
             "小图预览：左半夜间背景、右半白底，右下角是 1 倍原大。动画是 GIF。")
    doc = {"id": "art-gallery", "title": "花火：正式美术画廊", "stage": "art", "blocking": False, "intro": intro, "questions": Q}
    OUTJSON.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    print("题数", len(Q), OUTJSON)


if __name__ == "__main__":
    main()
