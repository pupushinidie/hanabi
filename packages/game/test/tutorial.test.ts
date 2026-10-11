import { describe, expect, it } from "vitest";
import {
  anchorVisible,
  applyCommand,
  botCommand,
  commandAnchor,
  createPracticeGame,
  createTutorialGame,
  legalActions,
  redactGameForViewer,
  sameCommand,
  TUTORIAL_RIVAL,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  type GameState,
} from "../src/index.js";

/** 按剧本走到某一步之前（index 之前的步骤都做完）。 */
function walk(until?: string): GameState {
  let game = createTutorialGame("小明");
  for (const step of TUTORIAL_STEPS) {
    if (step.id === until) return game;
    if (step.kind === "do") game = applyCommand(game, TUTORIAL_SELF, step.expect);
    if (step.kind === "watch") for (const move of step.moves) game = applyCommand(game, game.players[game.currentPlayer]!.id, move);
  }
  return game;
}

describe("新手教程剧本", () => {
  it("从头走到尾：每个 do 都合法、每个 watch 的走法合法、每个锚点那时看得见", () => {
    let game = createTutorialGame("小明");
    for (const step of TUTORIAL_STEPS) {
      const view = redactGameForViewer(game, TUTORIAL_SELF);
      if (step.anchor) expect(anchorVisible(view, step.anchor, TUTORIAL_SELF), `${step.id} 的锚点 ${step.anchor}`).toBe(true);
      if (step.kind === "do") {
        expect(game.players[game.currentPlayer]!.id, step.id).toBe(TUTORIAL_SELF);
        expect(legalActions(game, TUTORIAL_SELF).some((a) => sameCommand(a, step.expect)), step.id).toBe(true);
        // 剧本的高亮正好是这条命令要点的那张牌
        if (step.anchor?.includes("card")) expect(commandAnchor(view, step.expect, TUTORIAL_SELF), step.id).toBe(step.anchor);
        game = applyCommand(game, TUTORIAL_SELF, step.expect);
      }
      if (step.kind === "watch") {
        for (const move of step.moves) {
          const actor = game.players[game.currentPlayer]!.id;
          expect(actor, step.id).toBe(TUTORIAL_RIVAL);
          expect(legalActions(game, actor).some((a) => sameCommand(a, move)), step.id).toBe(true);
          game = applyCommand(game, actor, move);
        }
      }
    }
    expect(game.phase).toBe("playing");
    expect(game.players[game.currentPlayer]!.id).toBe(TUTORIAL_SELF);
  });

  it("关键几幕一定发生：人机照提示打出黄 1、你打出红 1、凭感觉出牌打错蓝 2", () => {
    const afterRival = walk("discard");
    expect(afterRival.fireworks.Y).toBe(1);
    const clued = walk("your-clue");
    expect(clued.players[0]!.hand[2]!.clues.color).toBe("R");
    expect(clued.players[0]!.hand.filter((c) => c.clues.notColors.includes("R"))).toHaveLength(4);
    expect(walk("played").fireworks.R).toBe(1);
    const saved = walk("save");
    expect(saved.players[0]!.hand[3]!.clues.rank).toBe(5);
    const missed = walk("misfired");
    expect(missed.misfires).toBe(1);
    expect(missed.history.at(-1)).toMatchObject({ type: "play", success: false, color: "B", rank: 2 });
    expect(walk("discarded").clueTokens).toBe(8);
  });

  it("人机真会照「数字 1」的提示出牌（剧本里的 watch 和人机的选择一致）", () => {
    const game = walk("rival-play");
    const command = botCommand(redactGameForViewer(game, TUTORIAL_RIVAL), TUTORIAL_RIVAL);
    const step = TUTORIAL_STEPS.find((s) => s.id === "rival-play")!;
    expect(step.kind === "watch" && sameCommand(command!, step.moves[0]!)).toBe(true);
  });

  it("剧本本身：id 不重复、finale 唯一且在最后、每句话不空、主句不超过 30 字", () => {
    const ids = TUTORIAL_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const finales = TUTORIAL_STEPS.filter((s) => s.kind === "info" && s.finale);
    expect(finales).toHaveLength(1);
    expect(TUTORIAL_STEPS.at(-1)).toBe(finales[0]);
    for (const step of TUTORIAL_STEPS) {
      expect(step.say.length, step.id).toBeGreaterThan(0);
      expect(step.say.length, step.id).toBeLessThanOrEqual(30);
    }
  });

  it("剧本走完接练习局：两边交给人机，200 局都能打完", () => {
    const stuck: string[] = [];
    for (let seed = 0; seed < 200; seed += 1) {
      let game = seed === 0 ? walk() : createPracticeGame("小明", seed);
      let steps = 0;
      while (game.phase === "playing" && steps < 200) {
        const actor = game.players[game.currentPlayer]!.id;
        const command = botCommand(redactGameForViewer(game, actor), actor);
        if (!command) break;
        game = applyCommand(game, actor, command);
        steps += 1;
      }
      if (game.phase !== "finished") stuck.push(String(seed));
    }
    expect(stuck).toEqual([]);
  });
});
