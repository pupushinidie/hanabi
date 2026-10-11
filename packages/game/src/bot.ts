import { byDrawOrder, chopCard, clueTouches, currentPlayerId, legalActions } from "./engine.js";
import {
  COLORS,
  COLOR_NAMES,
  MAX_CLUES,
  RANKS,
  RANK_COUNTS,
  type ClueCommand,
  type Color,
  type GameCommand,
  type GameState,
  type HandCard,
  type Player,
  type Rank,
} from "./types.js";

/**
 * 人机（「普通」难度）。它是真人的队友，所以只用补充文件第一节的两条直白约定理解提示：
 *  1. 出牌提示：一次提示里新标中的最左边那张（最新摸的），如果能解读成「现在能接上」，就当成「请出这张」；
 *  2. 保护提示：标中的是斩牌位（最右边没被提示过的那张）而且它可能是关键牌（5、最后一张），或者提示的是数字 5，
 *     就当成「别弃这张」，不急着出。
 * 只吃 redactGameForViewer 删减过的状态：自己的牌面看不到，靠计数和提示推断。
 */

type Face = { readonly color: Color; readonly rank: Rank };
type Fireworks = Record<Color, number>;
type Counts = Map<string, number>;

const key = (color: Color, rank: Rank) => `${color}${rank}`;
const faceName = (face: Face) => `${COLOR_NAMES[face.color]} ${face.rank}`;

export interface BotDecision {
  readonly command: GameCommand;
  /** 一句玩家听得懂的理由（教程的「提示」按钮用）。 */
  readonly reason: string;
}

/** 弃牌堆里每种牌面有几张。 */
function discardCounts(state: GameState): Counts {
  const counts: Counts = new Map();
  for (const id of state.discard) {
    const face = state.cards[id];
    if (face) counts.set(key(face.color, face.rank), (counts.get(key(face.color, face.rank)) ?? 0) + 1);
  }
  return counts;
}

/** 这张牌已经没用了：同色已经打到这个数字，或者中间缺的牌已经全被弃光。 */
function isUseless(face: Face, fireworks: Fireworks, discarded: Counts): boolean {
  if (face.rank <= fireworks[face.color]) return true;
  for (let rank = fireworks[face.color] + 1; rank < face.rank; rank += 1) {
    if ((discarded.get(key(face.color, rank as Rank)) ?? 0) >= RANK_COUNTS[rank as Rank]) return true;
  }
  return false;
}

/** 关键牌：还有用，而且是这种牌的最后一张（5 永远是）。 */
function isCritical(face: Face, fireworks: Fireworks, discarded: Counts): boolean {
  return !isUseless(face, fireworks, discarded) && (discarded.get(key(face.color, face.rank)) ?? 0) >= RANK_COUNTS[face.rank] - 1;
}

const isPlayableOn = (face: Face, fireworks: Fireworks) => fireworks[face.color] + 1 === face.rank;

/** 从某人的角度，还没看到的牌各剩几张：全部 − 已打出 − 弃牌堆 − 他看得到的手牌（hidden 里的玩家手牌当作看不到）。 */
function unseenCounts(state: GameState, hidden: ReadonlySet<string>): Counts {
  const counts: Counts = new Map();
  for (const color of COLORS) for (const rank of RANKS) {
    const played = rank <= state.fireworks[color] ? 1 : 0;
    counts.set(key(color, rank), RANK_COUNTS[rank] - played);
  }
  const take = (face: Face | undefined) => {
    if (!face) return;
    counts.set(key(face.color, face.rank), (counts.get(key(face.color, face.rank)) ?? 0) - 1);
  };
  for (const id of state.discard) take(state.cards[id]);
  for (const player of state.players) {
    if (hidden.has(player.id)) continue;
    for (const card of player.hand) take(state.cards[card.id]);
  }
  return counts;
}

interface Candidate extends Face {
  readonly weight: number;
}

