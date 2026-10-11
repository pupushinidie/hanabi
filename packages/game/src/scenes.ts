import { applyCommand, createGame, fullDeckFaces, removeFaces, type NewPlayer } from "./engine.js";
import { createRng } from "./rng.js";
import { COLORS, MAX_CLUES, type Card, type CardClues, type Color, type GameState, type HandCard, type Rank } from "./types.js";

/**
 * 预览局面工厂（对外接口，界面、教程、测试都用）。
 *
 * 牌面写成 "R1"…"W5"（红黄绿蓝白 = R Y G B W）。
 * 手牌按显示顺序从左到右写（最左 = 最新摸的）。
 */
export type Face = `${Color}${Rank}`;

export interface CardSpec {
  readonly face: Face;
  /** 收到过颜色提示（已知颜色 = 牌面颜色）。 */
  readonly color?: boolean;
  /** 收到过数字提示。 */
  readonly rank?: boolean;
  readonly notColors?: readonly Color[];
  readonly notRanks?: readonly Rank[];
}

export interface BuildOptions {
  /** 人数（默认 2，玩家 id p1…pN、名字 甲乙丙丁戊）或者直接给玩家。 */
  readonly players?: number | readonly NewPlayer[];
  /** 每位玩家的手牌（从左到右）；没给的玩家随机发满。 */
  readonly hands?: readonly (readonly (Face | CardSpec)[] | undefined)[];
  /** 接下来按顺序摸到的牌（第一个最先摸）；其余随机接在后面。 */
  readonly deck?: readonly Face[];
  /** 牌堆剩几张（默认放下所有剩余的牌）；多出来的牌放进弃牌堆。 */
  readonly deckSize?: number;
  readonly fireworks?: Partial<Record<Color, number>>;
  readonly discard?: readonly Face[];
  readonly clueTokens?: number;
  readonly misfires?: number;
  /** 当前玩家的座位下标（默认 0）。 */
  readonly current?: number;
  readonly turn?: number;
  readonly masterMode?: boolean;
  /** 已进入最后一轮：摸走最后一张牌的是哪个座位、还剩几次行动（含当前这次）。 */
  readonly finalRound?: { readonly endsAfter: number; readonly turnsLeft: number };
  readonly seed?: number;
}

const NAMES = ["甲", "乙", "丙", "丁", "戊"];

export function parseFace(face: string): [Color, Rank] {
  const color = face[0] as Color;
  const rank = Number(face.slice(1)) as Rank;
  if (!COLORS.includes(color) || !(rank >= 1 && rank <= 5)) throw new Error(`牌面写法不对：${face}`);
  return [color, rank];
}

function spec(card: Face | CardSpec): CardSpec {
  return typeof card === "string" ? { face: card } : card;
}

