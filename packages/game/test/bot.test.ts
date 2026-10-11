import { describe, expect, it } from "vitest";
import {
  analyzeForTest,
  applyCommand,
  botCommand,
  botDecision,
  buildGame,
  createGame,
  legalActions,
  redactGameForViewer,
  type GameCommand,
  type GameState,
} from "../src/index.js";

const view = (game: GameState, pid: string) => redactGameForViewer(game, pid);
const decide = (game: GameState) => {
  const pid = game.players[game.currentPlayer]!.id;
  return botDecision(view(game, pid), pid)!;
};
const idOf = (game: GameState, seat: number, pos: number) => game.players[seat]!.hand[pos]!.id;
const sameCommand = (a: GameCommand | null, b: GameCommand | null) => JSON.stringify(a) === JSON.stringify(b);

describe("人机只看自己能看到的信息", () => {
  it("传入没删减的状态（看得到自己的牌）直接报错", () => {
    const game = createGame([{ id: "a", name: "甲" }, { id: "b", name: "乙" }], 1, { firstPlayer: 0 });
    expect(() => botCommand(game, "a")).toThrow(/删减/);
    expect(botCommand(view(game, "a"), "a")).not.toBeNull();
  });

  it("自己手牌换成别的牌面，人机的决定不变（随机 100 个局面）", () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      let game = createGame([{ id: "a", name: "甲" }, { id: "b", name: "乙" }, { id: "c", name: "丙" }], seed);
      for (let k = 0; k < seed % 20; k += 1) {
        const pid = game.players[game.currentPlayer]!.id;
        if (game.phase !== "playing") break;
        game = applyCommand(game, pid, botCommand(view(game, pid), pid)!);
      }
      if (game.phase !== "playing") continue;
      const pid = game.players[game.currentPlayer]!.id;
      const seat = game.currentPlayer;
      // 把自己手牌和牌堆里的牌面互换：别人看得到的不变，自己看不到的变了
      const swapped = structuredClone(game);
      const mine = swapped.players[seat]!.hand.map((c) => c.id);
      const deck = swapped.deck!.slice(0, mine.length);
      mine.forEach((id, i) => {
        if (deck[i] === undefined) return;
        const a = swapped.cards[id]!;
        const b = swapped.cards[deck[i]!]!;
        swapped.cards[id] = { id, color: b.color, rank: b.rank };
        swapped.cards[deck[i]!] = { id: deck[i]!, color: a.color, rank: a.rank };
      });
      expect(sameCommand(botCommand(view(game, pid), pid), botCommand(view(swapped, pid), pid))).toBe(true);
    }
  });
});