/** 按提示过滤后的可能牌面（按剩余张数加权）。 */
function candidatesFor(clues: HandCard["clues"], counts: Counts): Candidate[] {
  const result: Candidate[] = [];
  for (const color of COLORS) {
    if (clues.color !== undefined && clues.color !== color) continue;
    if (clues.notColors.includes(color)) continue;
    for (const rank of RANKS) {
      if (clues.rank !== undefined && clues.rank !== rank) continue;
      if (clues.notRanks.includes(rank)) continue;
      const weight = counts.get(key(color, rank)) ?? 0;
      if (weight > 0) result.push({ color, rank, weight });
    }
  }
  return result;
}

const totalWeight = (list: readonly Candidate[]) => list.reduce((sum, c) => sum + c.weight, 0);

/** 每次提示时的烟火进度：按公开日志重放。 */
function fireworksTimeline(state: GameState): Map<number, Fireworks> {
  const timeline = new Map<number, Fireworks>();
  const fireworks: Fireworks = { R: 0, Y: 0, G: 0, B: 0, W: 0 };
  for (const entry of state.history) {
    if (entry.type === "clue") timeline.set(entry.turn, { ...fireworks });
    if (entry.type === "play" && entry.success) fireworks[entry.color] = entry.rank;
  }
  return timeline;
}

type Reading = { kind: "play"; intended: Face[] } | { kind: "save" } | { kind: "info" };

/**
 * 两条约定的解读（人机读别人的提示、给提示前预测对方怎么读，用的是同一个函数）。
 * focusCandidates：提示后，重点那张牌的可能牌面；wasChop：重点那张是不是提示前的斩牌位。
 */
function interpret(
  clue: { kind: "color" | "rank"; value: Color | Rank },
  focusCandidates: readonly Candidate[],
  wasChop: boolean,
  fireworksThen: Fireworks,
  discarded: Counts,
): Reading {
  if (clue.kind === "rank" && clue.value === 5) return { kind: "save" };
  if (wasChop && focusCandidates.some((c) => isCritical(c, fireworksThen, discarded) && !isPlayableOn(c, fireworksThen))) return { kind: "save" };
  const intended = focusCandidates.filter((c) => isPlayableOn(c, fireworksThen));
  if (intended.length > 0) return { kind: "play", intended };
  return { kind: "info" };
}

export interface CardView {
  readonly card: HandCard;
  readonly candidates: Candidate[];
  readonly pPlay: number;
  readonly pUseless: number;
  readonly pCritical: number;
  readonly surePlay: boolean;
  readonly sureUseless: boolean;
  readonly sureCritical: boolean;
  /** 按约定被提示成「请出这张」，而且现在仍然说得通。 */
  readonly playMarked: boolean;
  /** 被提示成「别弃这张」。 */
  readonly saved: boolean;
}

/**
 * 不按约定给提示的队友（比如刚学的新手）：我看得到的他的提示里，有按约定该读成「出牌」、
 * 其实那张当时接不上的（又不是在保护关键牌）。对这样的人，他的「出牌提示」要自己再算一遍把握。
 */
function unreliableGivers(state: GameState, counts: Counts, discarded: Counts, timeline: Map<number, Fireworks>): Set<string> {
  const result = new Set<string>();
  for (const entry of state.history) {
    if (entry.type !== "clue" || result.has(entry.player)) continue;
    const focusId = entry.fresh[0];
    if (focusId === undefined) continue;
    const face = state.cards[focusId];
    if (!face) continue;
    const then = timeline.get(entry.turn) ?? state.fireworks;
    if (isPlayableOn(face, then)) continue;
    const wasChop = entry.chopId === focusId;
    if (wasChop && isCritical(face, then, discarded)) continue;
    const clues = entry.kind === "color" ? { color: entry.value as Color, notColors: [], notRanks: [] } : { rank: entry.value as Rank, notColors: [], notRanks: [] };
    const reading = interpret(entry, candidatesFor(clues, counts), wasChop, then, discarded);
    if (reading.kind === "play") result.add(entry.player);
  }
  return result;
}

