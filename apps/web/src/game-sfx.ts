import { useEffect, useRef } from "react";
import { MAX_SCORE, type GameEvent, type GameState } from "@hanabi/game";
import { sfx, synth } from "./gm-sound.js";

/**
 * 花火的动作音效。gm-sound.tsx 是全站共用的音效库，这里只管「什么时候响哪个」。
 *
 * 看每个新快照里引擎的 events（一个动作一个快照）：
 * - Clued 给提示：招牌「风铃」（颜色提示高一点、数字提示低一点）；提示到自己头上再加一声揭晓；提示标记用完再响一声低的「空了」。
 * - Played 打出：拍牌声；接上了 → 招牌「烟花」（哨声上天 + 炸开 + 噼啪）+ 得分；打出 5 放满一种颜色 → 大烟花 + sparkle，拿回标记再响「叮」。
 *   打错 → 招牌「哑炮」（引信嘶嘶 + 闷响）+ bust；第 2 次打错多一下警报；第 3 次打错直接 boom。
 * - Discarded 弃牌：pass + 拿回提示标记的「叮」。
 * - Drew 摸牌：轻轻一擦。FinalRound 牌堆摸完：引信点着的嘶声 + roundStart。
 * - Reordered 整理手牌：很轻的擦牌声。TurnSkipped（大师模式没得行动）：pass。TurnTimedOut：自己超时响 timeout。
 * - GameEnded：合作游戏全队一起赢或输——普通模式没炸且 ≥16 分（评价「精彩」及以上）算赢，大师模式打满 25 才算赢；
 *   25 分再放一串礼花。
 * - 轮到自己：动作声响完后 yourTurn。
 *
 * 第一次拿到对局（进房间、重连、观战刚进来）不响；版本一下跳了好几步（重连、切回标签页）不补放；
 * 再来一局 / 教程重开（版本变小）只响洗牌发牌。自己的动作 mine=true，别人的减半；观战时都算别人的。
 */

/** 普通模式里算「赢」的分数门槛（评价「精彩」16–20 起）。 */
export const WIN_SCORE = 16;

declare global {
  interface Window {
    /** 开发时自测脚本用：记下响过的音效名字。 */
    __sfxLog?: string[];
  }
}

function log(name: string) {
  if (import.meta.env.DEV) window.__sfxLog?.push(name);
}

const { tone, noise, level, jitter } = synth;

/** 自测记录里把别人的动作标上「·他」。 */
function tag(name: string, mine: boolean) {
  return mine ? name : `${name}·他`;
}

function at(ms: number, name: string, fn: () => void) {
  const run = () => {
    fn();
    log(name);
  };
  if (ms <= 0) run();
  else window.setTimeout(run, ms);
}

// ---------- 招牌声音 ----------

/** 给提示：两三声风铃。颜色提示高一点，数字提示低一点。 */
function clueChime(mine: boolean, kind: "color" | "rank") {
  const v = level(mine);
  const base = (kind === "color" ? 1319 : 988) * jitter(0.02);
  [1, 1.5, 2].forEach((ratio, i) => {
    tone(base * ratio, { at: i * 0.07, duration: 0.45, volume: 0.09 * v, type: "triangle" });
    tone(base * ratio * 2.01, { at: i * 0.07, duration: 0.2, volume: 0.025 * v });
  });
}

/** 烟花：哨声上天 + 炸开 + 噼啪。big = 放满一种颜色的大烟花。 */
function firework(mine: boolean, big = false, delay = 0) {
  const v = level(mine) * (big ? 1.15 : 1);
  const t = delay;
  const p = jitter(0.06);
  const rise = big ? 0.42 : 0.32;
  tone(700 * p, { at: t, duration: rise, volume: 0.06 * v, glideTo: 2300 * p });
  noise({ at: t, duration: rise, volume: 0.07 * v, freq: 1500, freqTo: 4200, q: 3 });
  noise({ at: t + rise, duration: big ? 0.5 : 0.32, volume: 0.32 * v, filter: "lowpass", freq: 2200, freqTo: 200 });
  tone(90, { at: t + rise, duration: 0.3, volume: 0.2 * v, glideTo: 45 });
  const crackles = big ? 12 : 6;
  for (let i = 0; i < crackles; i += 1) {
    noise({ at: t + rise + 0.12 + i * 0.045 + Math.random() * 0.04, duration: 0.02, volume: 0.12 * v, filter: "highpass", freq: 3500 + Math.random() * 2500 });
  }
}

