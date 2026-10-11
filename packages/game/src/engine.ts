import { createRng, type Rng } from "./rng.js";
import {
  COLORS,
  MAX_CLUES,
  MAX_MISFIRES,
  MAX_SCORE,
  RANKS,
  RANK_COUNTS,
  type Card,
  type ClueCommand,
  type Color,
  type Config,
  type GameCommand,
  type GameEvent,
  type GameResult,
  type GameState,
  type HandCard,
  type Player,
  type Rank,
} from "./types.js";

export function handSizeFor(playerCount: number): number {
  return playerCount <= 3 ? 5 : 4;
}

export function defaultConfig(playerCount: number, overrides: Partial<Config> = {}): Config {
  return {
    minPlayers: 2,
    maxPlayers: 5,
    handSize: handSizeFor(playerCount),
    masterMode: false,
    stepTimeoutSec: 90,
    ...overrides,
  };
}

export interface NewPlayer {
  readonly id: string;
  readonly name: string;
}

export interface CreateOptions {
  readonly masterMode?: boolean;
  /** 指定先手（座位下标）；不给就随机（规则书第 3 节）。 */
  readonly firstPlayer?: number;
  /**
   * 指定发牌顺序（教程、测试用）：按摸牌顺序排的牌面，先发每人的手牌（第 1 位玩家的先发），剩下的按顺序当牌堆。
   * 不足 50 张时，其余的牌洗混接在后面。
   */
  readonly stack?: readonly (readonly [Color, Rank])[];
}

/** 全部 50 张的牌面（还没编 id）。 */
export function fullDeckFaces(): [Color, Rank][] {
  const faces: [Color, Rank][] = [];
  for (const color of COLORS) {
    for (const rank of RANKS) {
      for (let copy = 0; copy < RANK_COUNTS[rank]; copy += 1) faces.push([color, rank]);
    }
  }
  return faces;
}

/** 从 rest 里去掉 used 里的牌面（每个去掉一张）；某张在 rest 里没有了就报错（配件不守恒）。 */
export function removeFaces(rest: [Color, Rank][], used: readonly (readonly [Color, Rank])[]): [Color, Rank][] {
  const pool = [...rest];
  for (const [color, rank] of used) {
    const index = pool.findIndex(([c, r]) => c === color && r === rank);
    if (index < 0) throw new Error(`牌不够：${color}${rank} 已经用完了。`);
    pool.splice(index, 1);
  }
  return pool;
}

/**
 * 开局：洗牌、随机编 id、发牌、随机先手。
 * 卡牌 id 是 0–49 的随机排列，和牌面、牌堆位置都无关（规则书 9.3）。
 */
export function createGame(
  players: readonly NewPlayer[],
  seed = Math.floor(Math.random() * 2 ** 32),
  options: CreateOptions & Partial<Config> = {},
): GameState {
  const { masterMode, firstPlayer, stack, ...overrides } = options;
  const config = defaultConfig(players.length, { ...overrides, ...(masterMode !== undefined ? { masterMode } : {}) });
  if (players.length < config.minPlayers || players.length > config.maxPlayers) {
    throw new Error(`需要 ${config.minPlayers}–${config.maxPlayers} 位玩家才能开始。`);
  }
  const rng = createRng(seed);
  const stacked = stack ? stack.map(([c, r]) => [c, r] as [Color, Rank]) : [];
  const rest = rng.shuffle(removeFaces(fullDeckFaces(), stacked));
  const order = [...stacked, ...rest];
  const ids = rng.shuffle(Array.from({ length: order.length }, (_, index) => index));
  const cards: Record<number, Card> = {};
  order.forEach(([color, rank], index) => {
    const id = ids[index]!;
    cards[id] = { id, color, rank };
  });
  const drawOrder = order.map((_, index) => ids[index]!);
  let drawCounter = 0;
  const statePlayers: Player[] = players.map((player) => {
    const hand: HandCard[] = [];
    for (let k = 0; k < config.handSize; k += 1) {
      const id = drawOrder.shift()!;
      hand.unshift({ id, drawnAt: drawCounter, clues: { notColors: [], notRanks: [] }, marks: [] });
      drawCounter += 1;
    }
    return { id: player.id, name: player.name, hand };
  });
  const startPlayer = firstPlayer ?? rng.int(players.length);
  const state: GameState = {
    config,
    phase: "playing",
    players: statePlayers,
    currentPlayer: startPlayer,
    turn: 1,
    cards,
    // 数组末尾先摸
    deck: drawOrder.reverse(),
    deckCount: drawOrder.length,
    fireworks: { R: 0, Y: 0, G: 0, B: 0, W: 0 },
    discard: [],
    played: [],
    clueTokens: MAX_CLUES,
    misfires: 0,
    finalRoundEndsAfter: null,
    finalTurn: null,
    drawCounter,
    history: [],
    events: [],
    version: 0,
    seed,
  };
  state.rngState = rng.state;
  return state;
}

