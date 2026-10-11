// 人机强度测量（补充 1.5）：npx tsx scripts/sim-hanabi.ts [局数，默认 300]
// 每种人数：全人机自对弈、全基线、全随机、混搭（1 个基线座位 + 其余人机）；报平均分、中位数、25 分比例、
// 因 3 次失误 0 分的比例、决策耗时。每一步都由引擎校验合法（不合法会抛错）。
import { applyCommand, baselineCommand, botCommand, createGame, createRng, randomCommand, redactGameForViewer, type GameCommand, type GameState } from "../packages/game/src/index.js";

type Strategy = (view: GameState, me: string, random: () => number) => GameCommand | null;
const STRATS: Record<string, Strategy> = {
  bot: (v, me) => botCommand(v, me),
  baseline: (v, me, r) => baselineCommand(v, me, r),
  random: (v, me, r) => randomCommand(v, me, r),
};

const GAMES = Number(process.argv[2] ?? 300);
const MASTER = process.argv.includes("master");
const MAX_STEPS = 200;

function run(n: number, seats: (seat: number) => string, seed: number, times: number[]): GameState {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
  let game = createGame(players, seed, { masterMode: MASTER });
  const rng = createRng(seed * 7 + 1);
  let steps = 0;
  while (game.phase === "playing") {
    const seat = game.currentPlayer;
    const pid = players[seat]!.id;
    const view = redactGameForViewer(game, pid);
    const strat = seats(seat);
    const t0 = performance.now();
    const cmd = STRATS[strat]!(view, pid, () => rng.next());
    const dt = performance.now() - t0;
    if (strat === "bot") times.push(dt);
    if (!cmd) throw new Error(`没有行动 seed=${seed}`);
    game = applyCommand(game, pid, cmd);
    if (++steps > MAX_STEPS) throw new Error(`死循环 seed=${seed}`);
  }
  return game;
}

function summarize(label: string, games: GameState[]) {
  const scores = games.map((g) => g.result!.score).sort((a, b) => a - b);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const median = scores[Math.floor(scores.length / 2)]!;
  const perfect = games.filter((g) => g.result!.score === 25).length / games.length;
  const misfire = games.filter((g) => g.result!.reason === "misfire").length / games.length;
  const progress = games.reduce((a, g) => a + g.result!.progress, 0) / games.length;
  console.log(`${label.padEnd(18)} 平均 ${avg.toFixed(2).padStart(5)}  中位 ${String(median).padStart(2)}  25分 ${(perfect * 100).toFixed(1).padStart(4)}%  失误0分 ${(misfire * 100).toFixed(1).padStart(4)}%  平均进度 ${progress.toFixed(2)}`);
  return avg;
}

const times: number[] = [];
for (const n of [2, 3, 4, 5]) {
  console.log(`--- ${n} 人 ${GAMES} 局${MASTER ? "（大师模式）" : ""} ---`);
  const seeds = Array.from({ length: GAMES }, (_, i) => 1000 * n + i);
  summarize("人机自对弈", seeds.map((s) => run(n, () => "bot", s, times)));
  summarize("基线自对弈", seeds.map((s) => run(n, () => "baseline", s, [])));
  summarize("随机", seeds.map((s) => run(n, () => "random", s, [])));
  summarize("混搭 1基线+人机", seeds.map((s) => run(n, (seat) => (seat === s % n ? "baseline" : "bot"), s, times)));
}
times.sort((a, b) => a - b);
console.log(`人机决策 ${times.length} 步：平均 ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2)} ms，p99 ${times[Math.floor(times.length * 0.99)]!.toFixed(2)} ms，最慢 ${times.at(-1)!.toFixed(2)} ms`);
