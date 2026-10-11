import { describe, expect, it } from "vitest";
import {
  applyCommand,
  buildGame,
  createGame,
  legalActions,
  redactGameForViewer,
  scoreOf,
  timeoutCommand,
  timeoutTurn,
  type Color,
  type GameCommand,
  type GameState,
  type Rank,
} from "../src/index.js";
import { apply } from "../src/engine.js";

const P3 = [
  { id: "a", name: "甲" },
  { id: "b", name: "乙" },
  { id: "c", name: "丙" },
];

function players(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `玩家${i + 1}` }));
}

function idAt(game: GameState, seat: number, pos: number): number {
  return game.players[seat]!.hand[pos]!.id;
}

function faces(game: GameState, seat: number): string[] {
  return game.players[seat]!.hand.map((card) => {
    const face = game.cards[card.id]!;
    return `${face.color}${face.rank}`;
  });
}

function act(game: GameState, command: GameCommand): GameState {
  return applyCommand(game, game.players[game.currentPlayer]!.id, command);
}

function countAll(game: GameState): number {
  return game.players.reduce((sum, p) => sum + p.hand.length, 0) + game.discard.length + game.played.length + (game.deck?.length ?? 0);
}

describe("规则书第 2 节 配件", () => {
  it("规则书#TC1 牌组构成：50 张，每色 1×3、2×2、3×2、4×2、5×1", () => {
    const game = createGame(players(2), 1);
    const all = Object.values(game.cards);
    expect(all).toHaveLength(50);
    for (const color of ["R", "Y", "G", "B", "W"] as Color[]) {
      const counts = [1, 2, 3, 4, 5].map((rank) => all.filter((card) => card.color === color && card.rank === rank).length);
      expect(counts).toEqual([3, 2, 2, 2, 1]);
    }
    expect(countAll(game)).toBe(50);
  });

  it("规则书#9.3 卡牌 id 随机：不同种子下同一个 id 的牌面不同，id 是 0–49 的排列", () => {
    const a = createGame(players(2), 1);
    const b = createGame(players(2), 2);
    expect(Object.keys(a.cards).map(Number).sort((x, y) => x - y)).toEqual(Array.from({ length: 50 }, (_, i) => i));
    const same = Object.keys(a.cards).filter((id) => {
      const x = a.cards[Number(id)]!;
      const y = b.cards[Number(id)]!;
      return x.color === y.color && x.rank === y.rank;
    }).length;
    expect(same).toBeLessThan(20);
    // id 和摸牌顺序也没有固定关系：开局手牌的 id 不是 0–4
    expect(a.players[0]!.hand.map((card) => card.id).sort()).not.toEqual([0, 1, 2, 3, 4]);
  });
});

describe("规则书第 3 节 开局", () => {
  it("规则书#TC2 起始手牌：2/3 人每人 5 张，4/5 人每人 4 张，牌堆 40/35/34/30", () => {
    const expected: Record<number, [number, number]> = { 2: [5, 40], 3: [5, 35], 4: [4, 34], 5: [4, 30] };
    for (const n of [2, 3, 4, 5]) {
      const game = createGame(players(n), n);
      for (const p of game.players) expect(p.hand).toHaveLength(expected[n]![0]);
      expect(game.deckCount).toBe(expected[n]![1]);
      expect(game.deck).toHaveLength(expected[n]![1]);
    }
  });

  it("规则书#3 提示标记 8、失误 0、随机先手，各座位都可能先手", () => {
    const starts = new Set<number>();
    for (let seed = 1; seed <= 60; seed += 1) {
      const game = createGame(players(4), seed);
      expect(game.clueTokens).toBe(8);
      expect(game.misfires).toBe(0);
      expect(game.fireworks).toEqual({ R: 0, Y: 0, G: 0, B: 0, W: 0 });
      starts.add(game.currentPlayer);
    }
    expect(starts.size).toBe(4);
  });

  it("人数不对不能开局（1 人、6 人）", () => {
    expect(() => createGame(players(1), 1)).toThrow();
    expect(() => createGame(players(6), 1)).toThrow();
  });

  it("指定发牌顺序：第 1 位先拿满手牌，新摸的放最左", () => {
    const game = createGame(players(2), 3, { stack: [["R", 1], ["R", 2], ["R", 3], ["R", 4], ["R", 5], ["B", 1], ["B", 2], ["B", 3], ["B", 4], ["B", 5], ["W", 1]], firstPlayer: 0 });
    expect(faces(game, 0)).toEqual(["R5", "R4", "R3", "R2", "R1"]);
    expect(faces(game, 1)).toEqual(["B5", "B4", "B3", "B2", "B1"]);
    expect(game.cards[game.deck!.at(-1)!]).toMatchObject({ color: "W", rank: 1 });
  });
});