export function currentPlayerId(state: GameState): string {
  return state.players[state.currentPlayer]?.id ?? "";
}

export function scoreOf(state: Pick<GameState, "fireworks">): number {
  return COLORS.reduce((sum, color) => sum + state.fireworks[color], 0);
}

/** 这张牌现在能不能接上烟火。 */
export function isPlayable(state: Pick<GameState, "fireworks">, card: { color: Color; rank: Rank }): boolean {
  return state.fireworks[card.color] + 1 === card.rank;
}

/** 提示会标中哪些牌（按手牌显示顺序）。看不到牌面的牌不算（只会出现在自己手里，不能提示自己）。 */
export function clueTouches(state: Pick<GameState, "cards">, hand: readonly HandCard[], kind: "color" | "rank", value: Color | Rank): number[] {
  return hand
    .filter((card) => {
      const face = state.cards[card.id];
      if (!face) return false;
      return kind === "color" ? face.color === value : face.rank === value;
    })
    .map((card) => card.id);
}

/** 按摸牌顺序排（新的在前）。 */
export function byDrawOrder(hand: readonly HandCard[]): HandCard[] {
  return [...hand].sort((a, b) => b.drawnAt - a.drawnAt);
}

/** 斩牌位：按摸牌顺序最早摸到、又没收到过任何正提示的那张；全都有提示返回 undefined。 */
export function chopCard(hand: readonly HandCard[]): HandCard | undefined {
  const ordered = byDrawOrder(hand);
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const card = ordered[index]!;
    if (card.clues.color === undefined && card.clues.rank === undefined) return card;
  }
  return undefined;
}

function findPlayer(state: GameState, playerId: string): Player {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("找不到这位玩家。");
  return player;
}

/** 当前玩家能做的所有行动（不含整理手牌）。在删减过的状态上也能用（看不到的是自己的牌，自己的牌不需要牌面）。 */
export function legalActions(state: GameState, playerId: string): GameCommand[] {
  if (state.phase !== "playing" || currentPlayerId(state) !== playerId) return [];
  const me = findPlayer(state, playerId);
  const actions: GameCommand[] = [];
  if (state.clueTokens > 0) {
    for (const other of state.players) {
      if (other.id === playerId) continue;
      for (const color of COLORS) {
        if (clueTouches(state, other.hand, "color", color).length > 0) actions.push({ type: "CLUE", target: other.id, kind: "color", value: color });
      }
      for (const rank of RANKS) {
        if (clueTouches(state, other.hand, "rank", rank).length > 0) actions.push({ type: "CLUE", target: other.id, kind: "rank", value: rank });
      }
    }
  }
  for (const card of me.hand) actions.push({ type: "PLAY", cardId: card.id });
  if (state.clueTokens < MAX_CLUES) for (const card of me.hand) actions.push({ type: "DISCARD", cardId: card.id });
  return actions;
}

function takeFromHand(player: Player, cardId: unknown): HandCard {
  const index = player.hand.findIndex((card) => card.id === cardId);
  if (index < 0) throw new Error("这张牌不在你手里。");
  return player.hand.splice(index, 1)[0]!;
}

function faceOf(state: GameState, cardId: number): Card {
  const face = state.cards[cardId];
  if (!face) throw new Error("看不到这张牌的牌面（服务器状态不完整）。");
  return face;
}