/** 打错：引信嘶嘶，然后一声哑火的闷响。 */
function fizzle(mine: boolean) {
  const v = level(mine);
  noise({ duration: 0.45, volume: 0.14 * v, freq: 3200, freqTo: 1100, q: 1.5 });
  noise({ at: 0.45, duration: 0.18, volume: 0.25 * v, filter: "lowpass", freq: 500, freqTo: 120 });
  tone(130, { at: 0.45, duration: 0.2, volume: 0.16 * v, type: "triangle", glideTo: 70 });
}

/** 拿回一个提示标记：小小的「叮」。 */
function tokenBack(mine: boolean) {
  const v = level(mine);
  tone(1568, { duration: 0.12, volume: 0.11 * v, type: "triangle" });
  tone(2349, { at: 0.07, duration: 0.25, volume: 0.09 * v, type: "triangle" });
}

/** 提示标记用完了：两声往下走的低音。 */
function tokensEmpty() {
  tone(523, { duration: 0.16, volume: 0.12, type: "triangle" });
  tone(392, { at: 0.15, duration: 0.3, volume: 0.12, type: "triangle", glideTo: 370 });
}

/** 已经打错 2 次：心跳一样的两下低音警报。 */
function danger() {
  [0, 0.2].forEach((t) => tone(98, { at: t, duration: 0.14, volume: 0.25, type: "triangle" }));
  tone(587, { at: 0.42, duration: 0.18, volume: 0.06, type: "square" });
}

/** 最后一轮：引信点着的嘶声。 */
function fuseLit() {
  noise({ duration: 0.7, volume: 0.1, freq: 2600, freqTo: 4200, q: 1.2 });
  for (let i = 0; i < 5; i += 1) noise({ at: 0.05 + i * 0.12, duration: 0.02, volume: 0.1, filter: "highpass", freq: 4000 });
}

/** 选中自己的一张牌 / 队友的一张牌（给提示前）。 */
export function pickSound(on: boolean) {
  sfx.select(on);
  log(on ? "select" : "unselect");
}

/** 不能点（不是自己的回合、提示标记用完了）。 */
export function denySound() {
  sfx.deny();
  log("deny");
}

// ---------- 对局状态 → 声音 ----------

interface Options {
  readonly game: GameState;
  /** 自己的玩家 id；观战时传空字符串（全都算别人的）。 */
  readonly selfId: string;
  /** 自己在托管中（轮到自己时不响「轮到你」）。 */
  readonly autoPlaying: boolean;
}

function wonOf(game: GameState): boolean {
  const result = game.result;
  if (!result || !result.won) return false;
  return game.config.masterMode ? result.score >= MAX_SCORE : result.score >= WIN_SCORE;
}