/** 分析一位玩家（从 counts 的角度）手里每张牌。 */
function analyzeHand(state: GameState, player: Player, counts: Counts, discarded: Counts, timeline: Map<number, Fireworks>): CardView[] {
  const unreliable = unreliableGivers(state, counts, discarded, timeline);
  // 先按日志读出每张牌收到的「出牌 / 保护」提示（以最近一次为准）
  const marks = new Map<number, Reading>();
  const markedBy = new Map<number, string>();
  for (const entry of state.history) {
    if (entry.type !== "clue" || entry.target !== player.id) continue;
    const focusId = entry.fresh[0];
    if (focusId === undefined) continue;
    const focus = player.hand.find((card) => card.id === focusId);
    if (!focus) continue;
    marks.set(focusId, interpret(entry, candidatesFor(focus.clues, counts), entry.chopId === focusId, timeline.get(entry.turn) ?? state.fireworks, discarded));
    markedBy.set(focusId, entry.player);
  }
  return player.hand.map((card) => {
    const candidates = candidatesFor(card.clues, counts);
    const total = totalWeight(candidates) || 1;
    const share = (test: (face: Face) => boolean) => totalWeight(candidates.filter(test)) / total;
    const pPlay = share((f) => isPlayableOn(f, state.fireworks));
    const pUseless = share((f) => isUseless(f, state.fireworks, discarded));
    const pCritical = share((f) => isCritical(f, state.fireworks, discarded));
    const reading = marks.get(card.id);
    let playMarked = false;
    if (reading?.kind === "play") {
      // 当初想让我出的那几种牌，现在还有哪些说得通（期间可能被别人打出了）
      const still = candidates.filter((c) => reading.intended.some((i) => i.color === c.color && i.rank === c.rank));
      playMarked = still.length > 0 && still.every((c) => isPlayableOn(c, state.fireworks));
      // 给提示的人不按约定来：只有自己算出来把握够大才出
      if (playMarked && unreliable.has(markedBy.get(card.id) ?? "")) playMarked = pPlay >= 0.6;
    }
    return {
      card,
      candidates,
      pPlay,
      pUseless,
      pCritical,
      surePlay: candidates.length > 0 && pPlay >= 0.999,
      sureUseless: candidates.length > 0 && pUseless >= 0.999,
      sureCritical: candidates.length > 0 && pCritical >= 0.999,
      playMarked,
      saved: reading?.kind === "save",
    };
  });
}

/** 队友手里「已经被提示过、而且确实能出」的牌面：再提示同一张就重复了。 */
function knownPlayableFaces(state: GameState, me: string): Set<string> {
  const faces = new Set<string>();
  for (const player of state.players) {
    if (player.id === me) continue;
    for (const card of player.hand) {
      const face = state.cards[card.id];
      if (!face) continue;
      if ((card.clues.color !== undefined || card.clues.rank !== undefined) && isPlayableOn(face, state.fireworks)) faces.add(key(face.color, face.rank));
    }
  }
  return faces;
}

/** 预测队友收到这个提示后怎么读：返回重点那张牌和解读；没有新标中的牌返回 null。 */
function predictReading(state: GameState, me: string, target: Player, clue: ClueCommand, discarded: Counts): { focus: HandCard; reading: Reading; fresh: HandCard[] } | null {
  const touched = new Set(clueTouches(state, target.hand, clue.kind, clue.value));
  if (touched.size === 0) return null;
  const fresh = byDrawOrder(target.hand).filter((card) => touched.has(card.id) && card.clues.color === undefined && card.clues.rank === undefined);
  const focus = fresh[0];
  if (!focus) return null;
  // 队友看不到自己的牌；我的牌我也看不到，就当它们对队友来说也是未知（偏保守）
  const counts = unseenCounts(state, new Set([target.id, me]));
  const clues = { ...focus.clues, notColors: [...focus.clues.notColors], notRanks: [...focus.clues.notRanks] };
  if (clue.kind === "color") clues.color = clue.value;
  else clues.rank = clue.value;
  const chop = chopCard(target.hand);
  const reading = interpret(clue, candidatesFor(clues, counts), chop?.id === focus.id, state.fireworks, discarded);
  return { focus, reading, fresh };
}