/** 摸 1 张放到最左；摸走最后一张时开始最后一轮（大师模式不进最后一轮）。 */
function draw(state: GameState, player: Player, events: GameEvent[]): void {
  const deck = state.deck ?? [];
  if (deck.length === 0) return;
  const id = deck.pop()!;
  state.deckCount = deck.length;
  player.hand.unshift({ id, drawnAt: state.drawCounter, clues: { notColors: [], notRanks: [] }, marks: [] });
  state.drawCounter += 1;
  events.push({ type: "Drew", player: player.id, cardId: id });
  if (deck.length === 0 && !state.config.masterMode && state.finalRoundEndsAfter === null) {
    state.finalRoundEndsAfter = player.id;
    state.finalTurn = state.turn + state.players.length;
    events.push({ type: "FinalRound", player: player.id });
  }
}

/** 大师模式：某种还需要的牌已经全部进了弃牌堆，就再也打不到 25 分。 */
export function lostCard(state: Pick<GameState, "fireworks" | "discard" | "cards">): { color: Color; rank: Rank } | undefined {
  for (const color of COLORS) {
    for (let rank = state.fireworks[color] + 1; rank <= 5; rank += 1) {
      const gone = state.discard.filter((id) => {
        const face = state.cards[id];
        return face?.color === color && face.rank === rank;
      }).length;
      if (gone >= RANK_COUNTS[rank as Rank]) return { color, rank: rank as Rank };
    }
  }
  return undefined;
}

function finish(state: GameState, reason: GameResult["reason"], events: GameEvent[], extra: Partial<GameResult> = {}): void {
  const progress = scoreOf(state);
  const failed = reason === "misfire" || reason === "impossible" || (state.config.masterMode && progress < MAX_SCORE);
  const result: GameResult = {
    score: failed ? 0 : progress,
    reason,
    progress,
    won: !failed,
    ...extra,
  };
  state.phase = "finished";
  state.result = result;
  events.push({ type: "GameEnded", result });
}

/** 行动之后：按顺序判定 失败 > 完美 > 大师模式缺牌 > 最后一轮结束；都没有就轮到下一位。 */
function afterAction(state: GameState, events: GameEvent[]): void {
  if (state.misfires >= MAX_MISFIRES) return finish(state, "misfire", events);
  if (scoreOf(state) >= MAX_SCORE) return finish(state, "perfect", events);
  if (state.config.masterMode) {
    const lost = lostCard(state);
    if (lost) return finish(state, "impossible", events, { lostCard: lost });
  }
  if (state.finalTurn !== null && state.turn >= state.finalTurn) return finish(state, "deckOut", events);
  advanceTurn(state, events);
}

function advanceTurn(state: GameState, events: GameEvent[]): void {
  for (let skipped = 0; skipped <= state.players.length; skipped += 1) {
    state.turn += 1;
    state.currentPlayer = (state.currentPlayer + 1) % state.players.length;
    if (legalActions(state, currentPlayerId(state)).length > 0) return;
    // 没有合法行动（只可能在大师模式：手里没牌、提示标记也用完了）：直接跳过
    const player = currentPlayerId(state);
    state.history.push({ turn: state.turn, type: "pass", player });
    events.push({ type: "TurnSkipped", player });
    if (state.finalTurn !== null && state.turn >= state.finalTurn) return finish(state, "deckOut", events);
  }
  finish(state, "stuck", events);
}

function applyClue(state: GameState, actor: Player, command: ClueCommand, events: GameEvent[], auto: boolean): void {
  if (state.clueTokens < 1) throw new Error("提示标记用完了，不能给提示。");
  if (command.target === actor.id) throw new Error("不能提示自己。");
  const target = findPlayer(state, command.target);
  const { kind, value } = command;
  if (kind === "color" ? !COLORS.includes(value as Color) : !RANKS.includes(value as Rank)) throw new Error("提示的颜色或数字不对。");
  const touched = clueTouches(state, target.hand, kind, value);
  if (touched.length === 0) throw new Error("对方手里没有这种牌，不能给空提示。");
  state.clueTokens -= 1;
  const chop = chopCard(target.hand);
  const freshSet = new Set(target.hand.filter((card) => touched.includes(card.id) && card.clues.color === undefined && card.clues.rank === undefined).map((card) => card.id));
  for (const card of target.hand) {
    const hit = touched.includes(card.id);
    card.marks.push({ turn: state.turn, from: actor.id, kind, value, touched: hit });
    if (kind === "color") {
      if (hit) card.clues.color = value as Color;
      else if (!card.clues.notColors.includes(value as Color)) card.clues.notColors.push(value as Color);
    } else {
      if (hit) card.clues.rank = value as Rank;
      else if (!card.clues.notRanks.includes(value as Rank)) card.clues.notRanks.push(value as Rank);
    }
  }
  const ordered = byDrawOrder(target.hand).map((card) => card.id).filter((id) => touched.includes(id));
  const fresh = ordered.filter((id) => freshSet.has(id));
  state.history.push({ turn: state.turn, type: "clue", player: actor.id, target: target.id, kind, value, cardIds: ordered, fresh, ...(chop ? { chopId: chop.id } : {}), ...(auto ? { auto: true } : {}) });
  events.push({ type: "Clued", player: actor.id, target: target.id, kind, value, cardIds: ordered });
}

