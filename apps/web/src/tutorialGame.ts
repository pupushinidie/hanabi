/**
 * 花火和教程有关的部分（共用的 tutorial/ 文件夹之外，每款游戏自己写的）：
 * 游戏 id、「提示」怎么说、「第一次遇到」小贴士什么时候出。
 */
import { botDecision, commandAnchor, MAX_CLUES, type GameState } from "@hanabi/game";

/** 本机记录（gm-tutorial-<id>、gm-tips-<id>）用的游戏 id。 */
export const GAME_ID = "hanabi";

export interface Hint {
  readonly say: string;
  readonly note?: string;
  /** 高亮哪个元素（data-tutorial）；null 不指。 */
  readonly anchor: string | null;
}

/**
 * 「提示」：让人机从你的位置算一步，配上它的理由。
 * game 是界面拿到的那份（已经按你的座位删减过，人机本来就只该看这些）。
 */
export function hintFor(game: GameState, playerId: string): Hint {
  if (game.phase !== "playing") return { say: "这局已经结束了。", anchor: null };
  const current = game.players[game.currentPlayer]!;
  if (current.id !== playerId) return { say: `等 ${current.name} 走完再问我。`, anchor: null };
  const decision = botDecision(game, playerId);
  if (!decision) return { say: "现在没有能做的事。", anchor: null };
  const { command, reason } = decision;
  const what = command.type === "PLAY" ? "我会出这张。" : command.type === "DISCARD" ? "我会弃这张。" : "我会给这个提示。";
  return { say: what, note: reason, anchor: commandAnchor(game, command, playerId) };
}

/** 「第一次遇到」小贴士的内容。 */
export const TIPS = {
  "got-clue": { title: "你收到提示了", text: "被标中的牌上画出了颜色或数字，其余的牌记上了「不是这种」。新标中的最左边那张，多半是让你出的。" },
  misfire: { title: "打错了一次", text: "用掉 1 个失误标记。3 个用完全队记 0 分，没把握就别出。" },
  "last-miss": { title: "再错一次就输", text: "失误标记只剩最后一个：现在只出有十足把握的牌。" },
  "tokens-full": { title: "提示标记满了", text: "8 个全在时不能弃牌，只能给提示或出牌。" },
  "tokens-empty": { title: "提示标记用完了", text: "没有标记就不能给提示：弃一张牌或者打出 5 能拿回来。" },
  "final-round": { title: "最后一轮", text: "牌堆摸完了：每人再行动一次就结束，摸到最后一张的人最后行动。" },
  "color-done": { title: "完成一色！", text: "打出 5 这一色就满了，还额外拿回 1 个提示标记。" },
} as const;

/** 这一步该出哪些小贴士（按优先顺序；只出第一条没看过的）。 */
export function detectTips(game: GameState, selfId: string): string[] {
  const ids: string[] = [];
  for (const event of game.events) {
    if (event.type === "Clued" && event.target === selfId) ids.push("got-clue");
    if (event.type === "Played" && !event.success) ids.push(game.misfires === 2 ? "last-miss" : "misfire");
    if (event.type === "Played" && event.success && event.rank === 5) ids.push("color-done");
    if (event.type === "FinalRound") ids.push("final-round");
  }
  const myTurn = game.phase === "playing" && game.players[game.currentPlayer]?.id === selfId;
  if (myTurn && game.clueTokens >= MAX_CLUES && game.version > 1) ids.push("tokens-full");
  if (myTurn && game.clueTokens === 0) ids.push("tokens-empty");
  return ids;
}