function cluesFor(target: Player, state: GameState): ClueCommand[] {
  const list: ClueCommand[] = [];
  for (const rank of RANKS) if (clueTouches(state, target.hand, "rank", rank).length > 0) list.push({ type: "CLUE", target: target.id, kind: "rank", value: rank });
  for (const color of COLORS) if (clueTouches(state, target.hand, "color", color).length > 0) list.push({ type: "CLUE", target: target.id, kind: "color", value: color });
  return list;
}

const clueText = (clue: ClueCommand) => (clue.kind === "color" ? `${COLOR_NAMES[clue.value]}色` : `数字 ${clue.value}`);

/** 从下家起的队友顺序。 */
function teammatesInOrder(state: GameState, me: string): Player[] {
  const index = state.players.findIndex((p) => p.id === me);
  return Array.from({ length: state.players.length - 1 }, (_, k) => state.players[(index + 1 + k) % state.players.length]!);
}

/** 找一个出牌提示：让某位队友知道一张现在就能出的牌，并且不会误导他出别的牌。 */
function findPlayClue(state: GameState, me: string, discarded: Counts, onlyFirst?: number): BotDecision | null {
  const known = knownPlayableFaces(state, me);
  let best: { score: number; decision: BotDecision } | null = null;
  teammatesInOrder(state, me).forEach((target, distance) => {
    if (onlyFirst !== undefined && distance >= onlyFirst) return;
    for (const clue of cluesFor(target, state)) {
      const predicted = predictReading(state, me, target, clue, discarded);
      if (!predicted || predicted.reading.kind !== "play") continue;
      const face = state.cards[predicted.focus.id]!;
      if (!isPlayableOn(face, state.fireworks)) continue; // 会误导他出一张接不上的牌
      if (known.has(key(face.color, face.rank))) continue; // 已经有人拿着同一张、知道要出
      // 同一次提示里新标中的其他能出的牌（不同牌面）算额外收益
      const faces = new Set<string>([key(face.color, face.rank)]);
      let extra = 0;
      for (const card of predicted.fresh.slice(1)) {
        const f = state.cards[card.id]!;
        if (isPlayableOn(f, state.fireworks) && !faces.has(key(f.color, f.rank))) extra += 1;
        faces.add(key(f.color, f.rank));
      }
      const score = 10 - distance * 1.5 - face.rank * 0.4 + extra * 1.2 + (face.rank === 5 ? 1 : 0) + predicted.fresh.length * 0.2;
      if (!best || score > best.score) {
        best = {
          score,
          decision: {
            command: clue,
            reason: `${target.name}手里有${faceName(face)}，现在就能接上。提示他「${clueText(clue)}」，他会出新标中的最左边那张。`,
          },
        };
      }
    }
  });
  return best === null ? null : (best as { decision: BotDecision }).decision;
}

/** 保护队友斩牌位上的关键牌（5、最后一张）。 */
function findSaveClue(state: GameState, me: string, discarded: Counts): BotDecision | null {
  const mates = teammatesInOrder(state, me).slice(0, state.players.length > 2 ? 2 : 1);
  for (const target of mates) {
    const chop = chopCard(target.hand);
    if (!chop) continue;
    const face = state.cards[chop.id];
    if (!face || !isCritical(face, state.fireworks, discarded)) continue;
    // 能出的话交给出牌提示去做
    if (isPlayableOn(face, state.fireworks)) continue;
    const options = cluesFor(target, state)
      .map((clue) => ({ clue, predicted: predictReading(state, me, target, clue, discarded) }))
      .filter(({ predicted }) => predicted && predicted.focus.id === chop.id && predicted.reading.kind !== "play")
      // 优先提示数字（5 直接提示「5」）
      .sort((a, b) => (a.clue.kind === "rank" ? 0 : 1) - (b.clue.kind === "rank" ? 0 : 1));
    const pick = options[0];
    if (pick) {
      return {
        command: pick.clue,
        reason: `${target.name}最右边没被提示过的那张是${faceName(face)}，${face.rank === 5 ? "5 只有一张" : "这是最后一张"}，弃了就再也打不满。提示他「${clueText(pick.clue)}」让他留着。`,
      };
    }
  }
  return null;
}