function applyDiscard(state: GameState, actor: Player, cardId: number, events: GameEvent[], auto: boolean): void {
  if (state.clueTokens >= MAX_CLUES) throw new Error("提示标记已满 8 个，不能弃牌。");
  const card = takeFromHand(actor, cardId);
  const face = faceOf(state, card.id);
  state.discard.push(card.id);
  state.clueTokens += 1;
  state.history.push({ turn: state.turn, type: "discard", player: actor.id, cardId: card.id, color: face.color, rank: face.rank, ...(auto ? { auto: true } : {}) });
  events.push({ type: "Discarded", player: actor.id, cardId: card.id, color: face.color, rank: face.rank });
  draw(state, actor, events);
}

function applyPlay(state: GameState, actor: Player, cardId: number, events: GameEvent[]): void {
  const card = takeFromHand(actor, cardId);
  const face = faceOf(state, card.id);
  const success = isPlayable(state, face);
  let bonus = false;
  if (success) {
    state.fireworks[face.color] = face.rank;
    state.played.push(card.id);
    if (face.rank === 5 && state.clueTokens < MAX_CLUES) {
      state.clueTokens += 1;
      bonus = true;
    }
  } else {
    state.discard.push(card.id);
    state.misfires += 1;
  }
  state.history.push({ turn: state.turn, type: "play", player: actor.id, cardId: card.id, color: face.color, rank: face.rank, success, ...(bonus ? { bonus: true } : {}) });
  events.push({ type: "Played", player: actor.id, cardId: card.id, color: face.color, rank: face.rank, success, bonus });
  // 第 3 次打错立即结束，不再摸牌
  if (state.misfires < MAX_MISFIRES) draw(state, actor, events);
}

function applyReorder(state: GameState, actor: Player, order: unknown): void {
  if (!Array.isArray(order) || order.length !== actor.hand.length) throw new Error("整理手牌的顺序不对。");
  const byId = new Map(actor.hand.map((card) => [card.id, card]));
  const next: HandCard[] = [];
  for (const id of order) {
    const card = byId.get(id as number);
    if (!card) throw new Error("整理手牌的顺序不对。");
    byId.delete(id as number);
    next.push(card);
  }
  actor.hand = next;
}

/**
 * 执行一个行动。纯函数：不改 state，返回新状态和事件。
 * 花火开局洗完牌以后再没有随机，rng 只是为了和其他游戏的接口一致。
 */
export function apply(state: GameState, playerId: string, command: GameCommand, _rng?: Rng, auto = false): { state: GameState; events: GameEvent[] } {
  if (state.phase === "finished") throw new Error("对局已经结束。");
  const next = structuredClone(state);
  const events: GameEvent[] = [];
  if (command?.type === "REORDER") {
    // 整理手牌：谁都可以、什么时候都可以，不算一回合
    applyReorder(next, findPlayer(next, playerId), command.order);
    events.push({ type: "Reordered", player: playerId });
    next.version += 1;
    next.events = events;
    return { state: next, events };
  }
  if (currentPlayerId(state) !== playerId) throw new Error("还没轮到你。");
  const actor = findPlayer(next, playerId);
  switch (command?.type) {
    case "CLUE":
      applyClue(next, actor, command, events, auto);
      break;
    case "DISCARD":
      applyDiscard(next, actor, command.cardId, events, auto);
      break;
    case "PLAY":
      applyPlay(next, actor, command.cardId, events);
      break;
    default:
      throw new Error("未知的行动。");
  }
  afterAction(next, events);
  next.version += 1;
  next.events = events;
  return { state: next, events };
}

