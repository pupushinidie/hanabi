import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import {
  buildGame,
  CHAT_PRESETS,
  type AckResponse,
  type ClientToServerEvents,
  type GameCommand,
  type GameState,
  type LobbyRoomSnapshot,
  type ServerToClientEvents,
} from "@hanabi/game";

// 每步 2 秒超时（测整理手牌不重置倒计时）；人机立刻行动。
process.env.BOT_DELAY_SCALE = "0";
process.env.TURN_MS = "2000";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
const clients = new Set<TestSocket>();
const latest = new Map<TestSocket, LobbyRoomSnapshot>();
/** 间谍：记下发给每个连接的每一条房间更新（原始 JSON）。 */
const received = new Map<TestSocket, string[]>();
let serverUrl = "";
let server: typeof import("../src/index.js");
let seq = 0;

function connect(): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const client: TestSocket = createClient(serverUrl, { transports: ["websocket"], reconnection: false });
    clients.add(client);
    received.set(client, []);
    client.on("room:updated", (room) => {
      latest.set(client, room);
      received.get(client)!.push(JSON.stringify(room));
    });
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}
const nick = (prefix: string) => `${prefix}${++seq}`;
function call<T>(send: (ack: (response: AckResponse<T>) => void) => void): Promise<AckResponse<T>> {
  return new Promise((resolve) => send(resolve));
}
function updateWhere(client: TestSocket, test: (room: LobbyRoomSnapshot) => boolean, timeoutMs = 10_000): Promise<LobbyRoomSnapshot> {
  return new Promise((resolve, reject) => {
    const current = latest.get(client);
    if (current && test(current)) return resolve(current);
    const timer = setTimeout(() => {
      client.off("room:updated", handler);
      reject(new Error("等不到想要的房间状态"));
    }, timeoutMs);
    const handler = (room: LobbyRoomSnapshot) => {
      if (!test(room)) return;
      clearTimeout(timer);
      client.off("room:updated", handler);
      resolve(room);
    };
    client.on("room:updated", handler);
  });
}
const seatOf = (client: TestSocket) => latest.get(client)?.members.find((m) => m.id === client.id)?.playerId ?? "";
const command = (client: TestSocket, cmd: GameCommand) => call<LobbyRoomSnapshot>((ack) => client.emit("game:command", cmd, ack));
const chat = (client: TestSocket, message: string) => call<void>((ack) => client.emit("room:chat", { message }, ack));
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 开一个两人房：返回房主、客人、房间码。 */
async function twoPlayerRoom(masterMode = false) {
  const host = await connect();
  const guest = await connect();
  const created = await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("房主"), capacity: 2, masterMode }, ack));
  if (!created.ok) throw new Error(created.error);
  const code = created.data.code;
  const guestName = nick("客人");
  expect((await call<LobbyRoomSnapshot>((ack) => guest.emit("room:join", { name: guestName, code }, ack))).ok).toBe(true);
  expect((await call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack))).ok).toBe(true);
  await updateWhere(guest, (room) => room.game !== undefined);
  await updateWhere(host, (room) => room.game !== undefined);
  return { host, guest, code, guestName };
}

/** 当前轮到的那个连接。 */
function mover(a: TestSocket, b: TestSocket): TestSocket {
  // 取两边里最新的那份（另一边的更新可能还在路上）
  const ga = latest.get(a)!.game!;
  const gb = latest.get(b)!.game!;
  const game = ga.version >= gb.version ? ga : gb;
  return game.players[game.currentPlayer]!.id === seatOf(a) ? a : b;
}

