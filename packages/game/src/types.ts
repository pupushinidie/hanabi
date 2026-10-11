/** 五种颜色：红、黄、绿、蓝、白。 */
export const COLORS = ["R", "Y", "G", "B", "W"] as const;
export type Color = (typeof COLORS)[number];
export const RANKS = [1, 2, 3, 4, 5] as const;
export type Rank = (typeof RANKS)[number];

/** 每种颜色里各数字的张数：1×3、2×2、3×2、4×2、5×1（规则书 2.1）。 */
export const RANK_COUNTS: Record<Rank, number> = { 1: 3, 2: 2, 3: 2, 4: 2, 5: 1 };
export const MAX_CLUES = 8;
export const MAX_MISFIRES = 3;
export const MAX_SCORE = 25;

export const COLOR_NAMES: Record<Color, string> = { R: "红", Y: "黄", G: "绿", B: "蓝", W: "白" };

export interface Config {
  readonly minPlayers: number;
  readonly maxPlayers: number;
  /** 每人手牌数：2–3 人 5 张，4–5 人 4 张。 */
  readonly handSize: number;
  /** 大师模式：牌堆摸完不进最后一轮，一直打到 25 分才算赢（规则书第 8 节）。 */
  readonly masterMode: boolean;
  /** 每回合限时（秒）；超时自动行动见 timeoutTurn（绝不自动出牌）。 */
  readonly stepTimeoutSec: number;
}

export interface Card {
  readonly id: number;
  readonly color: Color;
  readonly rank: Rank;
}

/** 一次提示在某张牌上的记录（公开）：人机靠它判断「这张是不是刚被提示」。 */
export interface ClueMark {
  /** 第几回合给的。 */
  readonly turn: number;
  readonly from: string;
  readonly kind: "color" | "rank";
  readonly value: Color | Rank;
  /** 这次提示标中了这张（true），还是只给它记了排除信息（false）。 */
  readonly touched: boolean;
}

/** 一张牌收到的提示汇总（公开）。 */
export interface CardClues {
  /** 已知颜色（被颜色提示标中过）。 */
  color?: Color;
  /** 已知数字（被数字提示标中过）。 */
  rank?: Rank;
  /** 排除信息：「不是红」。 */
  notColors: Color[];
  /** 排除信息：「不是 3」。 */
  notRanks: Rank[];
}

/**
 * 手里的一张牌。注意这里**没有牌面**：牌面只在 GameState.cards 表里，
 * 下发时按观看者删掉他自己手里那几张（规则书 9.3）。
 */
export interface HandCard {
  readonly id: number;
  /** 摸牌序号（全局递增）：越大越新。整理手牌只改显示顺序，人机和超时规则按它算「最左/最右」（补充 3.3）。 */
  readonly drawnAt: number;
  clues: CardClues;
  /** 这张牌收到过的每一次提示（标中或排除）。 */
  marks: ClueMark[];
}

export interface Player {
  readonly id: string;
  readonly name: string;
  /** 手牌，按这个玩家自己的显示顺序（新摸的放最左，可整理）。 */
  hand: HandCard[];
}

export type ClueCommand =
  | { readonly type: "CLUE"; readonly target: string; readonly kind: "color"; readonly value: Color }
  | { readonly type: "CLUE"; readonly target: string; readonly kind: "rank"; readonly value: Rank };

export type GameCommand =
  | ClueCommand
  | { readonly type: "DISCARD"; readonly cardId: number }
  | { readonly type: "PLAY"; readonly cardId: number }
  /** 整理自己的手牌顺序：任何时候都能做（不算一回合，不重置倒计时）。 */
  | { readonly type: "REORDER"; readonly order: number[] };

export type EndReason = "perfect" | "deckOut" | "misfire" | "impossible" | "stuck";

export interface GameResult {
  /** 全队得分：打错 3 次、大师模式失败都记 0。 */
  readonly score: number;
  readonly reason: EndReason;
  /** 结束时五色烟火的进度之和（失败时只供参考）。 */
  readonly progress: number;
  /** 大师模式：只有 25 分算赢。普通模式：没打错 3 次就算完成（看分数）。 */
  readonly won: boolean;
  /** 大师模式因缺牌失败：哪种牌已经全部进了弃牌堆（如红 5）。 */
  readonly lostCard?: { readonly color: Color; readonly rank: Rank };
}

