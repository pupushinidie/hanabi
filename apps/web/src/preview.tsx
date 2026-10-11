/**
 * 预览页（不连服务器）：用预览局面工厂造出各种界面状态，渲染真正的 GameBoard / 等候房间。
 *   preview.html?s=<场景>        场景名见下面 SCENES（也可以用 packages/game 的 SCENE_NAMES）
 *   &theme=day                   白天版（也可以用全站的 gm-pixel-theme）
 * 截图脚本见 scripts/shoot-scenes.sh。
 */
import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import {
  applyCommand,
  redactGameForViewer,
  scene,
  SCENE_NAMES,
  DEFAULT_ROOM_ACCESS,
  type GameCommand,
  type GameState,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type SceneName,
} from "@hanabi/game";
import GameBoard from "./GameBoard.js";
import RoomChat from "./RoomChat.js";
import GameRules from "./GameRules.js";
import { RoomView } from "./App.js";
import { applyTheme, readTheme, ThemeToggle } from "./theme.js";
import { useVoice } from "./voice.js";
import "./styles.css";
import "./app-pixel.css";
import "./hanabi.css";
import "./theme-day.css";

const params = new URLSearchParams(location.search);
const requested = params.get("s") ?? "myTurn";
const name = [...SCENE_NAMES, "offline", "auto", "bots", "timeout", "spectate", "spectateAll", "waiting1", "waitingFull", "waitingBots"].includes(requested as SceneName) ? requested : "myTurn";
const theme = params.get("theme") === "day" ? "day" : params.get("theme") === "night" ? "night" : readTheme();
applyTheme(theme);

/** 额外的房间级场景：基于某个局面改成员状态。 */
const EXTRA: Record<string, { base: SceneName; tweak?: (members: LobbyMember[]) => LobbyMember[]; spectate?: boolean; remainingMs?: number; seeAll?: boolean }> = {
  offline: { base: "myTurn", tweak: (m) => m.map((x) => (x.playerId === "p2" ? { ...x, connected: false } : x)) },
  auto: { base: "theirTurn", tweak: (m) => m.map((x) => (x.playerId === "p1" ? { ...x, auto: true } : x)) },
  bots: { base: "start5", tweak: (m) => m.map((x, i) => (i > 0 ? { ...x, bot: true, name: ["咕噜一号", "咕噜二号", "咕噜三号", "咕噜四号"][i - 1]! } : x)) },
  timeout: { base: "myTurn", remainingMs: 8000 },
  spectate: { base: "myTurn", spectate: true },
  spectateAll: { base: "myTurn", spectate: true, seeAll: true },
};
const WAITING = ["waiting1", "waitingFull", "waitingBots"] as const;
export const SCENES = [...SCENE_NAMES, ...Object.keys(EXTRA), ...WAITING];

const NAMES = ["甲", "乙", "丙", "丁", "戊"];

function membersFor(game: GameState): LobbyMember[] {
  return game.players.map((p, i) => ({ id: i === 0 ? "me" : `s${i}`, playerId: p.id, name: p.name, isHost: i === 0, connected: true }));
}

function buildRoom(game: GameState, extra?: (typeof EXTRA)[string]): LobbyRoomSnapshot {
  let members = membersFor(game);
  if (extra?.tweak) members = extra.tweak(members);
  const viewer = extra?.spectate ? "" : "p1";
  const view = redactGameForViewer(game, viewer, { seeAll: extra?.seeAll ?? false });
  for (const m of members) {
    const player = view.players.find((p) => p.id === m.playerId);
    if (player) (player as { name: string }).name = m.name;
  }
  const finished = game.phase === "finished";
  return {
    code: "HNB7K2",
    spectators: extra?.spectate ? [{ id: "me", name: "看客" }] : [],
    access: { ...DEFAULT_ROOM_ACCESS, spectatorsSeeAll: extra?.seeAll ?? false },
    capacity: game.players.length as LobbyRoomSnapshot["capacity"],
    options: { masterMode: game.config.masterMode },
    best: finished ? { score: Math.max(18, game.result?.score ?? 0), games: 3 } : { games: 0 },
    status: "playing",
    members: extra?.spectate ? members.map((m) => (m.id === "me" ? { ...m, id: "x0" } : m)) : members,
    chat: finished ? [] : [{ id: "c1", senderId: "s1", name: "乙", message: "好", createdAt: new Date().toISOString() }],
    voice: [],
    game: view,
    ...(finished ? { rematch: { remainingMs: 52_000, acceptedIds: ["s1"] } } : { turnRemainingMs: extra?.remainingMs ?? 74_000 }),
  };
}