describe("规则书 4.1 给提示", () => {
  const base = () =>
    buildGame({ players: P3, hands: [undefined, ["R1", "B3", "R4", "G1", "Y5"]], clueTokens: 8 });

  it("规则书#TC3 颜色提示要标全：红色标中位置 0、2，其余记「不是红」，提示标记 8→7", () => {
    const game = base();
    const next = act(game, { type: "CLUE", target: "b", kind: "color", value: "R" });
    const hand = next.players[1]!.hand;
    expect(hand.map((card) => card.clues.color ?? null)).toEqual(["R", null, "R", null, null]);
    expect(hand.map((card) => card.clues.notColors.includes("R"))).toEqual([false, true, false, true, true]);
    expect(next.clueTokens).toBe(7);
    expect(next.currentPlayer).toBe(1);
    const entry = next.history.at(-1)!;
    expect(entry).toMatchObject({ type: "clue", player: "a", target: "b", kind: "color", value: "R" });
    expect(entry.type === "clue" && entry.cardIds).toEqual([idAt(game, 1, 0), idAt(game, 1, 2)]);
  });

  it("规则书#TC4 数字提示：1 标中位置 0、1、3", () => {
    const game = buildGame({ players: P3, hands: [undefined, ["R1", "B1", "R4", "G1", "Y5"]] });
    const next = act(game, { type: "CLUE", target: "b", kind: "rank", value: 1 });
    expect(next.players[1]!.hand.map((card) => card.clues.rank ?? null)).toEqual([1, 1, null, 1, null]);
    expect(next.players[1]!.hand.map((card) => card.clues.notRanks)).toEqual([[], [], [1], [], [1]]);
  });

  it("规则书#TC5 空提示不允许：白色、数字 2 都拒绝", () => {
    const game = base();
    expect(() => act(game, { type: "CLUE", target: "b", kind: "color", value: "W" })).toThrow(/空提示/);
    expect(() => act(game, { type: "CLUE", target: "b", kind: "rank", value: 2 })).toThrow(/空提示/);
  });

  it("规则书#TC6 提示标记 0 时不能提示", () => {
    const game = buildGame({ players: P3, hands: [undefined, ["R1"]], clueTokens: 0 });
    expect(() => act(game, { type: "CLUE", target: "b", kind: "color", value: "R" })).toThrow(/提示标记/);
    expect(legalActions(game, "a").some((a) => a.type === "CLUE")).toBe(false);
  });

  it("每张牌记下提示来源（回合、谁给的、标中没有），重复提示不重复记排除", () => {
    let game = base();
    game = act(game, { type: "CLUE", target: "b", kind: "color", value: "R" });
    game = act(game, { type: "CLUE", target: "c", kind: "color", value: game.cards[idAt(game, 2, 0)]!.color });
    game = act(game, { type: "CLUE", target: "b", kind: "color", value: "R" });
    const card = game.players[1]!.hand[1]!;
    expect(card.clues.notColors).toEqual(["R"]);
    expect(card.marks).toEqual([
      { turn: 1, from: "a", kind: "color", value: "R", touched: false },
      { turn: 3, from: "c", kind: "color", value: "R", touched: false },
    ]);
    expect(game.players[1]!.hand[0]!.marks[0]).toMatchObject({ touched: true, from: "a" });
  });

  it("值不合法、目标不存在都拒绝", () => {
    const game = base();
    expect(() => act(game, { type: "CLUE", target: "b", kind: "color", value: "X" as Color })).toThrow();
    expect(() => act(game, { type: "CLUE", target: "b", kind: "rank", value: 6 as Rank })).toThrow();
    expect(() => act(game, { type: "CLUE", target: "zz", kind: "rank", value: 1 })).toThrow();
  });

  it("不改输入：apply 前后原状态的 JSON 不变", () => {
    const game = base();
    const before = JSON.stringify(game);
    apply(game, "a", { type: "CLUE", target: "b", kind: "color", value: "R" });
    apply(game, "a", { type: "PLAY", cardId: idAt(game, 0, 0) });
    expect(JSON.stringify(game)).toBe(before);
  });
});