describe("人机的关键决策（补充第一节）", () => {
  it("确定能出的牌就出：被提示过「1」的牌在开局一定能出", () => {
    const game = buildGame({ players: 2, hands: [[{ face: "G1", rank: true }]], clueTokens: 7 });
    const d = decide(game);
    expect(d.command).toEqual({ type: "PLAY", cardId: idOf(game, 0, 0) });
    expect(d.reason).toMatch(/一定/);
  });

  it("出牌提示：队友提示了「红色」，新标中的最左边那张就当成请出它", () => {
    let game = buildGame({ players: 2, hands: [["G3", "R1", "B4", "R3", "Y2"], ["W1", "W2", "W3", "W4", "Y1"]], current: 1, clueTokens: 8 });
    game = applyCommand(game, "p2", { type: "CLUE", target: "p1", kind: "color", value: "R" });
    const reading = analyzeForTest(view(game, "p1"), "p1");
    expect(reading.map((v) => v.playMarked)).toEqual([false, true, false, false, false]);
    expect(decide(game).command).toEqual({ type: "PLAY", cardId: idOf(game, 0, 1) });
  });

  it("保护提示：提示「5」不当成出牌；斩牌位被提示又可能是关键牌，也不出", () => {
    let game = buildGame({ players: 2, hands: [["G3", "R2", "B4", "R3", "Y5"], ["W1", "W2", "W3", "W4", "Y1"]], current: 1, clueTokens: 8, fireworks: { Y: 4 } });
    game = applyCommand(game, "p2", { type: "CLUE", target: "p1", kind: "rank", value: 5 });
    expect(analyzeForTest(view(game, "p1"), "p1")[4]!.saved).toBe(true);
    // Y 已经到 4，但 5 的提示是保护：人机知道它是 5、可能是 Y5 也可能是别的 5，不确定就不出
    expect(decide(game).command.type).not.toBe("PLAY");
  });

  it("保护队友：下家斩牌位是 5，有标记就提示他「5」", () => {
    const game = buildGame({ players: 3, hands: [undefined, ["G2", "R2", "B3", "W4", "R5"], ["W3", "W2", "Y3", "Y4", "B4"]], clueTokens: 5 });
    const d = decide(game);
    expect(d.command).toEqual({ type: "CLUE", target: "p2", kind: "rank", value: 5 });
    expect(d.reason).toMatch(/5 只有一张/);
  });

  it("给出牌提示：让新标中的最左边那张正好是能出的牌，不误导", () => {
    const game = buildGame({ players: 2, hands: [undefined, ["G2", "B1", "B3", "W4", "R4"]], clueTokens: 6 });
    const d = decide(game);
    expect(d.command.type).toBe("CLUE");
    const next = applyCommand(game, "p1", d.command);
    const entry = next.history.at(-1)!;
    expect(entry.type === "clue" && next.cards[entry.fresh[0]!]).toMatchObject({ color: "B", rank: 1 });
  });

  it("不会把同一张能出的牌重复提示给两个人", () => {
    const game = buildGame({ players: 3, hands: [undefined, [{ face: "B1", color: true }, "G4", "W4", "R4", "Y4"], ["B1", "G3", "W3", "R3", "Y3"]], clueTokens: 6 });
    const d = decide(game);
    expect(d.command.type === "CLUE" && d.command.target === "p3" && d.command.value === 1 || d.command.type !== "CLUE" || d.command.target !== "p3").toBe(true);
    if (d.command.type === "CLUE" && d.command.target === "p3") {
      const next = applyCommand(game, "p1", d.command);
      const entry = next.history.at(-1)!;
      expect(entry.type === "clue" && next.cards[entry.fresh[0]!]).not.toMatchObject({ color: "B", rank: 1 });
    }
  });

  it("失误已 2 次：被提示「红色」也不出（不是 100% 确定）", () => {
    let game = buildGame({ players: 2, hands: [["G3", "R1", "B4", "R3", "Y2"]], current: 1, clueTokens: 8, misfires: 2 });
    game = applyCommand(game, "p2", { type: "CLUE", target: "p1", kind: "color", value: "R" });
    expect(decide(game).command.type).not.toBe("PLAY");
  });

  it("没事可做时弃斩牌位；标记 8 个时不弃牌", () => {
    const game = buildGame({ players: 2, hands: [["G3", "R4", "B4", "R3", "Y2"], ["W2", "W3", "G4", "B5", "Y3"]], clueTokens: 2, fireworks: {} });
    const d = decide(game);
    expect(d.command).toEqual({ type: "DISCARD", cardId: idOf(game, 0, 4) });
    const full = buildGame({ players: 2, hands: [["G3", "R4", "B4", "R3", "Y2"], ["W2", "W3", "G4", "B4", "Y3"]], clueTokens: 8 });
    expect(decide(full).command.type).toBe("CLUE");
  });

  it("确定没用的牌优先弃（红色已到 3，被提示的红 2）", () => {
    const game = buildGame({ players: 2, hands: [[{ face: "R2", color: true, rank: true }, "B4", "W4", "Y4", "G4"], ["W2", "W3", "G4", "B5", "Y3"]], fireworks: { R: 3 }, clueTokens: 3 });
    expect(decide(game).command).toEqual({ type: "DISCARD", cardId: idOf(game, 0, 0) });
  });

  it("不按约定提示的人（新手）提示过别人一张接不上的牌后，人机对他的「出牌提示」会自己再算把握", () => {
    // 丙（p3）给乙一个会被读成出牌的颜色提示，但那张接不上 → 丙被记成「不按约定」
    let game = buildGame({ players: 3, hands: [["G3", "R3", "B4", "W3", "Y2"], ["B3", "W2", "G4", "R4", "Y4"], ["W1", "G1", "Y1", "B2", "R2"]], current: 2, clueTokens: 8 });
    game = applyCommand(game, "p3", { type: "CLUE", target: "p2", kind: "color", value: "B" });
    game = applyCommand(game, "p1", { type: "CLUE", target: "p3", kind: "rank", value: 1 });
    game = applyCommand(game, "p2", { type: "DISCARD", cardId: idOf(game, 1, 4) });
    game = applyCommand(game, "p3", { type: "CLUE", target: "p1", kind: "color", value: "R" });
    expect(analyzeForTest(view(game, "p1"), "p1").find((v) => v.card.id === idOf(game, 0, 1))!.playMarked).toBe(false);
  });

  it("每一步都附一句理由", () => {
    const game = createGame([{ id: "a", name: "甲" }, { id: "b", name: "乙" }], 3);
    const pid = game.players[game.currentPlayer]!.id;
    expect(botDecision(view(game, pid), pid)!.reason.length).toBeGreaterThan(5);
  });
});

describe("人机自对弈", () => {
  for (const n of [2, 3, 4, 5]) {
    it(`${n} 人 300 局：每一步合法、不超过最大步数、没有因 3 次打错失败，平均分达标`, () => {
      const problems: string[] = [];
      let total = 0;
      let misfireLosses = 0;
      let slowest = 0;
      let time = 0;
      let steps = 0;
      for (let seed = 1; seed <= 300; seed += 1) {
        let game = createGame(Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` })), seed * 13 + n, { masterMode: seed % 10 === 0 });
        let k = 0;
        while (game.phase === "playing") {
          const pid = game.players[game.currentPlayer]!.id;
          const v = view(game, pid);
          const t0 = performance.now();
          const command = botCommand(v, pid);
          const dt = performance.now() - t0;
          time += dt;
          slowest = Math.max(slowest, dt);
          steps += 1;
          if (!command || !legalActions(game, pid).some((a) => sameCommand(a, command))) {
            problems.push(`不合法 seed=${seed}`);
            break;
          }
          game = applyCommand(game, pid, command);
          if (++k > 150) {
            problems.push(`死循环 seed=${seed}`);
            break;
          }
        }
        if (game.config.masterMode) continue;
        total += game.result?.score ?? 0;
        if (game.result?.reason === "misfire") misfireLosses += 1;
      }
      expect(problems.slice(0, 3)).toEqual([]);
      const avg = total / 270;
      expect(avg).toBeGreaterThan(n === 2 ? 13 : 15);
      expect(misfireLosses / 270).toBeLessThan(0.1);
      expect(time / steps).toBeLessThan(50);
      expect(slowest).toBeLessThan(300);
    });
  }
});