/** 按参数造任意精确局面（配件守恒：手牌 + 已打出 + 弃牌 + 牌堆 = 50）。 */
export function buildGame(options: BuildOptions = {}): GameState {
  const players: NewPlayer[] = typeof options.players === "object"
    ? [...options.players]
    : Array.from({ length: options.players ?? 2 }, (_, index) => ({ id: `p${index + 1}`, name: NAMES[index]! }));
  const seed = options.seed ?? 7;
  const rng = createRng(seed ^ 0x5bd1e995);
  const base = createGame(players, seed, { masterMode: options.masterMode ?? false, firstPlayer: options.current ?? 0 });
  const handSize = base.config.handSize;

  let pool = fullDeckFaces();
  const fireworks = { R: 0, Y: 0, G: 0, B: 0, W: 0, ...options.fireworks };
  const playedFaces: [Color, Rank][] = [];
  for (const color of COLORS) for (let rank = 1; rank <= fireworks[color]; rank += 1) playedFaces.push([color, rank as Rank]);
  pool = removeFaces(pool, playedFaces);
  const discardFaces = (options.discard ?? []).map(parseFace);
  pool = removeFaces(pool, discardFaces);
  const handSpecs = players.map((_, index) => (options.hands?.[index] ?? []).map(spec));
  pool = removeFaces(pool, handSpecs.flat().map((card) => parseFace(card.face)));
  const deckFront = (options.deck ?? []).map(parseFace);
  pool = removeFaces(pool, deckFront);
  pool = rng.shuffle(pool);
  // 没指定的手牌随机补满
  for (const hand of handSpecs) {
    while (hand.length < handSize && pool.length > 0) {
      const [color, rank] = pool.pop()!;
      hand.push({ face: `${color}${rank}` });
    }
  }
  let deckFaces = [...deckFront, ...pool];
  const extraDiscard: [Color, Rank][] = [];
  if (options.deckSize !== undefined) {
    if (options.deckSize < deckFront.length) throw new Error("deckSize 比指定的牌堆还少。");
    extraDiscard.push(...deckFaces.slice(options.deckSize));
    deckFaces = deckFaces.slice(0, options.deckSize);
  }

  const ids = rng.shuffle(Array.from({ length: 50 }, (_, index) => index));
  let nextId = 0;
  const cards: Record<number, Card> = {};
  const make = ([color, rank]: [Color, Rank]) => {
    const id = ids[nextId++]!;
    cards[id] = { id, color, rank };
    return id;
  };
  const played = playedFaces.map(make);
  const discard = [...discardFaces, ...extraDiscard].map(make);
  let drawCounter = 0;
  const state = base;
  state.players = players.map((player, index) => {
    const hand: HandCard[] = handSpecs[index]!.map((card) => {
      const [color, rank] = parseFace(card.face);
      const clues: CardClues = { notColors: [...(card.notColors ?? [])], notRanks: [...(card.notRanks ?? [])] };
      if (card.color) clues.color = color;
      if (card.rank) clues.rank = rank;
      return { id: make([color, rank]), drawnAt: 0, clues, marks: [] };
    });
    // 显示顺序最左最新：从右往左编摸牌序号
    for (let k = hand.length - 1; k >= 0; k -= 1) (hand[k] as { drawnAt: number }).drawnAt = drawCounter++;
    return { id: player.id, name: player.name, hand };
  });
  // 牌堆数组末尾先摸
  state.deck = deckFaces.map(make).reverse();
  state.deckCount = state.deck.length;
  state.cards = cards;
  state.played = played;
  state.discard = discard;
  state.fireworks = fireworks;
  state.clueTokens = options.clueTokens ?? MAX_CLUES;
  state.misfires = options.misfires ?? 0;
  state.currentPlayer = options.current ?? 0;
  state.turn = options.turn ?? 1;
  state.drawCounter = drawCounter;
  if (options.finalRound) {
    state.finalRoundEndsAfter = players[options.finalRound.endsAfter]!.id;
    state.finalTurn = state.turn + options.finalRound.turnsLeft - 1;
  }
  return state;
}

/** 预览页和教程用的常见局面名字。 */
export const SCENE_NAMES = [
  "start", // 2 人开局
  "start3", // 3 人开局
  "start5", // 5 人开局（最多人数的牌桌）
  "myTurn", // 轮到我，中局：我手里有被提示过的牌，可以给提示/弃牌/出牌
  "clued", // 刚被队友提示过（我手里两张标了红色）
  "theirTurn", // 轮到别人
  "tokens8", // 提示标记全满（不能弃牌）
  "tokens0", // 提示标记用完（不能给提示）
  "misfire2", // 已打错 2 次
  "finalRound", // 牌堆摸完，最后一轮
  "late", // 后期：烟火高、弃牌堆很满
  "endScore", // 正常结束 14 分
  "endPerfect", // 25 分完美
  "endMisfire", // 打错 3 次，0 分（失败前进度 14）
  "masterLost", // 大师模式：红 5 被弃，失败
  "master", // 大师模式中局，牌堆已摸完
] as const;
export type SceneName = (typeof SCENE_NAMES)[number];

