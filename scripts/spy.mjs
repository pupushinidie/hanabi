// 抓包脚本：连上真实运行的服务器（先 npm run dev 或 npm start），两个 socket 开一局两人房，
// 一直打到终局，记下服务器发给 B 的每一条 room:updated，检查里面有没有 B 自己手牌的牌面、牌堆顺序、种子。
//   node scripts/spy.mjs            → 默认连 localhost:3024
//   SERVER_URL=http://localhost:3124 node scripts/spy.mjs
import { io } from "socket.io-client";
import { botCommand } from "../packages/game/dist/index.js";

const URL = process.env.SERVER_URL ?? `http://localhost:${process.env.SERVER_PORT ?? 3024}`;
const PATH = process.env.SOCKET_PATH ?? "/socket.io";
const connect = () => new Promise((resolve) => { const s = io(URL, { path: PATH, transports: ["websocket"] }); s.once("connect", () => resolve(s)); });
const emit = (s, event, ...args) => new Promise((resolve) => s.emit(event, ...args, resolve));

const a = await connect();
const b = await connect();
const messages = { a: [], b: [] };
const latest = {};
let finished = false;
for (const [key, s] of [["a", a], ["b", b]]) {
  s.on("room:updated", (room) => {
    messages[key].push(JSON.stringify(room));
    latest[key] = room;
    const game = room.game;
    if (!game) return;
    if (game.phase === "finished") { finished = true; return; }
    const seat = room.members.find((m) => m.id === s.id)?.playerId;
    if (game.players[game.currentPlayer].id !== seat) return;
    const cmd = botCommand(game, seat);
    if (cmd) setTimeout(() => s.emit("game:command", cmd, () => {}), 5);
  });
}
const created = await emit(a, "room:create", { name: "间谍甲", capacity: 2 });
const code = created.data.code;
await emit(b, "room:join", { name: "间谍乙", code });
await emit(a, "room:start");
const t0 = Date.now();
while (!finished && Date.now() - t0 < 120_000) await new Promise((r) => setTimeout(r, 100));

const problems = [];
let checkedCards = 0;
for (const [key, s] of [["a", a], ["b", b]]) {
  const seat = latest[key].members.find((m) => m.id === s.id).playerId;
  for (const raw of messages[key]) {
    if (/"deck"|"seed"|"rngState"|"log"/.test(raw)) problems.push(`${key} 收到了牌堆/种子字段`);
    const game = JSON.parse(raw).game;
    if (!game || game.phase === "finished") continue; // 结束后亮牌
    const me = game.players.find((p) => p.id === seat);
    for (const card of me.hand) {
      checkedCards += 1;
      if (game.cards[card.id]) problems.push(`${key} 看到了自己手牌 ${card.id} 的牌面`);
      if ("color" in card || "rank" in card) problems.push(`${key} 手牌对象带了牌面`);
    }
    for (const ev of game.events) if (ev.type === "Drew" && ("color" in ev || "rank" in ev)) problems.push(`${key} 摸牌事件带了牌面`);
    const allowed = new Set([...game.discard, ...game.played, ...game.players.filter((p) => p.id !== seat).flatMap((p) => p.hand.map((c) => c.id))]);
    for (const id of Object.keys(game.cards)) if (!allowed.has(Number(id))) problems.push(`${key} 收到了不该看的牌 ${id}`);
  }
}
console.log(`对局${finished ? "已结束" : "没打完"}，结果`, JSON.stringify(latest.a?.game?.result));
console.log(`甲收到 ${messages.a.length} 条、乙收到 ${messages.b.length} 条更新，检查了 ${checkedCards} 张自己的手牌`);
console.log(problems.length === 0 ? "没有泄露" : `发现 ${problems.length} 处问题：\n${[...new Set(problems)].slice(0, 20).join("\n")}`);
a.disconnect();
b.disconnect();
process.exit(problems.length === 0 && finished ? 0 : 1);