describe("规则书 4.2 弃牌", () => {
  it("规则书#TC7 8 个标记时不能弃；7 个时弃 1 张 → 8 个，弃牌堆 +1，牌堆 −1，手牌数不变", () => {
    const full = buildGame({ players: 2, clueTokens: 8 });
    expect(() => act(full, { type: "DISCARD", cardId: idAt(full, 0, 0) })).toThrow(/满/);
    const game = buildGame({ players: 2, clueTokens: 7 });
    const id = idAt(game, 0, 2);
    const next = act(game, { type: "DISCARD", cardId: id });
    expect(next.clueTokens).toBe(8);
    expect(next.discard).toEqual([...game.discard, id]);
    expect(next.deckCount).toBe(game.deckCount - 1);
    expect(next.players[0]!.hand).toHaveLength(5);
    expect(next.players[0]!.hand.some((c) => c.id === id)).toBe(false);
    // 新摸的放最左
    expect(next.players[0]!.hand[0]!.id).toBe(game.deck!.at(-1));
  });
});

describe("规则书 4.3 出牌", () => {
  it("规则书#TC8 红色到 2 时出红 3 → 红色到 3，失误不变，补 1 张", () => {
    const game = buildGame({ players: 2, hands: [["R3"]], fireworks: { R: 2 }, clueTokens: 5 });
    const next = act(game, { type: "PLAY", cardId: idAt(game, 0, 0) });
    expect(next.fireworks.R).toBe(3);
    expect(next.misfires).toBe(0);
    expect(next.players[0]!.hand).toHaveLength(5);
    expect(next.clueTokens).toBe(5);
    expect(next.played).toContain(idAt(game, 0, 0));
  });

  it("规则书#TC9 打错：蓝到 1 出蓝 3 → 进弃牌堆、失误 0→1、蓝仍是 1、补牌；同色重复也算错", () => {
    const game = buildGame({ players: 2, hands: [["B3"]], fireworks: { B: 1 } });
    const next = act(game, { type: "PLAY", cardId: idAt(game, 0, 0) });
    expect(next.misfires).toBe(1);
    expect(next.fireworks.B).toBe(1);
    expect(next.discard).toContain(idAt(game, 0, 0));
    expect(next.players[0]!.hand).toHaveLength(5);
    const dup = buildGame({ players: 2, hands: [["R3"]], fireworks: { R: 3 } });
    expect(act(dup, { type: "PLAY", cardId: idAt(dup, 0, 0) }).misfires).toBe(1);
  });

  it("没打过的颜色只有 1 能出", () => {
    const game = buildGame({ players: 2, hands: [["G2", "G1"]] });
    expect(act(game, { type: "PLAY", cardId: idAt(game, 0, 0) }).misfires).toBe(1);
    expect(act(game, { type: "PLAY", cardId: idAt(game, 0, 1) }).fireworks.G).toBe(1);
  });

  it("规则书#TC10 打出 5 拿回 1 个标记；8 个都在时不拿", () => {
    const game = buildGame({ players: 2, hands: [["R5"]], fireworks: { R: 4 }, clueTokens: 5 });
    const next = act(game, { type: "PLAY", cardId: idAt(game, 0, 0) });
    expect(next.fireworks.R).toBe(5);
    expect(next.clueTokens).toBe(6);
    expect(next.history.at(-1)).toMatchObject({ type: "play", success: true, bonus: true });
    const full = buildGame({ players: 2, hands: [["G5"]], fireworks: { G: 4 }, clueTokens: 8 });
    const after = act(full, { type: "PLAY", cardId: idAt(full, 0, 0) });
    expect(after.fireworks.G).toBe(5);
    expect(after.clueTokens).toBe(8);
  });

  it("规则书#TC11 第 3 次打错：立即结束，0 分，失败前进度 14", () => {
    const game = buildGame({ players: 3, hands: [["W3"]], fireworks: { R: 4, Y: 2, G: 5, B: 3 }, misfires: 2 });
    const next = act(game, { type: "PLAY", cardId: idAt(game, 0, 0) });
    expect(next.phase).toBe("finished");
    expect(next.result).toEqual({ score: 0, reason: "misfire", progress: 14, won: false });
    // 不再补牌
    expect(next.players[0]!.hand).toHaveLength(4);
    expect(next.deckCount).toBe(game.deckCount);
  });
});

