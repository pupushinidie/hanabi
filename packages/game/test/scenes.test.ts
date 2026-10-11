import { describe, expect, it } from "vitest";
import { buildGame, scene, SCENE_NAMES } from "../src/index.js";

describe("预览局面工厂", () => {
  it("每个场景都能造出来，配件守恒 50 张", () => {
    for (const name of SCENE_NAMES) {
      const game = scene(name);
      const total = game.players.reduce((s, p) => s + p.hand.length, 0) + game.discard.length + game.played.length + game.deck!.length;
      expect(total, name).toBe(50);
      expect(Object.keys(game.cards), name).toHaveLength(50);
    }
  });

  it("终局场景的结果符合规则书", () => {
    expect(scene("endScore").result).toMatchObject({ score: 14, reason: "deckOut" });
    expect(scene("endPerfect").result).toMatchObject({ score: 25, reason: "perfect" });
    expect(scene("endMisfire").result).toEqual({ score: 0, reason: "misfire", progress: 14, won: false });
    expect(scene("masterLost").result).toMatchObject({ score: 0, reason: "impossible", won: false });
    expect(scene("clued").players[0]!.hand.map((c) => c.clues.color ?? null)).toEqual(["R", null, "R", null, null]);
    expect(scene("start5").players).toHaveLength(5);
    expect(scene("finalRound").finalRoundEndsAfter).toBe("p2");
  });

  it("buildGame 按参数造精确局面；牌不够时报错", () => {
    const game = buildGame({ players: 3, hands: [["R1", { face: "B5", rank: true }]], fireworks: { G: 2 }, clueTokens: 3, misfires: 1, current: 2, turn: 10 });
    expect(game.cards[game.players[0]!.hand[1]!.id]).toMatchObject({ color: "B", rank: 5 });
    expect(game.players[0]!.hand[1]!.clues.rank).toBe(5);
    expect(game.fireworks.G).toBe(2);
    expect([game.clueTokens, game.misfires, game.currentPlayer, game.turn]).toEqual([3, 1, 2, 10]);
    expect(() => buildGame({ hands: [["R5", "R5"]] })).toThrow(/牌不够/);
  });
});
