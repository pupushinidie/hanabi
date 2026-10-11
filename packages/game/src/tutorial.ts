/**
 * 新手教程的剧本（花火）。
 *
 * 教程在浏览器里直接跑规则引擎，不连服务器：发牌顺序固定（TUTORIAL_STACK），对手咕噜一号按剧本走，
 * 所以「人机照你的提示出牌」「你凭感觉出牌打错」这几幕一定会发生。剧本走完接着把这局打完，对手交给人机。
 *
 * 每一步写三件事：咕噜嘎说什么（say / note）、高亮哪个元素（anchor，对应网页里的 data-tutorial="…"）、
 * 等玩家做什么（do 步骤的 expect）。给提示、出牌要点好几下：网页按界面状态把高亮从牌挪到按钮上（TutorialMode）。
 */
import { createGame } from "./engine.js";
import { createRng, type Rng } from "./rng.js";
import type { Color, GameCommand, GameState, Rank } from "./types.js";

/** 咕噜嘎的表情。 */
export type TutorialFace = "base" | "happy" | "surprised" | "think";

interface StepBase {
  readonly id: string;
  /** 侧栏「新手教程」进度里这一课叫什么；没有就不单独列。 */
  readonly lesson?: string;
  /** 主句（24px），一句话说清这一步。 */
  readonly say: string;
  /** 补充说明（12px）。 */
  readonly note?: string;
  /** 触屏设备上换成这句说明。 */
  readonly noteTouch?: string;
  /**
   * 高亮哪个元素：网页里 data-tutorial 的值。
   * 固定的有 my-hand、mates、fireworks、clue-tokens、misfire-tokens、deck、actions、prompt；
   * 牌是 my-card-<第几张> 和 mate-<第几位队友>-card-<第几张>（从左数，从 0 开始）。
   */
  readonly anchor?: string;
  readonly face?: TutorialFace;
}

export type TutorialStep =
  /** 讲解：玩家点「下一步」继续。finale 是最后一步（接练习局或结束）。 */
  | (StepBase & { readonly kind: "info"; readonly finale?: boolean })
  /** 等玩家做这一步；做别的会被拦下。 */
  | (StepBase & { readonly kind: "do"; readonly expect: GameCommand })
  /** 对手按剧本自动走这几步，牌桌不压暗。 */
  | (StepBase & { readonly kind: "watch"; readonly moves: readonly GameCommand[] });

export const TUTORIAL_SELF = "p1";
export const TUTORIAL_RIVAL = "p2";
export const TUTORIAL_RIVAL_NAME = "咕噜一号";

type Face = `${Color}${Rank}`;
/** 你的手牌（从左到右）。 */
const MY_HAND: readonly Face[] = ["W3", "R1", "Y5", "B2", "G4"];
/** 咕噜一号的手牌（从左到右）。 */
const RIVAL_HAND: readonly Face[] = ["Y1", "B3", "R4", "G2", "W4"];
/** 接下来摸到的牌（按顺序）。 */
const NEXT_DRAWS: readonly Face[] = ["R2", "G1", "B1", "W1", "Y2"];

const parse = (face: Face): [Color, Rank] => [face[0] as Color, Number(face[1]) as Rank];

/**
 * 发牌顺序：createGame 先发第 1 位玩家的手牌（先发的最早摸到、排在最右），再发第 2 位，然后是牌堆。
 * 所以手牌从右往左写进去。
 */
export const TUTORIAL_STACK: readonly (readonly [Color, Rank])[] = [
  ...[...MY_HAND].reverse().map(parse),
  ...[...RIVAL_HAND].reverse().map(parse),
  ...NEXT_DRAWS.map(parse),
];

const TUTORIAL_SEED = 20261011;

/** 教程开局：2 人，你先手，牌按剧本发。 */
export function createTutorialGame(selfName: string, seed = TUTORIAL_SEED): GameState {
  return createGame(
    [{ id: TUTORIAL_SELF, name: selfName }, { id: TUTORIAL_RIVAL, name: TUTORIAL_RIVAL_NAME }],
    seed,
    { stack: TUTORIAL_STACK, firstPlayer: 0 },
  );
}

/** 练习局「再练一局」：你和咕噜一号，随机发牌，你先手。 */
export function createPracticeGame(selfName: string, seed: number): GameState {
  return createGame([{ id: TUTORIAL_SELF, name: selfName }, { id: TUTORIAL_RIVAL, name: TUTORIAL_RIVAL_NAME }], seed, { firstPlayer: 0 });
}