describe("规则书 4.4 / 9.3 隐藏信息", () => {
  it("规则书#TC14 甲视角：自己手牌没有牌面，乙丙有，牌堆只有张数，序列化后搜不到甲的牌面", () => {
    const game = createGame(P3, 99);
    const view = redactGameForViewer(game, "a");
    expect(view.deck).toBeUndefined();
    expect(view.seed).toBeUndefined();
    expect(view.rngState).toBeUndefined();
    expect(view.log).toBeUndefined();
    expect(view.deckCount).toBe(35);
    for (const card of view.players[0]!.hand) {
      expect(Object.keys(card).sort()).toEqual(["clues", "drawnAt", "id", "marks"]);
      expect(view.cards[card.id]).toBeUndefined();
    }
    for (const seat of [1, 2]) for (const card of view.players[seat]!.hand) expect(view.cards[card.id]).toEqual(game.cards[card.id]);
    // 能看到的牌面只有乙丙的 10 张
    expect(Object.keys(view.cards)).toHaveLength(10);
    const json = JSON.stringify(view);
    for (const card of game.players[0]!.hand) expect(json).not.toMatch(new RegExp(`"id":${card.id},"color"`));
    for (const id of game.deck!) expect(view.cards[id]).toBeUndefined();
  });

  it("补充#3.4 摸牌事件不带牌面；出牌、弃牌后牌面才公开", () => {
    const game = buildGame({ players: 2, clueTokens: 5 });
    const next = act(game, { type: "DISCARD", cardId: idAt(game, 0, 0) });
    const drew = next.events.find((e) => e.type === "Drew")!;
    expect(Object.keys(drew).sort()).toEqual(["cardId", "player", "type"]);
    const view = redactGameForViewer(next, "p1");
    expect(view.cards[(drew as { cardId: number }).cardId]).toBeUndefined();
    expect(view.cards[idAt(game, 0, 0)]).toEqual(game.cards[idAt(game, 0, 0)]);
    // 对方看得到我新摸的牌
    expect(redactGameForViewer(next, "p2").cards[(drew as { cardId: number }).cardId]).toBeDefined();
  });

  it("观战：默认看不到任何手牌；上帝视角看得到所有手牌但仍看不到牌堆", () => {
    const game = createGame(P3, 5);
    const pub = redactGameForViewer(game, "");
    expect(Object.keys(pub.cards)).toHaveLength(0);
    const god = redactGameForViewer(game, "", { seeAll: true });
    expect(Object.keys(god.cards)).toHaveLength(15);
    expect(god.deck).toBeUndefined();
    for (const id of game.deck!) expect(god.cards[id]).toBeUndefined();
  });

  it("删减后的状态不和原状态共享对象（改它不会改到服务器状态）", () => {
    const game = createGame(P3, 5);
    const view = redactGameForViewer(game, "a");
    view.players[1]!.hand[0]!.clues.notColors.push("R");
    expect(game.players[1]!.hand[0]!.clues.notColors).toEqual([]);
  });

  it("每个回合、每个视角都不泄露自己的手牌（整局随机对局抽查）", () => {
    let game = createGame(players(4), 77);
    let steps = 0;
    while (game.phase === "playing" && steps < 300) {
      for (const p of game.players) {
        const view = redactGameForViewer(game, p.id);
        for (const card of p.hand) expect(view.cards[card.id]).toBeUndefined();
        expect(Object.keys(view.cards).length).toBe(game.discard.length + game.played.length + game.players.filter((o) => o.id !== p.id).reduce((s, o) => s + o.hand.length, 0));
      }
      const actions = legalActions(game, game.players[game.currentPlayer]!.id);
      game = act(game, actions[(steps * 7) % actions.length]!);
      steps += 1;
    }
  });
});

describe("规则书 4.5 / 9.2 行动校验", () => {
  it("规则书#TC15 不是自己的回合拒绝；提示自己拒绝；出/弃不在自己手里的牌拒绝", () => {
    const game = buildGame({ players: P3, clueTokens: 5 });
    expect(() => applyCommand(game, "b", { type: "PLAY", cardId: idAt(game, 1, 0) })).toThrow(/轮到/);
    expect(() => act(game, { type: "CLUE", target: "a", kind: "rank", value: 1 })).toThrow(/自己/);
    expect(() => act(game, { type: "PLAY", cardId: idAt(game, 1, 0) })).toThrow(/不在你手里/);
    expect(() => act(game, { type: "DISCARD", cardId: 999 })).toThrow(/不在你手里/);
    expect(() => act(game, { type: "BOGUS" } as unknown as GameCommand)).toThrow();
  });

  it("补充#3.3 整理手牌：随时都能整理，只改显示顺序，提示跟着牌走，不算一回合", () => {
    let game = buildGame({ players: P3, hands: [undefined, ["R1", "B3", "R4", "G1", "Y5"]] });
    game = act(game, { type: "CLUE", target: "b", kind: "color", value: "R" });
    const hand = game.players[1]!.hand;
    // 现在轮到乙；丙不在自己回合也能整理
    const order = [hand[4]!.id, hand[3]!.id, hand[2]!.id, hand[1]!.id, hand[0]!.id];
    const next = applyCommand(game, "b", { type: "REORDER", order });
    expect(next.players[1]!.hand.map((c) => c.id)).toEqual(order);
    expect(next.players[1]!.hand[2]!.clues.color).toBe("R");
    expect(next.players[1]!.hand[4]!.clues.color).toBe("R");
    expect(next.turn).toBe(game.turn);
    expect(next.currentPlayer).toBe(game.currentPlayer);
    expect(next.version).toBe(game.version + 1);
    const third = applyCommand(game, "c", { type: "REORDER", order: [...game.players[2]!.hand.map((c) => c.id)].reverse() });
    expect(third.turn).toBe(game.turn);
    // 摸牌序号不变
    expect([...next.players[1]!.hand].sort((x, y) => x.drawnAt - y.drawnAt).map((c) => c.id)).toEqual([...hand].sort((x, y) => x.drawnAt - y.drawnAt).map((c) => c.id));
    expect(() => applyCommand(game, "b", { type: "REORDER", order: order.slice(1) })).toThrow();
    expect(() => applyCommand(game, "b", { type: "REORDER", order: [order[0]!, ...order.slice(0, 4)] })).toThrow();
  });
});