/** 按名字造局面；自己的座位是 p1（甲）。 */
export function scene(name: SceneName): GameState {
  switch (name) {
    case "start":
      return buildGame({ players: 2, seed: 11 });
    case "start3":
      return buildGame({ players: 3, seed: 12 });
    case "start5":
      return buildGame({ players: 5, seed: 13 });
    case "myTurn":
      return buildGame({
        players: 3,
        hands: [
          [{ face: "Y1", rank: true }, "B4", { face: "R2", color: true, notRanks: [1] }, "W3", { face: "G5", rank: true }],
          ["R3", "G1", "B2", "Y4", "W1"],
          ["B1", "R1", "G3", "Y2", "W4"],
        ],
        fireworks: { R: 1, G: 2 },
        discard: ["B3", "W2", "Y1"],
        clueTokens: 5,
        misfires: 1,
        turn: 9,
        seed: 21,
      });
    case "clued": {
      const game = buildGame({
        players: 2,
        hands: [["R1", "B3", "R4", "G1", "Y5"], ["W1", "G2", "B1", "Y3", "R2"]],
        current: 1,
        clueTokens: 8,
        seed: 22,
      });
      return applyCommand(game, "p2", { type: "CLUE", target: "p1", kind: "color", value: "R" });
    }
    case "theirTurn":
      return buildGame({ players: 3, current: 1, fireworks: { Y: 1, B: 1 }, clueTokens: 6, turn: 5, seed: 23 });
    case "tokens8":
      return buildGame({ players: 2, clueTokens: 8, fireworks: { R: 2, W: 1 }, turn: 7, seed: 24 });
    case "tokens0":
      return buildGame({ players: 3, clueTokens: 0, fireworks: { G: 3, B: 2, R: 1 }, discard: ["Y1", "W4"], turn: 15, seed: 25 });
    case "misfire2":
      return buildGame({ players: 4, misfires: 2, clueTokens: 3, fireworks: { R: 3, Y: 2, G: 1, B: 4 }, discard: ["W1", "Y4", "G3", "R1"], turn: 30, seed: 26 });
    case "finalRound":
      return buildGame({
        players: 3,
        deckSize: 0,
        fireworks: { R: 4, Y: 2, G: 5, B: 3 },
        clueTokens: 2,
        misfires: 1,
        current: 2,
        turn: 48,
        finalRound: { endsAfter: 1, turnsLeft: 3 },
        seed: 27,
      });
    case "late":
      return buildGame({
        players: 4,
        deckSize: 4,
        fireworks: { R: 4, Y: 3, G: 5, B: 2, W: 3 },
        clueTokens: 1,
        misfires: 2,
        turn: 52,
        seed: 28,
      });
    case "endScore": {
      // 进度 14（红 4 黄 2 绿 5 蓝 3 白 0），最后一个行动的人弃牌结束
      const game = buildGame({
        players: 3,
        hands: [["W1", "B1", "R1", "Y4", "W2"]],
        deckSize: 0,
        fireworks: { R: 4, Y: 2, G: 5, B: 3 },
        clueTokens: 4,
        misfires: 1,
        turn: 50,
        finalRound: { endsAfter: 0, turnsLeft: 1 },
        seed: 29,
      });
      return applyCommand(game, "p1", { type: "DISCARD", cardId: game.players[0]!.hand[4]!.id });
    }
    case "endPerfect": {
      const game = buildGame({ players: 2, hands: [["W5"]], fireworks: { R: 5, Y: 5, G: 5, B: 5, W: 4 }, deckSize: 10, clueTokens: 3, turn: 44, seed: 30 });
      return applyCommand(game, "p1", { type: "PLAY", cardId: game.players[0]!.hand[0]!.id });
    }
    case "endMisfire": {
      const game = buildGame({ players: 3, hands: [["W3"]], fireworks: { R: 4, Y: 2, G: 5, B: 3 }, misfires: 2, clueTokens: 2, turn: 40, seed: 31 });
      return applyCommand(game, "p1", { type: "PLAY", cardId: game.players[0]!.hand[0]!.id });
    }
    case "masterLost": {
      const game = buildGame({ players: 2, masterMode: true, hands: [["R5"]], fireworks: { R: 3, Y: 5, G: 4, B: 4, W: 3 }, clueTokens: 5, deckSize: 0, turn: 60, seed: 32 });
      return applyCommand(game, "p1", { type: "DISCARD", cardId: game.players[0]!.hand[0]!.id });
    }
    case "master":
      return buildGame({ players: 3, masterMode: true, deckSize: 0, fireworks: { R: 4, Y: 3, G: 5, B: 2, W: 3 }, clueTokens: 3, misfires: 1, turn: 55, seed: 33 });
  }
}