/** 间谍检查：发给 client 的所有消息里，都拿不到它自己手牌的牌面、牌堆顺序和种子。 */
function assertNoLeak(client: TestSocket, truth: () => GameState | undefined) {
  const messages = received.get(client)!;
  expect(messages.length).toBeGreaterThan(0);
  const seat = seatOf(client);
  for (const raw of messages) {
    const room = JSON.parse(raw) as LobbyRoomSnapshot;
    expect(raw).not.toMatch(/"deck"|"seed"|"rngState"|"log"/);
    const game = room.game;
    if (!game) continue;
    const me = game.players.find((p) => p.id === seat)!;
    if (game.phase === "finished") continue; // 结束后亮牌（牌堆仍不给，上面已查）
    for (const card of me.hand) {
      expect(game.cards[card.id], "自己的手牌不该有牌面").toBeUndefined();
      expect(Object.keys(card).sort()).toEqual(["clues", "drawnAt", "id", "marks"]);
    }
    for (const event of game.events) if (event.type === "Drew") expect(Object.keys(event).sort()).toEqual(["cardId", "player", "type"]);
    // 下发的牌面只能是：弃牌堆、已打出的、别人手里的
    const allowed = new Set([...game.discard, ...game.played, ...game.players.filter((p) => p.id !== seat).flatMap((p) => p.hand.map((c) => c.id))]);
    for (const id of Object.keys(game.cards)) expect(allowed.has(Number(id))).toBe(true);
  }
  // 对照服务器的真实牌面：最后一条消息里看得到的牌面都和真实一致
  const real = truth();
  const last = latest.get(client)!.game!;
  if (real && real.version === last.version && real.history.length === last.history.length && real.deckCount === last.deckCount) for (const [id, face] of Object.entries(last.cards)) expect(real.cards[Number(id)]).toEqual(face);
}

