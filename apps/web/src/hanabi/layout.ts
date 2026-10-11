/**
 * 按牌桌区域实测的宽高挑牌的整数倍（参考多米诺王国 layout.ts）。
 * 牌原图 64×96；1× 时牌上数字只有 18px，界面在牌的左上角叠一个 24px 的数字（不另占高度）。
 */
export interface BoardLayout {
  readonly mobile: boolean;
  /** 队友手牌倍数。 */
  readonly mate: number;
  /** 队友每行几块。 */
  readonly perRow: number;
  /** 烟火展示区倍数。 */
  readonly fw: number;
  /** 自己手牌倍数。 */
  readonly mine: number;
  /** 标记倍数。 */
  readonly token: number;
}

export const CARD_W = 64;
export const CARD_H = 96;
const MATE_NAME_W = 88;
const PANEL_PAD = 8;
const ACTION_W = 236;

export const cardGap = (scale: number) => 6 * scale;
export const labelH = (scale: number) => (scale === 1 ? 30 : 0);
const cardsWidth = (count: number, scale: number) => count * CARD_W * scale + Math.max(0, count - 1) * cardGap(scale);

/** 烟火区：5 根竹筒，间距 72，牌叠在竹筒上方。 */
export const fwWidth = (scale: number) => 360 * scale;
export const fwHeight = (scale: number) => CARD_H * scale + 29 * scale + labelH(scale);
const tokensWidth = (scale: number) => 84 + 8 * (32 * scale + 4);
const tokensHeight = (scale: number) => 3 * (32 * scale + 6) + 56;

export function pickLayout(width: number, height: number, mateHands: readonly number[], myCount: number): BoardLayout {
  const mobile = width < 700;
  if (mobile) return { mobile, mate: 1, perRow: 1, fw: 1, mine: 1, token: 1 };
  const n = Math.max(1, mateHands.length);
  const maxHand = Math.max(1, ...mateHands);
  let best: { score: number; layout: BoardLayout } | null = null;
  for (const mine of [3, 2, 1]) for (const mate of [2, 1]) for (const fw of [2, 1]) for (const token of [2, 1]) for (let perRow = n; perRow >= 1; perRow -= 1) {
    const panelW = MATE_NAME_W + cardsWidth(maxHand, mate) + PANEL_PAD * 2;
    const panelH = CARD_H * mate + PANEL_PAD * 2 + 4;
    const rows = Math.ceil(n / perRow);
    const matesW = perRow * panelW + (perRow - 1) * 12;
    const matesH = rows * panelH + (rows - 1) * 10;
    const centerW = fwWidth(fw) + 32 + tokensWidth(token);
    const centerH = Math.max(fwHeight(fw), tokensHeight(token));
    const mineW = cardsWidth(myCount, mine) + ACTION_W + 32 + 80;
    const mineH = CARD_H * mine + 14;
    const totalH = matesH + centerH + mineH + 2 * 14 + 20;
    const maxW = Math.max(matesW, centerW, mineW) + 24;
    if (totalH > height || maxW > width) continue;
    const score = mate * 50 + mine * 35 + fw * 10 + token * 3 + (rows === 1 ? 2 : 0);
    if (!best || score > best.score) best = { score, layout: { mobile, mate, perRow, fw, mine, token } };
  }
  return best?.layout ?? { mobile, mate: 1, perRow: Math.min(n, 2), fw: 1, mine: 1, token: 1 };
}