describe("规则书第 5 节 特殊情况", () => {
  it("提示标记 0：合法行动里没有提示；8：没有弃牌", () => {
    const zero = buildGame({ players: 2, clueTokens: 0 });
    const types0 = new Set(legalActions(zero, "p1").map((a) => a.type));
    expect(types0).toEqual(new Set(["PLAY", "DISCARD"]));
    const eight = buildGame({ players: 2, clueTokens: 8 });
    expect(new Set(legalActions(eight, "p1").map((a) => a.type))).toEqual(new Set(["PLAY", "CLUE"]));
  });

  it("第 3 次打错时牌堆刚好剩 1 张：失败优先，不摸牌", () => {
    const game = buildGame({ players: 2, hands: [["Y3"]], misfires: 2, deckSize: 1 });
    const next = act(game, { type: "PLAY", cardId: idAt(game, 0, 0) });
    expect(next.result?.reason).toBe("misfire");
    expect(next.deckCount).toBe(1);
    expect(next.finalRoundEndsAfter).toBeNull();
  });

  it("最后一轮里第 3 次打错：仍是 0 分", () => {
    const game = buildGame({ players: 2, hands: [["Y3"]], misfires: 2, deckSize: 0, fireworks: { R: 5 }, finalRound: { endsAfter: 1, turnsLeft: 2 } });
    const next = act(game, { type: "PLAY", cardId: idAt(game, 0, 0) });
    expect(next.result).toMatchObject({ score: 0, reason: "misfire", progress: 5 });
  });
});

describe("规则书第 6 节 计分", () => {
  it("规则书#6 例 1：红 4 黄 2 绿 5 蓝 3 白 0 → 14 分", () => {
    expect(scoreOf({ fireworks: { R: 4, Y: 2, G: 5, B: 3, W: 0 } })).toBe(14);
  });
});

describe("规则书第 7 节 游戏结束", () => {
  it("规则书#TC12 3 人：乙摸走最后一张 → 丙、甲、乙各行动一次后结束，14 分，期间不补牌", () => {
    let game = buildGame({
      players: P3,
      hands: [["W2", "W2", "B1", "B1", "R1"], ["W3", "Y1", "Y1", "G1", "G1"], ["W4", "W4", "W3", "R1", "R5"]],
      fireworks: { R: 4, Y: 2, G: 5, B: 3 },
      deck: ["W1"],
      deckSize: 1,
      current: 1,
      clueTokens: 4,
    });
    game = act(game, { type: "DISCARD", cardId: idAt(game, 1, 4) });
    expect(game.deckCount).toBe(0);
    expect(game.finalRoundEndsAfter).toBe("b");
    expect(game.events.some((e) => e.type === "FinalRound")).toBe(true);
    expect(game.players[1]!.hand).toHaveLength(5);
    // 丙
    expect(game.currentPlayer).toBe(2);
    game = act(game, { type: "DISCARD", cardId: idAt(game, 2, 0) });
    expect(game.players[2]!.hand).toHaveLength(4);
    // 甲
    expect(game.phase).toBe("playing");
    game = act(game, { type: "CLUE", target: "b", kind: "rank", value: 1 });
    // 乙最后一次
    expect(game.currentPlayer).toBe(1);
    expect(game.phase).toBe("playing");
    game = act(game, { type: "DISCARD", cardId: idAt(game, 1, 0) });
    expect(game.phase).toBe("finished");
    expect(game.result).toEqual({ score: 14, reason: "deckOut", progress: 14, won: true });
    expect(game.players[1]!.hand).toHaveLength(4);
  });

  it("最后一轮由出牌摸走最后一张也一样（2 人：对方、自己各一次）", () => {
    let game = buildGame({ players: 2, hands: [["R1"]], deckSize: 1, clueTokens: 3 });
    game = act(game, { type: "PLAY", cardId: idAt(game, 0, 0) });
    expect(game.finalRoundEndsAfter).toBe("p1");
    game = act(game, { type: "DISCARD", cardId: idAt(game, 1, 0) });
    expect(game.phase).toBe("playing");
    game = act(game, { type: "DISCARD", cardId: idAt(game, 0, 0) });
    expect(game.phase).toBe("finished");
    expect(game.result?.score).toBe(1);
  });

  it("规则书#TC13 牌堆还有 10 张时打满 25：立即结束，25 分，perfect", () => {
    const game = buildGame({ players: 2, hands: [["W5"]], fireworks: { R: 5, Y: 5, G: 5, B: 5, W: 4 }, deckSize: 10, clueTokens: 3 });
    const next = act(game, { type: "PLAY", cardId: idAt(game, 0, 0) });
    expect(next.result).toEqual({ score: 25, reason: "perfect", progress: 25, won: true });
    expect(next.deckCount).toBe(9);
  });

  it("最后一轮里打满 25：立即结束", () => {
    const game = buildGame({ players: 3, hands: [["W5"]], fireworks: { R: 5, Y: 5, G: 5, B: 5, W: 4 }, deckSize: 0, finalRound: { endsAfter: 2, turnsLeft: 3 } });
    expect(act(game, { type: "PLAY", cardId: idAt(game, 0, 0) }).result?.reason).toBe("perfect");
  });
});