function runCommand(state: GameState, playerId: string, command: GameCommand, auto = false): { state: GameState; events: GameEvent[] } {
  const rng = createRng(state.rngState ?? state.seed ?? 0);
  const { state: next, events } = apply(state, playerId, command, rng, auto);
  next.rngState = rng.state;
  next.log = [...(state.log ?? []), { player: playerId, command }];
  return { state: next, events };
}

export function applyCommand(state: GameState, playerId: string, command: GameCommand): GameState {
  return runCommand(state, playerId, command).state;
}

/**
 * 超时自动行动（规则书 9.4、补充 1.6 / 3.5）：**绝不出牌**。
 * 提示标记不满 8 个：弃斩牌位（最早摸到、没被提示过的那张；全都有提示就弃最早摸到的）。
 * 8 个全在（或手里没牌）：提示第一个手里有牌的队友（从下家起），他最新那张牌的颜色。
 * 都做不了就跳过。
 */
export function timeoutCommand(state: GameState): GameCommand | null {
  const me = state.players[state.currentPlayer]!;
  if (state.clueTokens < MAX_CLUES && me.hand.length > 0) {
    const card = chopCard(me.hand) ?? byDrawOrder(me.hand).at(-1)!;
    return { type: "DISCARD", cardId: card.id };
  }
  if (state.clueTokens > 0) {
    for (let offset = 1; offset < state.players.length; offset += 1) {
      const other = state.players[(state.currentPlayer + offset) % state.players.length]!;
      const newest = byDrawOrder(other.hand)[0];
      const face = newest ? state.cards[newest.id] : undefined;
      if (face) return { type: "CLUE", target: other.id, kind: "color", value: face.color };
    }
  }
  return null;
}

export function timeoutTurn(state: GameState): GameState {
  if (state.phase === "finished") return state;
  const playerId = currentPlayerId(state);
  const command = timeoutCommand(state);
  let next: GameState;
  let events: GameEvent[];
  if (command) {
    ({ state: next, events } = runCommand(state, playerId, command, true));
  } else {
    next = structuredClone(state);
    events = [];
    next.history.push({ turn: next.turn, type: "pass", player: playerId });
    afterAction(next, events);
    next.version += 1;
    next.log = [...(state.log ?? []), { player: playerId, command: { type: "TIMEOUT" } }];
  }
  next.events = [{ type: "TurnTimedOut", player: playerId }, ...events];
  return next;
}

export interface RedactOptions {
  /** 观战的上帝视角：看得到所有人的手牌（牌堆仍然看不到）。 */
  readonly seeAll?: boolean;
}

/**
 * 按观看者删减（规则书 9.3、补充 3.4）：
 * - 去掉牌堆、种子、随机数状态、动作序列；
 * - 牌面表只留看得到的：弃牌堆、已打出的、别人手里的；观看者自己手里的牌一律删掉；
 * - viewerId 不是座位（观战）时，不开上帝视角就所有人的手牌都看不到，只看提示；
 * - 对局结束后亮出所有人的手牌（结算页看「原来我手里是什么」）。
 * 手牌本身（HandCard）从来不带牌面，事件里的摸牌也不带牌面。
 */
export function redactGameForViewer(state: GameState, viewerId: string, options: RedactOptions = {}): GameState {
  const { deck: _deck, seed: _seed, rngState: _rngState, log: _log, cards, ...rest } = state;
  const seated = state.players.some((player) => player.id === viewerId);
  const visible: Record<number, Card> = {};
  const show = (id: number) => {
    const face = cards[id];
    if (face) visible[id] = { ...face };
  };
  state.discard.forEach(show);
  state.played.forEach(show);
  // 对局结束后亮出所有人的手牌（牌堆仍然不给）
  const reveal = state.phase === "finished";
  for (const player of state.players) {
    if (!reveal && (seated ? player.id === viewerId : !options.seeAll)) continue;
    player.hand.forEach((card) => show(card.id));
  }
  return structuredClone({ ...rest, cards: visible });
}

/** 合并删减的工具：用于测试和人机，判断某张牌的牌面观看者看不看得到。 */
export function knownFace(state: GameState, cardId: number): Card | undefined {
  return state.cards[cardId];
}

