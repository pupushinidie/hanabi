import { byDrawOrder, currentPlayerId, legalActions } from "./engine.js";
import { COLORS, MAX_CLUES, type GameCommand, type GameState } from "./types.js";

/** 随机策略：从合法行动里随便挑（对照用）。 */
export function randomCommand(state: GameState, playerId: string, random: () => number = Math.random): GameCommand | null {
  const actions = legalActions(state, playerId);
  return actions.length ? actions[Math.floor(random() * actions.length)]! : null;
}

/**
 * 基线（模拟不懂约定的新手，补充 1.5）：只出被提示过数字、而且现在能出的牌；
 * 否则有提示标记就随机给一个合法提示，没有就弃最右（最早摸到的）那张。
 */
export function baselineCommand(state: GameState, playerId: string, random: () => number = Math.random): GameCommand | null {
  if (state.phase !== "playing" || currentPlayerId(state) !== playerId) return null;
  const me = state.players.find((p) => p.id === playerId)!;
  for (const card of me.hand) {
    const rank = card.clues.rank;
    if (rank === undefined) continue;
    const colors = card.clues.color !== undefined ? [card.clues.color] : COLORS.filter((c) => !card.clues.notColors.includes(c));
    if (colors.some((color) => state.fireworks[color] + 1 === rank)) return { type: "PLAY", cardId: card.id };
  }
  const clues = legalActions(state, playerId).filter((a) => a.type === "CLUE");
  if (state.clueTokens > 0 && clues.length > 0 && (state.clueTokens === MAX_CLUES || random() < 0.5)) return clues[Math.floor(random() * clues.length)]!;
  const oldest = byDrawOrder(me.hand).at(-1);
  if (oldest && state.clueTokens < MAX_CLUES) return { type: "DISCARD", cardId: oldest.id };
  if (clues.length > 0) return clues[Math.floor(random() * clues.length)]!;
  return randomCommand(state, playerId, random);
}