/** 提示标记满了又没有好提示时：给一个不会被读成「出牌」的提示。 */
function findSafeClue(state: GameState, me: string, discarded: Counts): BotDecision | null {
  let fallback: ClueCommand | null = null;
  for (const target of teammatesInOrder(state, me)) {
    for (const clue of cluesFor(target, state)) {
      const predicted = predictReading(state, me, target, clue, discarded);
      if (!predicted) {
        return { command: clue, reason: `提示标记满了不能弃牌，给${target.name}补一个「${clueText(clue)}」的提示（只标中他已经知道的牌，不会让他误出）。` };
      }
      const face = state.cards[predicted.focus.id]!;
      if (predicted.reading.kind !== "play" || isPlayableOn(face, state.fireworks)) {
        return { command: clue, reason: `提示标记满了不能弃牌，提示${target.name}「${clueText(clue)}」，让他多知道一点自己的牌。` };
      }
      fallback ??= clue;
    }
  }
  return fallback ? { command: fallback, reason: "提示标记满了不能弃牌，只好给一个提示。" } : null;
}

/** 当前玩家这一步的决定和理由；没轮到他返回 null。只能传 redactGameForViewer(game, playerId) 的结果。 */
export function botDecision(state: GameState, playerId: string): BotDecision | null {
  if (state.phase !== "playing" || currentPlayerId(state) !== playerId) return null;
  const legal = legalActions(state, playerId);
  if (legal.length === 0) return null;
  const me = state.players.find((p) => p.id === playerId)!;
  // 人机不作弊：传进来的必须是它自己座位删减过的状态（看不到自己的牌面）
  if (me.hand.some((card) => state.cards[card.id] !== undefined)) throw new Error("人机只能看自己座位删减过的状态。");
  const discarded = discardCounts(state);
  const counts = unseenCounts(state, new Set([playerId]));
  const views = analyzeHand(state, me, counts, discarded, fireworksTimeline(state));
  const finalRound = state.finalTurn !== null;
  const canClue = state.clueTokens > 0;
  const canDiscard = state.clueTokens < MAX_CLUES && me.hand.length > 0;
  const drawIndex = (card: HandCard) => byDrawOrder(me.hand).findIndex((c) => c.id === card.id);
  const where = (card: HandCard) => {
    const index = me.hand.findIndex((c) => c.id === card.id);
    return index === 0 ? "最左边那张" : index === me.hand.length - 1 ? "最右边那张" : `左数第 ${index + 1} 张`;
  };

  // 1–2. 出确定能出的牌（失误已 2 次时只出 100% 确定的）
  const lowestPlayable = (v: CardView) => Math.min(...v.candidates.filter((c) => isPlayableOn(c, state.fireworks)).map((c) => c.rank), 9);
  const playable = [...views.filter((v) => v.surePlay), ...(state.misfires >= 2 ? [] : views.filter((v) => !v.surePlay && v.playMarked))]
    .sort((a, b) => lowestPlayable(a) - lowestPlayable(b) || Number(b.surePlay) - Number(a.surePlay) || drawIndex(a.card) - drawIndex(b.card));
  const toPlay = playable[0];
  if (toPlay) {
    const faces = [...new Set(toPlay.candidates.filter((c) => isPlayableOn(c, state.fireworks)).map(faceName))];
    const what = faces.length === 1 ? `是${faces[0]}` : "能接上";
    return {
      command: { type: "PLAY", cardId: toPlay.card.id },
      reason: toPlay.surePlay
        ? `${where(toPlay.card)}根据提示一定${what}，打出去。`
        : `队友提示了你${where(toPlay.card)}，按约定这是让你出它（多半${what}），打出去。`,
    };
  }

  // 3. 保护队友的关键牌
  if (canClue) {
    const save = findSaveClue(state, playerId, discarded);
    if (save) return save;
  }
  // 4. 出牌提示（最后一轮只提示还能行动的队友）
  if (canClue) {
    const remaining = finalRound ? Math.max(0, state.finalTurn! - state.turn) : undefined;
    const play = findPlayClue(state, playerId, discarded, remaining);
    if (play) return play;
  }
  // 最后一轮：这是我最后一次行动，没有确定能出的牌时可以赌一张（失误 ≤ 1 才赌，第 3 次打错全队 0 分）
  if (finalRound && state.misfires <= 1 && me.hand.length > 0) {
    const gamble = [...views].sort((a, b) => b.pPlay - a.pPlay)[0]!;
    if (gamble.pPlay >= 0.5) {
      return { command: { type: "PLAY", cardId: gamble.card.id }, reason: `最后一轮了，${where(gamble.card)}有 ${Math.round(gamble.pPlay * 100)}% 能接上，赌一把。` };
    }
  }
  // 5. 弃牌
  if (canDiscard) {
    const useless = views.filter((v) => v.sureUseless).sort((a, b) => drawIndex(b.card) - drawIndex(a.card))[0];
    if (useless) return { command: { type: "DISCARD", cardId: useless.card.id }, reason: `${where(useless.card)}已经没用了（这种牌已经打过或者再也接不上），弃掉拿回 1 个提示标记。` };
    const chop = chopCard(me.hand);
    if (state.config.masterMode) {
      // 大师模式：弃掉任何一张还需要的最后一张就直接输，弃「最不可能是关键牌」的那张；都太险就先给提示
      const safest = views
        .filter((v) => !v.playMarked && !v.saved)
        .sort((a, b) => a.pCritical - b.pCritical || Number(b.card.id === chop?.id) - Number(a.card.id === chop?.id) || drawIndex(b.card) - drawIndex(a.card))[0];
      if (safest && (safest.pCritical <= 0.15 || !canClue)) {
        return { command: { type: "DISCARD", cardId: safest.card.id }, reason: `大师模式弃错一张关键牌就输，弃掉最不可能是关键牌的${where(safest.card)}。` };
      }
      if (canClue) {
        const safe = findSafeClue(state, playerId, discarded);
        if (safe) return safe;
      }
    }
    if (chop) return { command: { type: "DISCARD", cardId: chop.id }, reason: `没有确定能出的牌，弃掉${where(chop)}（最早摸到、没被提示过的那张），拿回 1 个提示标记。` };
    const choice = views
      .filter((v) => !v.sureCritical && !v.playMarked && !v.saved)
      .sort((a, b) => b.pUseless - a.pUseless || a.pCritical - b.pCritical)[0]
      ?? [...views].sort((a, b) => a.pCritical - b.pCritical || b.pUseless - a.pUseless)[0]!;
    return { command: { type: "DISCARD", cardId: choice.card.id }, reason: `手里的牌都被提示过了，弃掉最可能没用的${where(choice.card)}。` };
  }
  // 6. 提示标记满了：给一个不会被误读的提示
  if (canClue) {
    const safe = findSafeClue(state, playerId, discarded);
    if (safe) return safe;
  }
  // 兜底：只剩出牌一条路，出最可能接上的那张
  const last = [...views].sort((a, b) => b.pPlay - a.pPlay)[0];
  if (last) return { command: { type: "PLAY", cardId: last.card.id }, reason: "没有别的事可做，打出最可能接上的那张。" };
  return { command: legal[0]!, reason: "没有别的事可做。" };
}

/** 人机这一步（服务器托管、离线代打、陪玩都用它）。 */
export function botCommand(state: GameState, playerId: string): GameCommand | null {
  return botDecision(state, playerId)?.command ?? null;
}

/** 测试用：从某位玩家的视角读出他每张牌的判断（可能牌面、能不能出、有没有被提示成出牌/保护）。 */
export function analyzeForTest(state: GameState, playerId: string): CardView[] {
  const me = state.players.find((p) => p.id === playerId)!;
  return analyzeHand(state, me, unseenCounts(state, new Set([playerId])), discardCounts(state), fireworksTimeline(state));
}