/** 公开的行动记录，界面日志和人机都读它。 */
export type LogEntry =
  | {
      readonly turn: number;
      readonly type: "clue";
      readonly player: string;
      readonly target: string;
      readonly kind: "color" | "rank";
      readonly value: Color | Rank;
      /** 被标中的牌。 */
      readonly cardIds: number[];
      readonly auto?: boolean;
    }
  | {
      readonly turn: number;
      readonly type: "play";
      readonly player: string;
      readonly cardId: number;
      readonly color: Color;
      readonly rank: Rank;
      readonly success: boolean;
      /** 打出 5 拿回了 1 个提示标记。 */
      readonly bonus?: boolean;
      readonly auto?: boolean;
    }
  | {
      readonly turn: number;
      readonly type: "discard";
      readonly player: string;
      readonly cardId: number;
      readonly color: Color;
      readonly rank: Rank;
      readonly auto?: boolean;
    }
  | { readonly turn: number; readonly type: "pass"; readonly player: string };

export type GameEvent =
  | { readonly type: "Clued"; readonly player: string; readonly target: string; readonly kind: "color" | "rank"; readonly value: Color | Rank; readonly cardIds: number[] }
  | { readonly type: "Played"; readonly player: string; readonly cardId: number; readonly color: Color; readonly rank: Rank; readonly success: boolean; readonly bonus: boolean }
  | { readonly type: "Discarded"; readonly player: string; readonly cardId: number; readonly color: Color; readonly rank: Rank }
  /** 摸牌事件**不带牌面**（补充 3.4）：别人从 cards 表看得到，摸牌的人自己看不到。 */
  | { readonly type: "Drew"; readonly player: string; readonly cardId: number }
  | { readonly type: "FinalRound"; readonly player: string }
  | { readonly type: "Reordered"; readonly player: string }
  | { readonly type: "TurnSkipped"; readonly player: string }
  | { readonly type: "TurnTimedOut"; readonly player: string }
  | { readonly type: "GameEnded"; readonly result: GameResult };

export interface GameState {
  readonly config: Config;
  phase: "playing" | "finished";
  players: Player[];
  /** 当前玩家在 players 里的下标。 */
  currentPlayer: number;
  /** 第几个回合（每次行动 +1，从 1 开始）。服务器按它计时：整理手牌不会重置倒计时。 */
  turn: number;
  /**
   * 牌面表：卡牌 id → 牌面。下发时删掉观看者自己手里的牌和牌堆里的牌。
   * id 是洗牌后随机编的，从 id 推不出牌面。
   */
  cards: Record<number, Card>;
  /** 牌堆剩余张数（公开）。 */
  deckCount: number;
  /** 五色烟火当前最大数字（0–5）。 */
  fireworks: Record<Color, number>;
  /** 弃牌堆（卡牌 id，按进入顺序；牌面公开）。打错的牌也进这里。 */
  discard: number[];
  /** 成功打出的牌（卡牌 id，按打出顺序；牌面公开）。 */
  played: number[];
  clueTokens: number;
  misfires: number;
  /** 牌堆摸完时 = 摸走最后一张牌的人；他再行动一次后结束（规则书第 7 节）。大师模式不用。 */
  finalRoundEndsAfter: string | null;
  /** 最后一轮在哪个回合结束（含）。 */
  finalTurn: number | null;
  /** 下一张摸到的牌的序号。 */
  drawCounter: number;
  history: LogEntry[];
  events: GameEvent[];
  result?: GameResult;
  /** 每个动作 +1；前端据此判断是不是新事件。 */
  version: number;
  /** 以下只在服务端：牌堆（数组末尾先摸）、随机数状态、动作序列。 */
  deck?: number[];
  seed?: number;
  rngState?: number;
  log?: { player: string; command: GameCommand | { type: "TIMEOUT" } }[];
}
