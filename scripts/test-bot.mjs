// 本地测试用的陪玩机器人（先 npm run dev）。
//   node scripts/test-bot.mjs host [人数] [机器人数] [master]  → 机器人建房（最后一个参数写 master 开大师模式），
//                                                              拉够机器人，等真人加入凑满后自动开局
//   node scripts/test-bot.mjs join <房间码> [昵称]            → 以一个机器人身份加入别人的房间
// 机器人轮到自己时用人机策略 botCommand 行动（只看自己那份删减过的状态）。
// 环境变量：BOT_DELAY_MS 每步思考时间（默认 1500）；BOT_IDLE=1 只挂着不动（等超时自动行动）；
// BOT_ONCE=1 打完一局就退出（默认自动同意「再来一局」一直陪着打）；BOT_RANDOM=1 随机合法行动（不出牌）。
import { io } from "socket.io-client";
import { botCommand, legalActions } from "../packages/game/dist/index.js";

const URL = process.env.SERVER_URL ?? `http://localhost:${process.env.SERVER_PORT ?? 3024}`;
const PATH = process.env.SOCKET_PATH ?? "/socket.io";
const DELAY = Number(process.env.BOT_DELAY_MS ?? 1500);
const IDLE = process.env.BOT_IDLE === "1";
const ONCE = process.env.BOT_ONCE === "1";
const RANDOM = process.env.BOT_RANDOM === "1";
const NAMES = ["阿蝉", "阿萤", "阿枫", "阿鹤", "阿蛙"];

function bot(name, onRoom) {
  const socket = io(URL, { path: PATH, transports: ["websocket"] });
  let acting = false;
  let latest = null;
  let rematchSent = "";
  const emit = (event, ...args) => new Promise((resolve) => socket.emit(event, ...args, resolve));
  // 回执和新状态的广播可能在同一批消息里到达：每做完一步都回头看最新状态，免得漏掉轮到自己。
  async function tick() {
    const room = latest;
    const game = room?.game;
    if (!game || game.phase === "finished" || IDLE || acting) return;
    const seat = room.members.find((member) => member.id === socket.id)?.playerId;
    if (!seat || legalActions(game, seat).length === 0) return;
    acting = true;
    await new Promise((resolve) => setTimeout(resolve, DELAY));
    try {
      const now = latest?.game ?? game;
      const actions = legalActions(now, seat).filter((action) => action.type !== "PLAY");
      const command = RANDOM && actions.length > 0 ? actions[Math.floor(Math.random() * actions.length)] : botCommand(now, seat);
      if (command) {
        const result = await emit("game:command", command);
        if (!result.ok) console.log(name, "行动失败", result.error);
      }
    } finally {
      acting = false;
    }
    if (latest !== room) void tick();
  }
  socket.on("room:updated", (room) => {
    latest = room;
    onRoom?.(room, socket);
    const game = room.game;
    if (game?.phase === "finished") {
      const key = `${game.version}:${game.turn}`;
      if (rematchSent === key) return;
      rematchSent = key;
      const result = game.result;
      console.log(name, "游戏结束：", result.reason, "得分", result.score, "进度", result.progress, "本房最高", JSON.stringify(room.best));
      if (ONCE) setTimeout(() => process.exit(0), 200);
      else setTimeout(() => void emit("room:rematch", true), DELAY);
      return;
    }
    void tick();
  });
  socket.on("room:closed", ({ reason }) => { console.log(name, "房间关闭：", reason); process.exit(0); });
  return { socket, emit };
}

const [mode, arg1, arg2, arg3] = process.argv.slice(2);
if (mode === "join") {
  const { socket, emit } = bot(arg2 ?? NAMES[0]);
  socket.on("connect", async () => console.log("join", (await emit("room:join", { name: arg2 ?? NAMES[0], code: arg1 })).ok));
} else {
  const capacity = Number(arg1 ?? 2);
  const bots = Number(arg2 ?? capacity - 1);
  const masterMode = arg3 === "master";
  let started = false;
  const host = bot(NAMES[0], async (room) => {
    if (!started && room.status === "waiting" && room.members.length === capacity) {
      started = true;
      const result = await host.emit("room:start");
      console.log("开局", result.ok || result.error);
    }
  });
  host.socket.on("connect", async () => {
    const created = await host.emit("room:create", { name: NAMES[0], capacity, masterMode });
    if (!created.ok) { console.log(created.error); process.exit(1); }
    console.log("房间码", created.data.code);
    for (let index = 1; index < bots; index += 1) {
      const name = NAMES[index];
      const other = bot(name);
      other.socket.on("connect", async () => console.log("加入", name, (await other.emit("room:join", { name, code: created.data.code })).ok));
    }
  });
}