/** 花火开局后再没有随机；给教程层一个普通随机数就行（接口和其他游戏一致）。 */
export type TutorialRng = Rng;
export function createTutorialRng(seed: number): TutorialRng {
  return createRng(seed);
}

export function sameCommand(a: GameCommand, b: GameCommand): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "CLUE" && b.type === "CLUE") return a.target === b.target && a.kind === b.kind && a.value === b.value;
  if ((a.type === "PLAY" || a.type === "DISCARD") && (b.type === "PLAY" || b.type === "DISCARD")) return a.cardId === b.cardId;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 剧本里用到的牌 id：按固定种子开出来的那一局查（和名字无关）。 */
const template = createTutorialGame("你");
function idOf(seat: 0 | 1, face: Face, game: GameState = template): number {
  const [color, rank] = parse(face);
  const card = game.players[seat]!.hand.find((c) => game.cards[c.id]?.color === color && game.cards[c.id]?.rank === rank);
  if (!card) throw new Error(`剧本里找不到 ${face}`);
  return card.id;
}
const RIVAL_W4 = idOf(1, "W4");

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    kind: "info", id: "hidden", lesson: "看不到自己的牌", anchor: "my-hand",
    say: "这是你的手牌，可你看不到自己的牌。",
    note: "上面是咕噜一号的牌：他看不到自己的，你看得到。花火就是这样，每个人只看得到队友的牌。",
  },
  {
    kind: "info", id: "goal", lesson: "目标", anchor: "fireworks",
    say: "目标：五色烟火各按 1→2→3→4→5 放上去。",
    note: "全队一起得分：每色打到几就得几分，满分 25。没有个人输赢。",
  },
  {
    kind: "info", id: "three", lesson: "三选一", anchor: "actions",
    say: "轮到你时三选一：给提示、弃牌、出牌。",
  },
  {
    kind: "info", id: "tokens", anchor: "clue-tokens",
    say: "给提示要花 1 个提示标记，一共 8 个。",
    note: "弃牌、打出 5 的时候能拿回来。",
  },
  {
    kind: "do", id: "clue-one", lesson: "给提示", anchor: "mate-0-card-0",
    expect: { type: "CLUE", target: TUTORIAL_RIVAL, kind: "rank", value: 1 },
    say: "咕噜一号最左边是黄 1，现在就能打出。提示他「数字 1」。",
    note: "点他那张牌，选「数字1」，再点「发出提示」。他手里所有的 1 都会被标出来；不能提示他没有的。",
  },
  {
    kind: "info", id: "convention", lesson: "人机怎么读提示", anchor: "mate-0", face: "think",
    say: "人机队友会出你新标中的最左边那张。",
    note: "所以想让它出哪张，就让那张成为新标中的最左边一张。提示它最右边没提示过的 5 或最后一张，它会留着不弃。",
  },
  {
    kind: "watch", id: "rival-play", anchor: "fireworks",
    moves: [{ type: "PLAY", cardId: idOf(1, "Y1") }],
    say: "看，咕噜一号打出了黄 1。",
  },
  {
    kind: "do", id: "discard", lesson: "弃牌", anchor: "my-card-4",
    expect: { type: "DISCARD", cardId: idOf(0, "G4") },
    say: "弃一张牌，拿回提示标记。弃最右边那张。",
    note: "拿不准弃哪张，就弃最早摸到、没被提示过的（最右边）。新摸的牌放在最左。",
  },
  {
    kind: "info", id: "discarded", anchor: "clue-tokens",
    say: "弃掉的是绿 4，大家都看得到；提示标记回到 8 个。",
    note: "8 个全满时不能弃牌。弃过哪些牌，看右边的弃牌一览（窄屏点顶栏「记录」）。",
  },
  {
    kind: "watch", id: "rival-clue", anchor: "my-hand",
    moves: [{ type: "CLUE", target: TUTORIAL_SELF, kind: "color", value: "R" }],
    say: "咕噜一号给你提示了「红色」。",
  },
  {
    kind: "info", id: "your-clue", lesson: "收到提示", anchor: "my-card-2",
    say: "这张被标成了红色，其余的牌记上了「不是红」。",
    note: "牌上画出你已经知道的；下面带斜杠的小格是排除信息。",
  },
  {
    kind: "do", id: "play-red", lesson: "出牌", anchor: "my-card-2",
    expect: { type: "PLAY", cardId: idOf(0, "R1") },
    say: "提示的意思就是让你出它：打出这张红牌。",
    note: "红色还没开始，能接上的只有红 1。",
  },
  {
    kind: "info", id: "played", anchor: "fireworks", face: "happy",
    say: "接上了！红色烟火到 1。",
    note: "接得上同色当前数字 +1 就放上去。打出 5 完成一色，再拿回 1 个提示标记。",
  },
  {
    kind: "watch", id: "rival-save", anchor: "my-hand",
    moves: [{ type: "CLUE", target: TUTORIAL_SELF, kind: "rank", value: 5 }],
    say: "咕噜一号提示你「数字 5」。",
  },
  {
    kind: "info", id: "save", lesson: "保护 5", anchor: "my-card-3", face: "think",
    say: "每色的 5 只有一张，弃掉就打不满。",
    note: "提示「5」的意思是：留着别弃，等能接上了再出。",
  },
  {
    kind: "do", id: "misfire", lesson: "打错", anchor: "my-card-4",
    expect: { type: "PLAY", cardId: idOf(0, "B2") },
    say: "试试凭感觉打出最右边那张。",
    note: "它没收到过提示，看看猜错会怎样。",
  },
  {
    kind: "info", id: "misfired", anchor: "misfire-tokens", face: "surprised",
    say: "打错了！那是蓝 2，蓝色还没开始。",
    note: "打错的牌进弃牌堆，用掉 1 个失误标记。第 3 次打错，全队立即失败、记 0 分。",
  },
  {
    kind: "watch", id: "rival-discard", anchor: "clue-tokens",
    moves: [{ type: "DISCARD", cardId: RIVAL_W4 }],
    say: "咕噜一号弃了一张牌，拿回提示标记。",
  },
  {
    kind: "info", id: "end", lesson: "结束和计分", anchor: "deck",
    say: "牌堆摸完后每人再行动一次，然后按五色的数字相加算分。",
    note: "五色都打到 5 立即得 25 分；打错 3 次立即 0 分。21 分以上就很厉害了。",
  },
  {
    kind: "info", id: "talk", lesson: "交流和托管", anchor: "prompt",
    say: "对局中只能用提示交流，聊天只有几句短语，语音里也别提牌。",
    note: "每回合 90 秒，超时会自动弃牌或给提示（不会替你出牌）；连续超时 2 次由人机托管，动一下就交还。",
  },
  {
    kind: "info", id: "finale", finale: true, face: "happy",
    say: "教程结束！接着和咕噜一号打完这局吧。",
    note: "拿不准就点「提示」，我告诉你人机会怎么走。",
  },
];

