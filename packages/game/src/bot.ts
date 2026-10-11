import { legalActions } from "./engine.js";
import type { GameCommand, GameState } from "./types.js";

/** 占位人机：从合法行动里随机挑一个（人机阶段换成正式策略）。输入必须是删减过的状态。 */
export function botCommand(state: GameState, playerId: string): GameCommand | null {
  const actions = legalActions(state, playerId).filter((action) => action.type !== "PLAY" || state.misfires < 2);
  if (actions.length === 0) return null;
  return actions[Math.floor(Math.random() * actions.length)]!;
}