describe("规则书第 8 节 人数差异 / 大师模式", () => {
  it("人数差异只有手牌数", () => {
    expect([2, 3, 4, 5].map((n) => createGame(players(n), 1).config.handSize)).toEqual([5, 5, 4, 4]);
  });

  it("大师模式：牌堆摸完不进最后一轮，手牌越打越少，一直打下去", () => {
    let game = buildGame({ players: 2, masterMode: true, hands: [["W4"], ["W5"]], fireworks: { R: 5, Y: 5, G: 5, B: 5, W: 3 }, deckSize: 1, clueTokens: 3 });
    game = act(game, { type: "DISCARD", cardId: game.players[0]!.hand.at(-1)!.id });
    expect(game.deckCount).toBe(0);
    expect(game.finalRoundEndsAfter).toBeNull();
    expect(game.finalTurn).toBeNull();
    for (let k = 0; k < 4; k += 1) {
      const me = game.players[game.currentPlayer]!;
      game = act(game, { type: "DISCARD", cardId: me.hand.at(-1)!.id });
    }
    expect(game.phase).toBe("playing");
    expect(game.players.reduce((s, p) => s + p.hand.length, 0)).toBe(6);
    // 打出 W4、W5 → 25 分，大师模式胜利
    const find = (seat: number, rank: number) => game.players[seat]!.hand.find((c) => game.cards[c.id]!.color === "W" && game.cards[c.id]!.rank === rank)!.id;
    expect(game.currentPlayer).toBe(1);
    game = act(game, { type: "CLUE", target: "p1", kind: "rank", value: 4 });
    game = act(game, { type: "PLAY", cardId: find(0, 4) });
    game = act(game, { type: "PLAY", cardId: find(1, 5) });
    expect(game.result).toMatchObject({ score: 25, won: true, reason: "perfect" });
  });

  it("大师模式：不可缺的牌（红 5）进了弃牌堆 → 失败，0 分，记下是哪张", () => {
    const game = buildGame({ players: 2, masterMode: true, hands: [["R5"], ["R4", "R4", "Y5", "G5", "B5"]], fireworks: { R: 3, Y: 4, G: 4, B: 4, W: 5 }, clueTokens: 5, deckSize: 0 });
    const next = act(game, { type: "DISCARD", cardId: idAt(game, 0, 0) });
    expect(next.result).toEqual({ score: 0, reason: "impossible", progress: 20, won: false, lostCard: { color: "R", rank: 5 } });
  });

  it("大师模式：两张 4 都弃了也算失败；还有一张就不算", () => {
    const game = buildGame({ players: 2, masterMode: true, hands: [["B4"], ["B4"]], discard: [], fireworks: { B: 2 }, clueTokens: 5 });
    const once = act(game, { type: "DISCARD", cardId: idAt(game, 0, 0) });
    expect(once.phase).toBe("playing");
    const twice = act(once, { type: "DISCARD", cardId: once.players[1]!.hand.find((c) => once.cards[c.id]!.color === "B" && once.cards[c.id]!.rank === 4)!.id });
    expect(twice.result).toMatchObject({ reason: "impossible", lostCard: { color: "B", rank: 4 } });
  });

  it("普通模式：弃掉 5 不会提前结束", () => {
    const game = buildGame({ players: 2, hands: [["R5"]], clueTokens: 5 });
    expect(act(game, { type: "DISCARD", cardId: idAt(game, 0, 0) }).phase).toBe("playing");
  });

  it("大师模式打满 25 才算赢", () => {
    const game = buildGame({ players: 2, masterMode: true, hands: [["W5"]], fireworks: { R: 5, Y: 5, G: 5, B: 5, W: 4 }, deckSize: 0 });
    expect(act(game, { type: "PLAY", cardId: idAt(game, 0, 0) }).result).toMatchObject({ score: 25, won: true, reason: "perfect" });
  });

  it("大师模式：手里没牌又没有提示标记的人自动跳过", () => {
    const game = buildGame({ players: 3, masterMode: true, hands: [["W3"], [], ["W4", "W5"]], fireworks: { R: 5, Y: 5, G: 5, B: 5, W: 2 }, deckSize: 0, clueTokens: 0 });
    // buildGame 会把剩余牌补满手牌，这里手动清空乙的手牌造局面
    game.players[1]!.hand = [];
    const next = act(game, { type: "PLAY", cardId: idAt(game, 0, 0) });
    expect(next.currentPlayer).toBe(2);
    expect(next.events.some((e) => e.type === "TurnSkipped" && e.player === "b")).toBe(false);
    expect(next.events.some((e) => e.type === "TurnSkipped" && e.player === "p2")).toBe(true);
    expect(next.history.at(-1)).toMatchObject({ type: "pass", player: "p2" });
  });
});

