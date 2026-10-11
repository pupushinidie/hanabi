/**
 * 像素美术的地址（江户夏祭，PixelLab 出图 + 代码合成，见 art/spec.md）。图片放在 public/art 下。
 * 所有图只按整数倍缩放，并加 image-rendering: pixelated。
 */
import type { Color, Rank } from "@hanabi/game";

const ROOT = `${import.meta.env.BASE_URL}art/`;

export const art = {
  bgNight: `${ROOT}bg/night@3x.png`,
  bgDay: `${ROOT}bg/day@3x.png`,
  lanterns: `${ROOT}fx/lanterns-night.png`,
  card: (color: Color, rank: Rank) => `${ROOT}cards/${color}${rank}.png`,
  mini: (color: Color, rank: Rank) => `${ROOT}cards/mini/${color}${rank}.png`,
  miniBack: `${ROOT}cards/mini/back.png`,
  miniUnknown: `${ROOT}cards/mini/unknown.png`,
  back: `${ROOT}cards/back.png`,
  unknown: (color?: Color) => `${ROOT}cards/unknown${color ? `-${color}` : ""}.png`,
  glow: `${ROOT}cards/glow.png`,
  fw: (color: Color, rank: Rank) => `${ROOT}cards/fw/${color}${rank}.png`,
  clueRank: (rank: Rank) => `${ROOT}clue/rank-${rank}.png`,
  clueColor: (color: Color) => `${ROOT}clue/color-${color}.png`,
  notColor: (color: Color) => `${ROOT}clue/not-color-${color}.png`,
  notRank: (rank: Rank) => `${ROOT}clue/not-rank-${rank}.png`,
  token: {
    clue: `${ROOT}tokens/clue.png`,
    clueUsed: `${ROOT}tokens/clue-used.png`,
    miss: `${ROOT}tokens/miss.png`,
    missEmpty: `${ROOT}tokens/miss-empty.png`,
    boom: `${ROOT}tokens/boom.png`,
    boomEmpty: `${ROOT}tokens/boom-empty.png`,
  },
  icon: {
    play: `${ROOT}icons/play.png`,
    discard: `${ROOT}icons/discard.png`,
    deck: `${ROOT}icons/deck.png`,
    clueColor: `${ROOT}icons/clue-color.png`,
    clueRank: `${ROOT}icons/clue-rank.png`,
  },
  rack: `${ROOT}ui/rack.png`,
  slot: (color: Color) => `${ROOT}ui/slot-${color}.png`,
  burst: (color: Color) => `${ROOT}fx/burst-${color}.png`,
  launch: `${ROOT}fx/launch.png`,
  misfire: `${ROOT}fx/misfire.png`,
  clueFx: `${ROOT}fx/clue.png`,
  finale: (tier: number) => `${ROOT}fx/finale-${tier}.png`,
};

/** 每色界面用色：亮（夜间文字）、中（色块、白天文字）。 */
export const COLOR_UI: Record<Color, { bright: string; mid: string; name: string }> = {
  R: { bright: "#ff5b4f", mid: "#d02a33", name: "红" },
  Y: { bright: "#ffd93d", mid: "#e8a90c", name: "黄" },
  G: { bright: "#52e07f", mid: "#23a052", name: "绿" },
  B: { bright: "#63b8ff", mid: "#2f7de8", name: "蓝" },
  W: { bright: "#ececf4", mid: "#b4b4c8", name: "白" },
};

/** 结算评价（规则书第 6 节，自己翻译）。 */
export function rating(score: number): { tier: number; text: string } {
  if (score >= 25) return { tier: 5, text: "传奇，全场无言" };
  if (score >= 21) return { tier: 4, text: "惊艳，会被记住很久" };
  if (score >= 16) return { tier: 3, text: "精彩，观众很满意" };
  if (score >= 11) return { tier: 2, text: "还行，很快会被忘掉" };
  if (score >= 6) return { tier: 1, text: "平庸，零星掌声" };
  return { tier: 0, text: "糟糕，台下一片嘘声" };
}