/** 这个锚点在这个局面下看不看得见（剧本单测用）。viewer 是自己的座位。 */
export function anchorVisible(state: GameState, anchor: string, viewer: string): boolean {
  const fixed = ["my-hand", "mates", "fireworks", "clue-tokens", "misfire-tokens", "deck", "actions", "prompt", "score", "log", "discard-pile"];
  if (fixed.includes(anchor)) return true;
  const me = state.players.find((p) => p.id === viewer);
  const mates = state.players.filter((p) => p.id !== viewer);
  let match = /^my-card-(\d+)$/.exec(anchor);
  if (match) return Number(match[1]) < (me?.hand.length ?? 0);
  match = /^mate-(\d+)$/.exec(anchor);
  if (match) return Number(match[1]) < mates.length;
  match = /^mate-(\d+)-card-(\d+)$/.exec(anchor);
  if (match) {
    const mate = mates[Number(match[1])];
    return !!mate && Number(match[2]) < mate.hand.length;
  }
  return false;
}

/** 这条命令（给提示、出牌、弃牌）要高亮的牌：自己的牌 my-card-K，队友的牌 mate-N-card-K（按显示顺序）。 */
export function commandAnchor(state: GameState, command: GameCommand, viewer: string): string | null {
  const me = state.players.find((p) => p.id === viewer);
  if (command.type === "PLAY" || command.type === "DISCARD") {
    const index = me?.hand.findIndex((c) => c.id === command.cardId) ?? -1;
    return index >= 0 ? `my-card-${index}` : null;
  }
  if (command.type === "CLUE") {
    const viewerIndex = state.players.findIndex((p) => p.id === viewer);
    const order = state.players.map((_, k) => state.players[(viewerIndex + 1 + k) % state.players.length]!).filter((p) => p.id !== viewer);
    const mateIndex = order.findIndex((p) => p.id === command.target);
    const target = order[mateIndex];
    if (!target) return null;
    const card = target.hand.findIndex((c) => {
      const face = state.cards[c.id];
      return face && (command.kind === "color" ? face.color === command.value : face.rank === command.value);
    });
    return card >= 0 ? `mate-${mateIndex}-card-${card}` : null;
  }
  return null;
}