describe("规则书 9.4 / 补充 1.6、3.5 超时自动行动", () => {
  it("标记不满 8：弃最早摸到、没被提示过的那张（按摸牌顺序，不受整理影响）", () => {
    let game = buildGame({ players: 2, hands: [[{ face: "R1" }, { face: "B2" }, { face: "G3", rank: true }, { face: "Y4" }, { face: "W1", color: true }]], clueTokens: 5 });
    // 把手牌倒过来整理：显示顺序变了，斩牌位不变（摸牌顺序里最早的未提示牌是 Y4）
    game = applyCommand(game, "p1", { type: "REORDER", order: [...game.players[0]!.hand.map((c) => c.id)].reverse() });
    const next = timeoutTurn(game);
    expect(next.history.at(-1)).toMatchObject({ type: "discard", color: "Y", rank: 4, auto: true });
    expect(next.events[0]).toEqual({ type: "TurnTimedOut", player: "p1" });
    expect(next.clueTokens).toBe(6);
  });

  it("全部都有提示：弃最早摸到的那张", () => {
    const game = buildGame({ players: 2, hands: [[{ face: "R1", color: true }, { face: "B2", rank: true }, { face: "G3", rank: true }]], clueTokens: 5 });
    const hand = game.players[0]!.hand.map((c) => ({ ...c, clues: { ...c.clues, color: c.clues.color ?? "R" } }));
    game.players[0]!.hand = hand as typeof game.players[0]["hand"];
    expect(timeoutCommand(game)).toEqual({ type: "DISCARD", cardId: game.players[0]!.hand.at(-1)!.id });
  });

  it("标记 8 个：提示下家最新那张牌的颜色，绝不出牌", () => {
    const game = buildGame({ players: P3, hands: [undefined, ["G4", "R1"]], clueTokens: 8 });
    const next = timeoutTurn(game);
    expect(next.history.at(-1)).toMatchObject({ type: "clue", target: "b", kind: "color", value: "G", auto: true });
    expect(next.clueTokens).toBe(7);
  });

  it("下家手里没牌（大师模式）：找下一个有牌的队友", () => {
    const game = buildGame({ players: P3, masterMode: true, hands: [undefined, [], ["B2"]], clueTokens: 8, deckSize: 0 });
    game.players[1]!.hand = [];
    expect(timeoutCommand(game)).toEqual({ type: "CLUE", target: "c", kind: "color", value: "B" });
  });

  it("什么都做不了：跳过这一回合", () => {
    const game = buildGame({ players: 2, masterMode: true, hands: [[], ["W5"]], fireworks: { R: 5, Y: 5, G: 5, B: 5, W: 4 }, clueTokens: 0, deckSize: 0 });
    game.players[0]!.hand = [];
    const next = timeoutTurn(game);
    expect(next.currentPlayer).toBe(1);
    expect(next.history.at(-1)).toMatchObject({ type: "pass", player: "p1" });
  });

  it("随机局面里超时从不出牌", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      let game = createGame(players(2 + (seed % 4)), seed);
      while (game.phase === "playing") {
        const before = game.misfires;
        game = timeoutTurn(game);
        expect(game.misfires).toBe(before);
        expect(game.history.at(-1)?.type).not.toBe("play");
      }
      expect(game.result?.reason).toBe("deckOut");
    }
  });
});