describe("花火服务器", () => {
  beforeAll(async () => {
    server = await import("../src/index.js");
    await new Promise<void>((resolve, reject) => {
      server.httpServer.once("error", reject);
      server.httpServer.listen(0, resolve);
    });
    serverUrl = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    for (const client of clients) client.disconnect();
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
  });

  it("建房 → 加入 → 开局 → 提示 / 弃牌 / 出牌 → 终局 → 结算显示最高分 → 再来一局；全程抓包不泄露", async () => {
    const { host, guest, code } = await twoPlayerRoom();
    // 开局：5 张手牌，牌堆 40
    const opening = latest.get(guest)!.game!;
    expect(opening.deckCount).toBe(40);
    expect(opening.players.every((p) => p.hand.length === 5)).toBe(true);

    // 提示
    let who = mover(host, guest);
    let other = who === host ? guest : host;
    const otherHand = latest.get(who)!.game!.players.find((p) => p.id === seatOf(other))!.hand;
    const face = latest.get(who)!.game!.cards[otherHand[0]!.id]!;
    let res = await command(who, { type: "CLUE", target: seatOf(other), kind: "rank", value: face.rank });
    expect(res.ok).toBe(true);
    await updateWhere(other, (room) => room.game!.clueTokens === 7);
    expect(latest.get(other)!.game!.players.find((p) => p.id === seatOf(other))!.hand[0]!.clues.rank).toBe(face.rank);
    // 弃牌
    who = mover(host, guest);
    other = who === host ? guest : host;
    const mine = latest.get(who)!.game!.players.find((p) => p.id === seatOf(who))!.hand;
    res = await command(who, { type: "DISCARD", cardId: mine.at(-1)!.id });
    expect(res.ok).toBe(true);
    await updateWhere(other, (room) => room.game!.discard.length === 1);
    // 出牌（可能成功也可能打错）
    who = mover(host, guest);
    await updateWhere(who, (room) => room.game!.discard.length === 1);
    const before = latest.get(who)!.game!;
    res = await command(who, { type: "PLAY", cardId: before.players.find((p) => p.id === seatOf(who))!.hand[0]!.id });
    expect(res.ok).toBe(true);
    const afterPlay = res.ok ? res.data.game! : before;
    expect(afterPlay.history.at(-1)!.type).toBe("play");
    // 不是自己的回合不能动
    const notMover = mover(host, guest) === host ? guest : host;
    expect((await command(notMover, { type: "PLAY", cardId: 0 })).ok).toBe(false);

    // 换成「最后一轮只剩当前玩家一次行动」的局面，弃牌结束
    const hostSeat = seatOf(host);
    const guestSeat = seatOf(guest);
    const names = latest.get(host)!.game!.players.map((p) => ({ id: p.id, name: p.name }));
    const ending = buildGame({ players: names, fireworks: { R: 4, Y: 2, G: 5, B: 3 }, deckSize: 0, clueTokens: 3, current: 0, turn: 60, finalRound: { endsAfter: 0, turnsLeft: 1 } });
    server.testHooks.setGame(code, ending);
    const finalMover = names[0]!.id === hostSeat ? host : guest;
    await updateWhere(finalMover, (room) => room.game!.turn === 60);
    res = await command(finalMover, { type: "DISCARD", cardId: ending.players[0]!.hand[0]!.id });
    expect(res.ok).toBe(true);
    const done = await updateWhere(host, (room) => room.game?.phase === "finished" && room.rematch !== undefined);
    expect(done.game!.result).toEqual({ score: 14, reason: "deckOut", progress: 14, won: true });
    expect(done.best).toEqual({ score: 14, games: 1 });
    // 结算时大家看得到所有人的手牌（对局结束）？不：仍然按规则删减，自己的牌面结算时由历史记录显示
    // 结算时自由聊天
    expect((await chat(host, "这局打得不错，下局再来")).ok).toBe(true);

    // 再来一局
    expect((await call<void>((ack) => host.emit("room:rematch", true, ack))).ok).toBe(true);
    expect((await call<void>((ack) => guest.emit("room:rematch", true, ack))).ok).toBe(true);
    const again = await updateWhere(guest, (room) => room.game?.phase === "playing" && room.game.turn === 1);
    expect(again.best).toEqual({ score: 14, games: 1 });
    expect(guestSeat).toBe(seatOf(guest));

    await updateWhere(host, (room) => room.game?.phase === "playing" && room.game.turn === 1);
    assertNoLeak(guest, () => server.testHooks.getGame(code));
    assertNoLeak(host, () => server.testHooks.getGame(code));
  });

  it("对局中只能发预设短语（观战也一样）；等候房间自由聊天", async () => {
    const host = await connect();
    const created = await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("房主"), capacity: 2 }, ack));
    expect(created.ok).toBe(true);
    const code = created.ok ? created.data.code : "";
    expect((await chat(host, "等人中，随便聊")).ok).toBe(true);
    expect((await call<void>((ack) => host.emit("room:add-bot", ack))).ok).toBe(true);
    const viewer = await connect();
    expect((await call<LobbyRoomSnapshot>((ack) => viewer.emit("room:join", { name: nick("看客"), code, spectate: true }, ack))).ok).toBe(true);
    expect((await call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack))).ok).toBe(true);
    await updateWhere(host, (room) => room.game !== undefined);
    await delay(1100);
    const free = await chat(host, "你最左边那张是红 1");
    expect(free.ok).toBe(false);
    expect(free.ok ? "" : free.error).toMatch(/预设/);
    expect((await chat(host, CHAT_PRESETS[0])).ok).toBe(true);
    expect((await chat(viewer, "乙手里有红 5")).ok).toBe(false);
    await delay(1100);
    expect((await chat(viewer, "好球！")).ok).toBe(true);
  });

  it("整理手牌不算一回合、不重置倒计时；超时自动行动不出牌", async () => {
    const { host, guest, code } = await twoPlayerRoom();
    const who = mover(host, guest);
    const idle = who === host ? guest : host;
    const t0 = latest.get(idle)!.turnRemainingMs!;
    await delay(400);
    const hand = latest.get(idle)!.game!.players.find((p) => p.id === seatOf(idle))!.hand;
    const res = await command(idle, { type: "REORDER", order: [...hand.map((c) => c.id)].reverse() });
    expect(res.ok).toBe(true);
    const after = res.ok ? res.data : undefined;
    expect(after!.game!.turn).toBe(1);
    expect(after!.turnRemainingMs!).toBeLessThan(t0 - 300);
    expect(after!.game!.players.find((p) => p.id === seatOf(idle))!.hand.map((c) => c.id)).toEqual([...hand.map((c) => c.id)].reverse());
    // 超时：8 个标记时自动给提示，不出牌
    server.testHooks.expireTurn(code);
    const timedOut = await updateWhere(host, (room) => room.game!.turn === 2);
    expect(timedOut.game!.events[0]).toMatchObject({ type: "TurnTimedOut" });
    expect(timedOut.game!.history.at(-1)).toMatchObject({ type: "clue", auto: true });
    expect(timedOut.game!.misfires).toBe(0);
    // 真的等超时（2 秒）：标记不满 8，自动弃牌
    const waited = await updateWhere(host, (room) => room.game!.turn === 3, 5000);
    expect(waited.game!.history.at(-1)).toMatchObject({ type: "discard", auto: true });
  });

  it("掉线用原昵称回到原座位，看到的仍是删减过的状态", async () => {
    const { host, guest, code, guestName } = await twoPlayerRoom();
    const seat = seatOf(guest);
    guest.disconnect();
    await updateWhere(host, (room) => room.members.some((m) => m.playerId === seat && !m.connected));
    const back = await connect();
    const rejoined = await call<LobbyRoomSnapshot>((ack) => back.emit("room:join", { name: guestName, code }, ack));
    expect(rejoined.ok).toBe(true);
    const room = rejoined.ok ? rejoined.data : undefined;
    received.get(back)!.push(JSON.stringify(room));
    latest.set(back, room!);
    expect(room!.members.find((m) => m.id === back.id)!.playerId).toBe(seat);
    const me = room!.game!.players.find((p) => p.id === seat)!;
    for (const card of me.hand) expect(room!.game!.cards[card.id]).toBeUndefined();
    assertNoLeak(back, () => server.testHooks.getGame(code));
  });

  it("房主在等待时开大师模式，开局后生效；非房主不能改", async () => {
    const host = await connect();
    const guest = await connect();
    const created = await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("房主"), capacity: 3 }, ack));
    const code = created.ok ? created.data.code : "";
    expect(created.ok && created.data.options.masterMode).toBe(false);
    expect((await call<LobbyRoomSnapshot>((ack) => guest.emit("room:join", { name: nick("客人"), code }, ack))).ok).toBe(true);
    expect((await call<void>((ack) => guest.emit("room:options", { masterMode: true }, ack))).ok).toBe(false);
    expect((await call<void>((ack) => host.emit("room:options", { masterMode: true }, ack))).ok).toBe(true);
    await updateWhere(guest, (room) => room.options.masterMode);
    expect((await call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack))).ok).toBe(true);
    const room = await updateWhere(guest, (r) => r.game !== undefined);
    expect(room.game!.config.masterMode).toBe(true);
    expect(room.game!.config.handSize).toBe(5);
    expect((await call<void>((ack) => host.emit("room:options", { masterMode: false }, ack))).ok).toBe(false);
  });

  it("5 人房：1 个真人 + 4 个人机能开局，手牌 4 张", async () => {
    const host = await connect();
    const created = await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("独行"), capacity: 5 }, ack));
    expect(created.ok).toBe(true);
    for (let k = 0; k < 4; k += 1) expect((await call<void>((ack) => host.emit("room:add-bot", ack))).ok).toBe(true);
    const started = await call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack));
    const room = started.ok ? started.data : (undefined as never);
    expect(room.game!.players.every((p) => p.hand.length === 4)).toBe(true);
    expect(room.game!.deckCount).toBe(30);
  });
});