export function useGameSfx({ game, selfId, autoPlaying }: Options) {
  const prev = useRef<GameState | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = game;
    const myFirstTurn = () => game.phase === "playing" && game.history.length === 0 && !autoPlaying && selfId !== "" && game.players[game.currentPlayer]?.id === selfId;
    // 第一次拿到对局不补放；只有刚开局、而且自己先手时提醒一声（跟在房间的开局声后面）。
    if (!before) {
      if (myFirstTurn()) at(900, "yourTurn", () => sfx.yourTurn());
      return;
    }
    if (game.version === before.version) return;
    // 再来一局 / 教程重开：版本变小，只响洗牌发牌（自己先手再加「轮到你」）。
    if (game.version < before.version) {
      at(100, "shuffle", () => sfx.shuffle());
      at(500, "deal", () => sfx.deal(game.players.length * game.config.handSize));
      if (myFirstTurn()) at(1400, "yourTurn", () => sfx.yourTurn());
      return;
    }
    // 一下跳了好几步：不补放。
    if (game.version - before.version > 2) return;
    const mineOf = (id: string) => selfId !== "" && id === selfId;
    const events = game.events;
    let t = 0;
    let acted = false;
    let ended: Extract<GameEvent, { type: "GameEnded" }> | null = null;
    for (const event of events) {
      switch (event.type) {
        case "TurnTimedOut":
          if (mineOf(event.player)) at(0, "timeout", () => sfx.timeout());
          t = Math.max(t, mineOf(event.player) ? 380 : 0);
          break;
        case "Clued": {
          const mine = mineOf(event.player);
          acted = true;
          at(t, tag("clue", mine), () => clueChime(mine, event.kind));
          if (selfId !== "" && event.target === selfId) at(t + 260, "reveal", () => sfx.reveal(true));
          if (game.clueTokens === 0) at(t + 650, "tokensEmpty", tokensEmpty);
          t += 500;
          break;
        }
        case "Played": {
          const mine = mineOf(event.player);
          acted = true;
          at(t, tag("card", mine), () => sfx.card(mine));
          if (event.success) {
            const big = event.rank === 5;
            at(t + 120, tag(big ? "firework5" : "firework", mine), () => firework(mine, big));
            at(t + 560, tag("score", mine), () => sfx.score(mine, big));
            if (big) {
              at(t + 750, tag("firework", mine), () => firework(mine, false));
              at(t + 900, tag("sparkle", mine), () => sfx.sparkle(mine));
              if (event.bonus) at(t + 1250, tag("tokenBack", mine), () => tokenBack(mine));
            }
            t += big ? 1300 : 750;
          } else if (game.misfires >= 3) {
            at(t + 150, "boom", () => sfx.boom(true));
            t += 900;
          } else {
            at(t + 120, tag("fizzle", mine), () => fizzle(mine));
            at(t + 700, tag("bust", mine), () => sfx.bust(mine));
            if (game.misfires === 2) at(t + 1150, "danger", danger);
            t += game.misfires === 2 ? 1500 : 1100;
          }
          break;
        }
        case "Discarded": {
          const mine = mineOf(event.player);
          acted = true;
          at(t, tag("pass", mine), () => sfx.pass(mine));
          at(t + 220, tag("tokenBack", mine), () => tokenBack(mine));
          t += 500;
          break;
        }
        case "Drew": {
          const mine = mineOf(event.player);
          at(t, tag("draw", mine), () => sfx.draw(mine));
          t += 200;
          break;
        }
        case "FinalRound":
          at(t + 100, "finalRound", () => {
            fuseLit();
            sfx.roundStart();
          });
          t += 900;
          break;
        case "Reordered":
          // 整理手牌不算一回合：自己整理时按钮已经响了一声轻点，这里再加一下很轻的擦牌声；别人整理不响
          if (mineOf(event.player)) at(t, "reorder", () => sfx.draw(false));
          break;
        case "TurnSkipped": {
          const mine = mineOf(event.player);
          acted = true;
          at(t, tag("skip", mine), () => sfx.pass(mine));
          t += 300;
          break;
        }
        case "GameEnded":
          ended = event;
          break;
      }
    }
    if (ended) {
      const won = wonOf(game);
      at(t + 300, won ? "gameOver:won" : "gameOver:lost", () => sfx.gameOver(won));
      if (ended.result.score === MAX_SCORE) {
        for (let k = 0; k < 4; k += 1) at(t + 900 + k * 380, "firework", () => firework(true, k === 3));
      }
      return;
    }
    if (acted && game.phase === "playing" && !autoPlaying && selfId !== "" && game.players[game.currentPlayer]?.id === selfId) {
      at(t + 150, "yourTurn", () => sfx.yourTurn());
    }
  }, [game.version]);
}