/** 随机对局：每种人数 300 局，普通模式和大师模式各一半，检查不变量。 */
describe("随机对局不变量", () => {
  for (const n of [2, 3, 4, 5]) {
    it(`${n} 人 300 局：配件守恒、标记范围、回合推进、终局判定、不会卡死`, () => {
      const problems: string[] = [];
      const reasons: Record<string, number> = {};
      for (let seed = 1; seed <= 300; seed += 1) {
        const master = seed % 2 === 0;
        let game = createGame(players(n), seed * 31 + n, { masterMode: master });
        let x = seed;
        const rand = (k: number) => {
          x = (x * 1103515245 + 12345) & 0x7fffffff;
          return x % k;
        };
        let steps = 0;
        while (game.phase === "playing") {
          const pid = game.players[game.currentPlayer]!.id;
          const actions = legalActions(game, pid);
          if (actions.length === 0) {
            problems.push(`卡死 seed=${seed}`);
            break;
          }
          // 少出牌（随机出牌很快就三次打错），多给提示和弃牌，让局面走得更长
          let action = actions[rand(actions.length)]!;
          if (action.type === "PLAY" && rand(4) !== 0) action = actions[rand(actions.length)]!;
          if (rand(10) === 0) {
            const other = game.players[rand(n)]!;
            game = applyCommand(game, other.id, { type: "REORDER", order: [...other.hand.map((c) => c.id)].reverse() });
          }
          const prevTurn = game.turn;
          const prevVersion = game.version;
          game = applyCommand(game, pid, action);
          steps += 1;
          if (game.version <= prevVersion) problems.push(`version 没前进 seed=${seed}`);
          if (game.phase === "playing" && game.turn <= prevTurn) problems.push(`回合没推进 seed=${seed}`);
          if (countAll(game) !== 50) problems.push(`配件不守恒 seed=${seed} ${countAll(game)}`);
          if (game.clueTokens < 0 || game.clueTokens > 8) problems.push(`提示标记越界 ${game.clueTokens}`);
          if (game.misfires < 0 || game.misfires > 3) problems.push(`失误越界 ${game.misfires}`);
          if (game.deckCount !== game.deck!.length) problems.push("牌堆张数不一致");
          const ids = [...game.players.flatMap((p) => p.hand.map((c) => c.id)), ...game.discard, ...game.played, ...game.deck!];
          if (new Set(ids).size !== 50) problems.push(`有重复的牌 seed=${seed}`);
          for (const p of game.players) if (p.hand.length > game.config.handSize) problems.push("手牌超过上限");
          if (game.phase === "playing" && game.deckCount > 0) for (const p of game.players) if (p.hand.length !== game.config.handSize) problems.push(`牌堆没空时手牌不满 seed=${seed}`);
          // 烟火和已打出的牌一致
          for (const color of ["R", "Y", "G", "B", "W"] as Color[]) {
            const ranks = game.played.map((id) => game.cards[id]!).filter((c) => c.color === color).map((c) => c.rank);
            if (ranks.length !== game.fireworks[color] || ranks.some((r, i) => r !== i + 1)) problems.push(`烟火不一致 seed=${seed}`);
          }
          if (steps > 400) {
            problems.push(`死循环 seed=${seed}`);
            break;
          }
        }
        const result = game.result;
        if (!result) continue;
        reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
        const progress = scoreOf(game);
        if (result.progress !== progress) problems.push("进度和烟火不一致");
        if (result.reason === "misfire" && (result.score !== 0 || game.misfires !== 3)) problems.push("打错 3 次没记 0 分");
        if (result.reason === "deckOut" && (master || result.score !== progress || game.deckCount !== 0)) problems.push(`牌堆摸完结束不对 seed=${seed}`);
        if (result.reason === "impossible" && (!master || result.score !== 0)) problems.push("缺牌失败只在大师模式");
        if (result.reason === "perfect" && result.score !== 25) problems.push("完美不是 25 分");
        if (result.reason === "stuck") problems.push(`卡住结束 seed=${seed}`);
        if (!master && result.reason === "deckOut" && game.turn !== game.finalTurn) problems.push("最后一轮长度不对");
      }
      expect(problems.slice(0, 5)).toEqual([]);
      expect(reasons.misfire ?? 0).toBeGreaterThan(0);
      expect((reasons.deckOut ?? 0) + (reasons.impossible ?? 0)).toBeGreaterThan(0);
    });
  }
});