function waitingRoom(kind: (typeof WAITING)[number]): LobbyRoomSnapshot {
  const count = kind === "waiting1" ? 1 : 4;
  const members: LobbyMember[] = Array.from({ length: count }, (_, i) => ({
    id: i === 0 ? "me" : `s${i}`,
    playerId: `p${i + 1}`,
    name: kind === "waitingBots" && i > 0 ? ["咕噜一号", "咕噜二号", "咕噜三号"][i - 1]! : NAMES[i]!,
    isHost: i === 0,
    connected: true,
    ...(kind === "waitingBots" && i > 0 ? { bot: true } : {}),
  }));
  return {
    code: "HNB7K2",
    spectators: [],
    access: { ...DEFAULT_ROOM_ACCESS },
    capacity: kind === "waitingFull" ? 4 : 5,
    options: { masterMode: kind === "waitingBots" },
    best: kind === "waitingFull" ? { score: 19, games: 2 } : { games: 0 },
    status: "waiting",
    members,
    chat: [{ id: "c1", senderId: "s1", name: "乙", message: "等我一下，马上来", createdAt: new Date().toISOString() }],
    voice: [],
  };
}

// 预览页冒充自己的连接 id
import { socket } from "./socket.js";
Object.defineProperty(socket, "id", { get: () => "me" });

function Preview() {
  const [state, setState] = useState<GameState>(() => scene((EXTRA[name]?.base ?? name) as SceneName));
  const [themeNow, setThemeNow] = useState(theme);
  const room = (WAITING as readonly string[]).includes(name) ? waitingRoom(name as (typeof WAITING)[number]) : buildRoom(state, EXTRA[name]);
  const voice = useVoice(room);
  const toggle = <ThemeToggle theme={themeNow} onToggle={() => { const t = themeNow === "day" ? "night" : "day"; applyTheme(t); setThemeNow(t); }} />;
  const brand = <a className="brand" href="#"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span className="brand-name">花火<span> 合作烟火</span></span></a>;
  const connection = <div className="connection-status online"><span className="connection-dot" /><span>已连接</span></div>;
  if (room.status === "waiting") {
    return (
      <main className="app-shell hb-waitpage">
        <header className="topbar">{brand}<div className="topbar-right">{toggle}{connection}</div></header>
        <div className="hb-wait">
          <RoomView room={room} busy={false} error="" notice="" onCopyCode={() => {}} onLeave={() => {}} onStart={() => {}} onKick={() => {}} onAddBot={() => {}} onDissolve={() => {}} />
          <div className="hb-wait-side">
            <GameRules />
            <RoomChat room={room} voice={voice} />
          </div>
        </div>
      </main>
    );
  }
  // 在预览页里直接跑引擎：点按钮能看到下一步
  const onCommand = (command: GameCommand) => {
    try {
      setState((s) => applyCommand(s, s.players[s.currentPlayer]!.id === "p1" || command.type === "REORDER" ? "p1" : s.players[s.currentPlayer]!.id, command));
    } catch (error) {
      console.warn(error);
    }
  };
  return (
    <main className="app-shell hb-game">
      <GameBoard
        room={room}
        busy={false}
        error=""
        notice=""
        brand={brand}
        connection={connection}
        themeToggle={toggle}
        theme={themeNow === "day" ? "day" : "night"}
        chat={<RoomChat room={room} voice={voice} />}
        onCommand={onCommand}
        onRematch={() => {}}
        onAuto={() => {}}
        onDissolve={() => {}}
        watchId="p1"
        onWatch={() => {}}
        onLeave={() => {}}
        selfSeat={EXTRA[name]?.spectate ? undefined as never : "p1"}
        mode={params.get("mode") === "practice" ? "practice" : "online"}
      />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><Preview /></React.StrictMode>);
