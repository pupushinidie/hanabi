import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  clueTouches,
  COLORS,
  MAX_CLUES,
  scoreOf,
  type ClueCommand,
  type Color,
  type GameCommand,
  type GameState,
  type HandCard,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type Player,
  type Rank,
} from "@hanabi/game";
import { art, COLOR_UI, rating } from "./art.js";
import { useConfirm } from "./confirm.js";
import { denySound, pickSound, useGameSfx } from "./game-sfx.js";
import GameRules from "./GameRules.js";
import { useSfxCountdown } from "./gm-sound.js";
import { FaceCard, faceText, HiddenCard, MiniCard, Sprite } from "./hanabi/cards.js";
import { pickLayout, labelH, type BoardLayout } from "./hanabi/layout.js";
import { clueValueText, describe } from "./hanabi/log.js";
import { GameRoomMenu, SpectateBar } from "./RoomExtras.js";
import { socket } from "./socket.js";
import { Coach, TipToast } from "./tutorial/Coach.js";
import { useFirstTimeTips } from "./tutorial/tips.js";
import { detectTips, GAME_ID, hintFor, TIPS, type Hint } from "./tutorialGame.js";

export interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  /** 顶栏的白天 / 夜间切换按钮。 */
  readonly themeToggle: ReactNode;
  readonly theme: "day" | "night";
  readonly chat: ReactNode;
  readonly onCommand: (command: GameCommand) => void;
  readonly onRematch: (accept: boolean) => void;
  /** 打开 / 取消自己的托管。 */
  readonly onAuto: (enabled: boolean) => void;
  readonly onDissolve: () => void;
  /** 观战时从这位玩家的座位看。 */
  readonly watchId: string;
  readonly onWatch: (playerId: string) => void;
  /** 观战的人离开。 */
  readonly onLeave: () => void;
  /** 自己的座位 id（预览页和教程用；联机时按 socket.id 找）。 */
  readonly selfSeat?: string;
  /** online：真实对局；tutorial：剧本进行中（不弹确认框、不出提示和小贴士）；practice：练习局（随时能看提示）。 */
  readonly mode?: "online" | "tutorial" | "practice";
  /** 结算框里替代「再来一局」的按钮（练习局放「结束教程」「再练一局」）。 */
  readonly finalActions?: ReactNode;
  /** 教程用：界面上选中了什么（教程据此把高亮从牌挪到按钮上）。 */
  readonly onUiState?: (ui: UiState) => void;
}

export type UiState = { readonly kind: "none" } | { readonly kind: "mine"; readonly cardId: number } | { readonly kind: "mate"; readonly cardId: number } | { readonly kind: "clue" };

type Selection = { readonly kind: "mine"; readonly id: number } | { readonly kind: "mate"; readonly player: string; readonly id: number } | null;
type Effect =
  | { readonly id: string; readonly kind: "burst"; readonly color: Color; readonly delay: number; readonly offset: number }
  | { readonly id: string; readonly kind: "misfire"; readonly color: Color }
  | { readonly id: string; readonly kind: "banner"; readonly text: string; readonly tone: "turn" | "good" | "bad" | "info" };

function useCountdown(room: LobbyRoomSnapshot): number | null {
  const [now, setNow] = useState(Date.now());
  const [anchor, setAnchor] = useState({ at: Date.now(), ms: room.turnRemainingMs });
  useEffect(() => setAnchor({ at: Date.now(), ms: room.turnRemainingMs }), [room]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  if (anchor.ms === undefined) return null;
  return Math.max(0, Math.ceil((anchor.ms - (now - anchor.at)) / 1000));
}

/**
 * 量牌桌区域的宽高，挑牌的倍数。估算的高度和实际排出来的可能差一点：
 * 排完以后量一下牌桌内容有没有超出，超出就把可用高度减掉超出的部分再挑一次（只往小里调，换尺寸时重置）。
 */
function useBoardLayout(game: GameState, myId: string): [React.RefObject<HTMLElement | null>, React.RefObject<HTMLDivElement | null>, BoardLayout, { w: number; h: number }] {
  const ref = useRef<HTMLElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 1100, h: 700 });
  const [shrink, setShrink] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      setSize((old) => {
        const next = { w: Math.floor(element.clientWidth), h: Math.floor(element.clientHeight) };
        if (old.w !== next.w || old.h !== next.h) setShrink(0);
        return next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const mates = game.players.filter((p) => p.id !== myId).map((p) => Math.max(p.hand.length, game.config.handSize));
  const layout = pickLayout(size.w, size.h - shrink, mates, game.config.handSize);
  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board || layout.mobile) return;
    const over = board.scrollHeight - board.clientHeight;
    if (over > 1 && shrink < size.h) setShrink((value) => value + over + 8);
  });
  return [ref, boardRef, layout, size];
}

/** 背景：按 cover 摆好场景图，夜间叠灯笼闪烁（和背景同一个缩放容器，坐标对齐）。 */
function Scene({ theme, w, h }: { theme: "day" | "night"; w: number; h: number }) {
  const k = Math.max(w / 512, h / 288);
  const style: CSSProperties = { width: 512 * k, height: 288 * k, left: (w - 512 * k) / 2, top: (h - 288 * k) / 2 };
  return (
    <div className="hb-scene" aria-hidden="true">
      <div className="hb-scene-img" style={{ ...style, backgroundImage: `url(${theme === "day" ? art.bgDay : art.bgNight})` }}>
        {theme === "night" && <i className="hb-lanterns" style={{ backgroundImage: `url(${art.lanterns})` }} />}
      </div>
      <div className={`hb-scene-veil ${theme}`} />
    </div>
  );
}

function GameBoard(props: GameBoardProps) {
  const { room, busy, error, notice, brand, connection, themeToggle, theme, chat, onCommand, onRematch, onAuto, onDissolve, watchId, onWatch, onLeave, selfSeat, mode = "online", finalActions, onUiState } = props;
  const game = room.game!;
  const member = selfSeat ? room.members.find((m) => m.playerId === selfSeat) : room.members.find((candidate) => candidate.id === socket.id);
  // 观战的人没有座位：牌桌按 watchId 那位玩家的座位摆，但什么都不能点，也不叫「你」。
  const spectating = !member;
  const myId = member?.playerId ?? watchId;
  const selfId = spectating ? "" : myId;
  const isHost = member?.isHost ?? false;
  const current = game.players[game.currentPlayer]!;
  const playing = game.phase === "playing";
  const myTurn = !spectating && playing && current.id === myId;
  const autoPlaying = member?.auto === true;
  const secondsLeft = useCountdown(room);
  const memberOf = (playerId: string) => room.members.find((candidate) => candidate.playerId === playerId);
  const me = game.players.find((p) => p.id === myId)!;
  const myIndex = game.players.findIndex((p) => p.id === myId);
  const mates = game.players.map((_, k) => game.players[(myIndex + 1 + k) % game.players.length]!).filter((p) => p.id !== myId);
  const [stageRef, boardRef, layout, stageSize] = useBoardLayout(game, myId);
  // 声音：每个动作的音效（game-sfx.ts）+ 自己回合最后 5 秒的倒计时
  useGameSfx({ game, selfId, autoPlaying });
  useSfxCountdown(myTurn && !autoPlaying, secondsLeft);
  const [confirm, confirmDialog] = useConfirm();

  const [selection, setSelection] = useState<Selection>(null);
  const [clue, setClue] = useState<ClueCommand | null>(null);
  const [effects, setEffects] = useState<Effect[]>([]);
  const [flash, setFlash] = useState<Record<number, string>>({});
  const [sideOpen, setSideOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(true);
  const timers = useRef(new Set<number>());
  const seenVersion = useRef(game.version);
  const firstVersion = useRef(game.version);
  const shownNotice = game.version === firstVersion.current ? notice : "";

  // 临时特效：持久的计时器表，只在卸载时清空（不要在 version 变化时取消）
  const later = useCallback((ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);
  const addEffect = useCallback((effect: Effect, ms: number) => {
    setEffects((list) => [...list, effect]);
    later(ms, () => setEffects((list) => list.filter((e) => e.id !== effect.id)));
  }, [later]);

  useEffect(() => {
    if (game.version === seenVersion.current) return;
    const restarted = game.version < seenVersion.current;
    seenVersion.current = game.version;
    if (restarted) setResultOpen(true);
    if (!game.events.every((e) => e.type === "Reordered")) {
      setSelection((sel) => (sel?.kind === "mine" && me.hand.some((c) => c.id === sel.id) ? sel : null));
      setClue(null);
    }
    const key = String(game.version);
    for (const [index, event] of game.events.entries()) {
      const id = `${key}-${index}`;
      if (event.type === "Played") {
        if (event.success) {
          const count = event.rank === 5 ? 3 : 1;
          for (let k = 0; k < count; k += 1) addEffect({ id: `${id}-${k}`, kind: "burst", color: event.color, delay: k * 0.35, offset: (k - 1) * 24 }, 1800 + k * 350);
          if (event.rank === 5) addEffect({ id: `${id}-b`, kind: "banner", text: `${COLOR_UI[event.color].name}色烟火完成！${event.bonus ? "拿回 1 个提示标记" : ""}`, tone: "good" }, 2600);
        } else {
          addEffect({ id, kind: "misfire", color: event.color }, 1000);
          addEffect({ id: `${id}-b`, kind: "banner", text: `打错了！失误 ${game.misfires}/3${game.misfires === 2 ? "，再错一次全队 0 分" : ""}`, tone: "bad" }, 2600);
        }
      } else if (event.type === "Clued") {
        setFlash((map) => {
          const next = { ...map };
          for (const cardId of event.cardIds) next[cardId] = id;
          return next;
        });
        later(600, () => setFlash((map) => Object.fromEntries(Object.entries(map).filter(([, v]) => v !== id))));
      } else if (event.type === "FinalRound") {
        addEffect({ id, kind: "banner", text: "牌堆摸完了！每人再行动一次", tone: "info" }, 3000);
      }
    }
    const turnChanged = game.events.some((e) => e.type !== "Reordered");
    if (turnChanged && playing && game.players[game.currentPlayer]!.id === selfId && !autoPlaying && !game.events.some((e) => e.type === "Played" || e.type === "FinalRound")) {
      addEffect({ id: `${key}-turn`, kind: "banner", text: "轮到你了", tone: "turn" }, 1800);
    }
  }, [game.version]);

  // 轮到自己而页面在后台时，标签页标题提醒一下
  useEffect(() => {
    const base = document.title.replace(/^【轮到你】/, "");
    const update = () => { document.title = myTurn && document.hidden ? `【轮到你】${base}` : base; };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      document.title = base;
    };
  }, [myTurn]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelection(null);
        setClue(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const permitted = (_command: GameCommand) => true;
  const send = (command: GameCommand) => {
    if (command.type !== "REORDER") setSelection(null);
    setClue(null);
    onCommand(command);
  };

  // ---------- 给提示 ----------
  const mateSelected = selection?.kind === "mate" ? game.players.find((p) => p.id === selection.player) : undefined;
  const selectedFace = selection?.kind === "mate" ? game.cards[selection.id] : undefined;
  const preview = new Set(clue ? clueTouches(game, game.players.find((p) => p.id === clue.target)!.hand, clue.kind, clue.value) : []);
  const canClue = myTurn && game.clueTokens > 0 && !autoPlaying;
  function pickMateCard(player: Player, card: HandCard) {
    if (!canClue || busy) return;
    if (selection?.kind === "mate" && selection.id === card.id) {
      pickSound(false);
      setSelection(null);
      setClue(null);
      return;
    }
    pickSound(true);
    setSelection({ kind: "mate", player: player.id, id: card.id });
    setClue(null);
  }
  function chooseClue(kind: "color" | "rank") {
    if (!mateSelected || !selectedFace) return;
    const command: ClueCommand = kind === "color"
      ? { type: "CLUE", target: mateSelected.id, kind: "color", value: selectedFace.color }
      : { type: "CLUE", target: mateSelected.id, kind: "rank", value: selectedFace.rank };
    setClue(command);
  }

  // ---------- 出牌 / 弃牌 / 整理 ----------
  const myCard = selection?.kind === "mine" ? me.hand.find((c) => c.id === selection.id) : undefined;
  function pickMyCard(card: HandCard) {
    if (spectating || !playing) return;
    const off = selection?.kind === "mine" && selection.id === card.id;
    pickSound(!off);
    setClue(null);
    setSelection(off ? null : { kind: "mine", id: card.id });
  }
  async function playOrDiscard(type: "PLAY" | "DISCARD") {
    if (!myCard || !myTurn) return;
    const position = me.hand.findIndex((c) => c.id === myCard.id) + 1;
    // 教程剧本里不弹确认框（咕噜嘎已经讲过这一步）
    const ok = mode === "tutorial" ? true : type === "PLAY"
      ? await confirm({
          title: `打出左数第 ${position} 张？`,
          detail: game.misfires === 2
            ? "已经打错 2 次了：这张要是接不上，全队立即失败、记 0 分。"
            : "接得上就放上烟火；接不上算打错，用掉 1 个失误标记（3 个用完全队 0 分）。",
          confirmLabel: "打出",
        })
      : await confirm({
          title: `弃掉左数第 ${position} 张？`,
          detail: "弃掉的牌大家都看得到，拿回 1 个提示标记，再摸 1 张。",
          confirmLabel: "弃掉",
        });
    if (ok) send({ type, cardId: myCard.id });
  }
  function move(delta: number) {
    if (!myCard) return;
    const order = me.hand.map((c) => c.id);
    const index = order.indexOf(myCard.id);
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target]!, order[index]!];
    send({ type: "REORDER", order });
  }

  // 教程：报告界面上选中了什么
  useEffect(() => {
    if (!onUiState) return;
    if (clue) onUiState({ kind: "clue" });
    else if (selection?.kind === "mate") onUiState({ kind: "mate", cardId: selection.id });
    else if (selection?.kind === "mine") onUiState({ kind: "mine", cardId: selection.id });
    else onUiState({ kind: "none" });
  }, [selection, clue]);

  // ---------- 「提示」：只有自己和人机时（练习局、一个人加人机的房间） ----------
  const botsOnly = room.members.every((m) => m.playerId === myId || m.bot);
  const canHint = !spectating && !autoPlaying && myTurn && (mode === "practice" || (mode === "online" && botsOnly));
  const [hint, setHint] = useState<{ version: number; hint: Hint } | null>(null);
  const shownHint = hint && hint.version === game.version && canHint ? hint.hint : null;
  const toggleHint = () => setHint((current) => (current && current.version === game.version ? null : { version: game.version, hint: hintFor(game, myId) }));
  useEffect(() => {
    if (!canHint) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.key.toLowerCase() === "h") toggleHint();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canHint, game.version]);
  const tips = useFirstTimeTips(GAME_ID, game.version, () => detectTips(game, myId), TIPS, mode === "online" && !spectating);
  const helper = canHint ? (
    <button className={shownHint ? "quiet-button hb-hintbtn on" : "quiet-button hb-hintbtn"} type="button" data-tutorial="hint" onClick={toggleHint}>
      提示 <kbd>H</kbd>
    </button>
  ) : null;

  // ---------- 文案 ----------
  const lastEntry = game.history.at(-1);
  let prompt: string;
  if (!playing) prompt = "对局结束";
  else if (spectating) prompt = `观战 · 轮到 ${current.name}`;
  else if (autoPlaying) prompt = "托管中";
  else if (myTurn) prompt = "轮到你了";
  else prompt = `轮到 ${current.name}`;

  const score = scoreOf(game);
  const deckLow = game.deckCount <= game.players.length;

  return (
    <div className={["hb-screen", layout.mobile ? "mobile" : "", theme].join(" ")}>
      <header className="hb-topbar">
        {brand}
        <div className="hb-topbar-mid" data-tutorial="prompt">
          <span className={myTurn ? "hb-turn mine" : autoPlaying ? "hb-turn auto" : "hb-turn"}>{prompt}</span>
          {playing && secondsLeft !== null && !autoPlaying && <b className={secondsLeft <= 15 ? "hb-timer low" : "hb-timer"}>{secondsLeft}s</b>}
        </div>
        <div className="hb-topbar-right">
          {themeToggle}
          <GameRules masterMode={game.config.masterMode} />
          <GameRoomMenu room={room} />
          <button className="quiet-button hb-side-toggle" type="button" onClick={() => setSideOpen((v) => !v)} aria-expanded={sideOpen}>{sideOpen ? "收起" : "记录"}</button>
          {spectating && <button className="quiet-button" type="button" onClick={onLeave}>离开观战</button>}
          {isHost && !selfSeat && <button className="quiet-button danger" type="button" onClick={onDissolve}>解散</button>}
          {connection}
        </div>
      </header>

      {spectating && <SpectateBar room={room} watchId={watchId} onWatch={onWatch} onLeave={onLeave} />}

      <div className="hb-main">
        <section className="hb-stage" ref={stageRef as React.RefObject<HTMLElement>}>
          {!layout.mobile && <Scene theme={theme} w={stageSize.w} h={stageSize.h} />}
          <div className="hb-board" ref={boardRef}>
            <div className="hb-mates" style={{ gridTemplateColumns: layout.mobile ? "1fr" : `repeat(${layout.perRow}, max-content)` }} data-tutorial="mates">
              {mates.map((player, index) => (
                <MatePanel
                  key={player.id}
                  player={player}
                  index={index}
                  game={game}
                  layout={layout}
                  member={memberOf(player.id)}
                  active={playing && current.id === player.id}
                  selectedId={selection?.kind === "mate" ? selection.id : undefined}
                  preview={clue?.target === player.id ? preview : undefined}
                  flash={flash}
                  onPick={canClue && !busy ? (card) => pickMateCard(player, card) : undefined}
                  onDeny={!spectating && playing && !autoPlaying ? denySound : undefined}
                />
              ))}
            </div>

            <div className="hb-center">
              <Fireworks game={game} layout={layout} effects={effects} />
              <div className="hb-panel hb-tokens">
                <div className="hb-token-row" data-tutorial="clue-tokens">
                  <span className="hb-token-label">提示</span>
                  <span className="hb-token-list">
                    {Array.from({ length: MAX_CLUES }, (_, k) => (
                      <img key={k} src={k < game.clueTokens ? art.token.clue : art.token.clueUsed} alt="" style={{ width: 32 * layout.token, height: 32 * layout.token }} />
                    ))}
                  </span>
                  <b className="hb-count">{game.clueTokens}/8</b>
                </div>
                <div className="hb-token-row" data-tutorial="misfire-tokens">
                  <span className="hb-token-label">失误</span>
                  <span className="hb-token-list">
                    {[0, 1, 2].map((k) => {
                      const used = k < game.misfires;
                      const src = k === 2 ? (used ? art.token.boom : art.token.boomEmpty) : used ? art.token.miss : art.token.missEmpty;
                      return <img key={k} className={k === 2 && game.misfires === 2 && playing ? "hb-danger" : ""} src={src} alt="" style={{ width: 32 * layout.token, height: 32 * layout.token }} />;
                    })}
                  </span>
                  <b className={game.misfires === 2 ? "hb-count bad" : "hb-count"}>{game.misfires}/3</b>
                </div>
                <div className="hb-token-row hb-deck-row">
                  <span className="hb-deck" data-tutorial="deck">
                    <img src={art.icon.deck} alt="" />
                    <b className={deckLow ? "low" : ""}>{game.deckCount}</b>
                    <span>{game.finalTurn !== null ? "最后一轮" : "张"}</span>
                  </span>
                  <span className="hb-score" data-tutorial="score">得分 <b>{score}</b>{game.config.masterMode && <small>大师</small>}</span>
                </div>
                {lastEntry && <p className="hb-last">上一步：{describe(lastEntry, game, selfId)}</p>}
              </div>
            </div>

            <div className="hb-mine">
              <div className="hb-hand" data-tutorial="my-hand">
                <div className="hb-hand-head">
                  <strong>{spectating ? me.name : "你"}</strong>
                  <span>{spectating ? "的手牌" : "的手牌（看不到牌面）"}</span>
                </div>
                <div className="hb-cards">
                  {me.hand.map((card, k) => {
                    const face = game.cards[card.id];
                    const selected = selection?.kind === "mine" && selection.id === card.id;
                    const common = {
                      scale: layout.mine,
                      lifted: selected,
                      glow: selected,
                      flash: flash[card.id],
                      onClick: spectating || !playing ? undefined : () => pickMyCard(card),
                      tutorial: `my-card-${k}`,
                    };
                    return face ? <FaceCard key={card.id} {...common} face={face} known={card.clues} /> : <HiddenCard key={card.id} {...common} clues={card.clues} />;
                  })}
                  {me.hand.length === 0 && <p className="hb-muted">手里没有牌了。</p>}
                </div>
              </div>
              {!spectating && (
                <ActionPanel
                  game={game}
                  myTurn={myTurn}
                  busy={busy}
                  autoPlaying={autoPlaying}
                  myCard={myCard}
                  myPosition={myCard ? me.hand.findIndex((c) => c.id === myCard.id) : -1}
                  handSize={me.hand.length}
                  mate={mateSelected}
                  face={selectedFace}
                  clue={clue}
                  previewCount={preview.size}
                  error={error}
                  notice={shownNotice}
                  helper={helper}
                  permitted={permitted}
                  onPlay={() => void playOrDiscard("PLAY")}
                  onDiscard={() => void playOrDiscard("DISCARD")}
                  onMove={move}
                  onChooseClue={chooseClue}
                  onSendClue={() => clue && send(clue)}
                  onCancel={() => { setSelection(null); setClue(null); }}
                  onAuto={onAuto}
                />
              )}
            </div>
          </div>
          {effects.filter((e) => e.kind === "banner").slice(-1).map((e) => e.kind === "banner" && (
            <div key={e.id} className={`hb-banner ${e.tone}`} aria-hidden="true">{e.text}</div>
          ))}
        </section>
        <aside className={sideOpen ? "hb-side open" : "hb-side"}>
          <DiscardGrid game={game} />
          <section className="hb-panel hb-log" data-tutorial="log">
            <h3>记录</h3>
            {game.history.length === 0 ? <p className="hb-muted">还没有人行动。</p> : (
              <ol>
                {[...game.history].reverse().slice(0, 40).map((entry, index) => (
                  <li key={`${entry.turn}-${index}`} className={entry.type === "play" ? (entry.success ? "good" : "bad") : ""}>
                    {(entry.type === "play" || entry.type === "discard") && <MiniCard face={entry} scale={1} />}
                    <span>{describe(entry, game, selfId)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <div className="hb-chat">{chat}</div>
          {/* 手机：顶栏放不下的按钮放到最下面 */}
          <div className="hb-mobile-bar">
            <GameRules masterMode={game.config.masterMode} />
            {spectating && <button className="quiet-button" type="button" onClick={onLeave}>离开观战</button>}
            {isHost && !selfSeat && <button className="quiet-button danger" type="button" onClick={onDissolve}>解散房间</button>}
            {connection}
          </div>
        </aside>
      </div>
      {game.phase === "finished" && (resultOpen
        ? <ResultDialog game={game} room={room} spectating={spectating} mobile={layout.mobile} onRematch={onRematch} onLeave={onLeave} onHide={() => setResultOpen(false)} actions={finalActions} />
        : <button className="primary-button hb-result-reopen" type="button" onClick={() => setResultOpen(true)}>看结算</button>)}
      {shownHint && (
        <Coach
          view={{
            key: `hint-${game.version}`,
            say: shownHint.say,
            ...(shownHint.note ? { note: shownHint.note } : {}),
            anchor: shownHint.anchor,
            focus: false,
            face: "think",
            actions: <button className="quiet-button" type="button" onClick={() => setHint(null)}>知道了</button>,
          }}
        />
      )}
      {tips.tip && <TipToast tip={tips.tip} onClose={tips.dismiss} onNever={tips.never} />}
      {confirmDialog}
    </div>
  );
}

function Tags({ member }: { member: LobbyMember | undefined }) {
  const offline = member ? !member.connected : false;
  return (
    <>
      {member?.bot && <small className="hb-tag bot">人机</small>}
      {member && !member.bot && (member.auto || offline) && <small className="hb-tag auto">托管</small>}
      {offline && !member?.bot && <small className="hb-tag off">离线</small>}
    </>
  );
}

function MatePanel({ player, index, game, layout, member, active, selectedId, preview, flash, onPick, onDeny }: {
  player: Player;
  index: number;
  game: GameState;
  layout: BoardLayout;
  member: LobbyMember | undefined;
  active: boolean;
  selectedId: number | undefined;
  preview: Set<number> | undefined;
  flash: Record<number, string>;
  onPick: ((card: HandCard) => void) | undefined;
  /** 现在不能给提示（不是自己的回合、提示标记用完）时点了队友的牌：响一声「不行」（桌面版的牌这时不是按钮）。 */
  onDeny: (() => void) | undefined;
}) {
  const deny = !onPick && onDeny && !layout.mobile
    ? (event: React.MouseEvent) => { if ((event.target as Element).closest(".hb-cardcol")) onDeny(); }
    : undefined;
  return (
    <div className={["hb-panel hb-mate", active ? "active" : "", onPick ? "pickable" : ""].join(" ")} data-tutorial={`mate-${index}`} onClick={deny}>
      <div className="hb-mate-head">
        <strong title={player.name}>{player.name}</strong>
        <span className="hb-tags">
          <Tags member={member} />
          {active && <small className="hb-tag now">行动中</small>}
        </span>
      </div>
      <div className="hb-cards">
        {player.hand.map((card, k) => {
          const face = game.cards[card.id];
          const glow = selectedId === card.id || (preview?.has(card.id) ?? false);
          const click = onPick ? () => onPick(card) : undefined;
          if (layout.mobile) {
            return (
              <button key={card.id} type="button" className={glow ? "hb-minibtn glow" : "hb-minibtn"} onClick={click} disabled={!click} data-tutorial={`mate-${index}-card-${k}`} data-sfx={click ? "none" : undefined}>
                <MiniCard face={face ?? null} scale={2} />
                {(card.clues.color || card.clues.rank) && <i className="hb-known-dot" title="他已经收到过提示" />}
              </button>
            );
          }
          const common = { scale: layout.mate, glow, flash: flash[card.id], onClick: click, tutorial: `mate-${index}-card-${k}`, title: onPick ? "点这张牌给他提示" : "" };
          return face ? <FaceCard key={card.id} {...common} face={face} known={card.clues} /> : <HiddenCard key={card.id} {...common} clues={card.clues} />;
        })}
        {player.hand.length === 0 && <p className="hb-muted">手里没有牌了</p>}
      </div>
    </div>
  );
}

function Fireworks({ game, layout, effects }: { game: GameState; layout: BoardLayout; effects: Effect[] }) {
  if (layout.mobile) {
    return (
      <div className="hb-fireworks mobile" data-tutorial="fireworks">
        {COLORS.map((color) => {
          const top = game.fireworks[color];
          return (
            <span key={color} className="hb-pile">
              {top > 0
                ? <MiniCard face={{ color, rank: top as Rank }} scale={2} />
                : <img className="hb-slot" src={art.slot(color)} alt={`${COLOR_UI[color].name}色还没开始`} style={{ width: 48, height: 72 }} />}
              {effects.map((e) => e.kind === "burst" && e.color === color && (
                <span key={e.id} className="hb-fx">
                  <Sprite className="hb-burst" src={art.burst(color)} frames={16} frameW={96} frameH={96} scale={1} seconds={0.96} style={{ animationDelay: `${e.delay}s`, marginLeft: e.offset }} />
                </span>
              ))}
            </span>
          );
        })}
      </div>
    );
  }
  const f = layout.fw;
  return (
    <div className="hb-fireworks" data-tutorial="fireworks" style={{ width: 360 * f, height: 96 * f + 29 * f + labelH(f) }}>
      <img className="hb-rack" src={art.rack} alt="" style={{ width: 360 * f, height: 49 * f, top: 76 * f }} />
      {COLORS.map((color, k) => {
        const top = game.fireworks[color];
        const done = top === 5;
        return (
          <span key={color} className={done ? "hb-pile done" : "hb-pile"} style={{ left: (36 + 72 * k - 32) * f, width: 64 * f }}>
            {top > 0
              ? <FaceCard face={{ color, rank: top as Rank }} scale={f} glow={done} />
              : <img className="hb-slot" src={art.slot(color)} alt={`${COLOR_UI[color].name}色还没开始`} style={{ width: 64 * f, height: 96 * f }} />}
            {f === 1 && <b className={`hb-pile-label c-${color}`}>{COLOR_UI[color].name}{top}</b>}
            {effects.map((e) => {
              if (e.kind === "burst" && e.color === color) {
                return (
                  <span key={e.id} className="hb-fx" style={{ marginLeft: e.offset * f }}>
                    <Sprite className="hb-launch" src={art.launch} frames={8} frameW={16} frameH={96} scale={f} seconds={0.4} style={{ animationDelay: `${e.delay}s` }} />
                    <Sprite className="hb-burst" src={art.burst(color)} frames={16} frameW={96} frameH={96} scale={f} seconds={0.96} style={{ animationDelay: `${e.delay + 0.35}s` }} />
                  </span>
                );
              }
              if (e.kind === "misfire" && e.color === color) {
                return <span key={e.id} className="hb-fx"><Sprite className="hb-misfire" src={art.misfire} frames={12} frameW={64} frameH={64} scale={f} seconds={0.84} /></span>;
              }
              return null;
            })}
          </span>
        );
      })}
    </div>
  );
}

/** 弃牌一览：5 色 × 5 个数字，每格写弃了几张 / 一共几张；全弃光的标红。 */
function DiscardGrid({ game }: { game: GameState }) {
  const counts = new Map<string, number>();
  for (const id of game.discard) {
    const face = game.cards[id];
    if (face) counts.set(`${face.color}${face.rank}`, (counts.get(`${face.color}${face.rank}`) ?? 0) + 1);
  }
  const totals: Record<number, number> = { 1: 3, 2: 2, 3: 2, 4: 2, 5: 1 };
  return (
    <section className="hb-panel hb-discard" data-tutorial="discard-pile">
      <h3>弃牌一览 <small>共 {game.discard.length} 张 · 格子里是弃了几张/一共几张</small></h3>
      <div className="hb-discard-grid">
        {COLORS.map((color) => [1, 2, 3, 4, 5].map((rank) => {
          const n = counts.get(`${color}${rank}`) ?? 0;
          const gone = n >= totals[rank]!;
          return (
            <span key={`${color}${rank}`} className={gone ? "hb-dcell gone" : n > 0 ? "hb-dcell some" : "hb-dcell"} title={`${COLOR_UI[color].name}${rank}：弃了 ${n} 张，一共 ${totals[rank]} 张`}>
              <MiniCard face={{ color, rank: rank as Rank }} scale={1} dim={n === 0} />
              <small>{n}/{totals[rank]}</small>
            </span>
          );
        }))}
      </div>
    </section>
  );
}

function ActionPanel(props: {
  game: GameState;
  myTurn: boolean;
  busy: boolean;
  autoPlaying: boolean;
  myCard: HandCard | undefined;
  myPosition: number;
  handSize: number;
  mate: Player | undefined;
  face: { color: Color; rank: Rank } | undefined;
  clue: ClueCommand | null;
  previewCount: number;
  error: string;
  notice: string;
  helper: ReactNode;
  permitted: (command: GameCommand) => boolean;
  onPlay: () => void;
  onDiscard: () => void;
  onMove: (delta: number) => void;
  onChooseClue: (kind: "color" | "rank") => void;
  onSendClue: () => void;
  onCancel: () => void;
  onAuto: (enabled: boolean) => void;
}) {
  const { game, myTurn, busy, autoPlaying, myCard, myPosition, handSize, mate, face, clue, previewCount, error, notice, helper, permitted } = props;
  const playing = game.phase === "playing";
  let body: ReactNode;
  if (!playing) {
    body = <p className="hb-hint">对局结束，大家的牌都亮出来了。</p>;
  } else if (autoPlaying) {
    body = (
      <>
        <p className="hb-hint big">托管中</p>
        <p className="hb-hint">人机正在替你行动。</p>
        <button className="primary-button hb-auto-cancel" type="button" onClick={() => props.onAuto(false)} data-tutorial="auto-cancel">取消托管</button>
      </>
    );
  } else if (mate && face) {
    body = clue ? (
      <>
        <p className="hb-hint big">提示{mate.name}：<b className={clue.kind === "color" ? `c-${clue.value}` : ""}>{clueValueText(clue.kind, clue.value)}</b></p>
        <p className="hb-hint">标出他 {previewCount} 张（金框），其余记上「不是{clue.kind === "color" ? COLOR_UI[clue.value as Color].name : clue.value}」</p>
        <div className="hb-buttons">
          <button className="primary-button" type="button" disabled={busy || !permitted(clue)} onClick={props.onSendClue} data-tutorial="clue-send">发出提示</button>
          <button className="quiet-button" type="button" onClick={props.onCancel}>取消</button>
        </div>
      </>
    ) : (
      <>
        <p className="hb-hint big">提示{mate.name}：</p>
        <div className="hb-buttons">
          <button className="hb-act" type="button" onClick={() => props.onChooseClue("color")} data-tutorial="clue-color" data-sfx="select">
            <img src={art.icon.clueColor} alt="" /><span className={`c-${face.color}`}>{COLOR_UI[face.color].name}色</span>
          </button>
          <button className="hb-act" type="button" onClick={() => props.onChooseClue("rank")} data-tutorial="clue-rank" data-sfx="select">
            <img src={art.icon.clueRank} alt="" /><span>数字{face.rank}</span>
          </button>
        </div>
        <button className="quiet-button" type="button" onClick={props.onCancel}>取消</button>
      </>
    );
  } else if (myCard) {
    const canDiscard = myTurn && game.clueTokens < MAX_CLUES;
    body = (
      <>
        <div className="hb-buttons">
          <button className="hb-act" type="button" disabled={!myTurn || busy || !permitted({ type: "PLAY", cardId: myCard.id })} onClick={props.onPlay} data-tutorial="action-play">
            <img src={art.icon.play} alt="" /><span>出牌</span>
          </button>
          <button className="hb-act" type="button" disabled={!canDiscard || busy || !permitted({ type: "DISCARD", cardId: myCard.id })} onClick={props.onDiscard} data-tutorial="action-discard">
            <img src={art.icon.discard} alt="" /><span>弃牌</span>
          </button>
        </div>
        <div className="hb-buttons small">
          <button className="quiet-button" type="button" disabled={myPosition <= 0 || busy} onClick={() => props.onMove(-1)}>◀左移</button>
          <button className="quiet-button" type="button" disabled={myPosition >= handSize - 1 || busy} onClick={() => props.onMove(1)}>右移▶</button>
          <button className="quiet-button" type="button" onClick={props.onCancel}>取消</button>
        </div>
        {myTurn && !canDiscard && <p className="hb-hint">提示标记满 8 个，不能弃牌</p>}
        {!myTurn && <p className="hb-hint">还没轮到你，可以先整理手牌</p>}
      </>
    );
  } else if (myTurn) {
    body = (
      <>
        <p className="hb-hint big">三选一</p>
        <ul className="hb-choices">
          <li className={game.clueTokens > 0 ? "" : "off"}>点队友的牌：给提示{game.clueTokens === 0 ? "（标记用完）" : ""}</li>
          <li>点自己的牌：出牌</li>
          <li className={game.clueTokens < MAX_CLUES ? "" : "off"}>点自己的牌：弃牌{game.clueTokens >= MAX_CLUES ? "（标记满了）" : ""}</li>
        </ul>
      </>
    );
  } else {
    body = <p className="hb-hint">等队友行动。可以点自己的牌整理顺序。</p>;
  }
  return (
    <div className={mate && face && playing && !autoPlaying ? "hb-panel hb-actions sheet" : "hb-panel hb-actions"} data-tutorial="actions">
      {body}
      {helper}
      {(error || notice) && <p className={error ? "hb-feedback error" : "hb-feedback"} role={error ? "alert" : "status"}>{error || notice}</p>}
    </div>
  );
}

function ResultDialog({ game, room, spectating, mobile, onRematch, onLeave, onHide, actions }: {
  actions?: ReactNode | undefined;
  game: GameState;
  room: LobbyRoomSnapshot;
  spectating: boolean;
  mobile: boolean;
  onRematch: (accept: boolean) => void;
  onLeave: () => void;
  onHide: () => void;
}) {
  const result = game.result!;
  const { tier, text } = rating(result.score);
  const finaleTier = result.won ? tier : 0;
  const accepted = room.rematch?.acceptedIds.includes(socket.id ?? "") ?? false;
  const master = game.config.masterMode;
  let reason: string;
  switch (result.reason) {
    case "perfect":
      reason = "五色烟火全部打满！";
      break;
    case "misfire":
      reason = `打错 3 次，全队记 0 分（失败前打到 ${result.progress} 分）`;
      break;
    case "impossible":
      reason = `${result.lostCard ? faceText(result.lostCard) : "一张关键牌"}已经全部进了弃牌堆，打不满 25 分（打到 ${result.progress} 分）`;
      break;
    default:
      reason = master ? `没能打满 25 分（打到 ${result.progress} 分）` : "牌堆摸完，最后一轮结束";
  }
  const best = room.best;
  return (
    <div className="gm-modal-backdrop hb-result-backdrop" role="presentation">
      <section className="gm-panel hb-result" role="dialog" aria-modal="true" aria-labelledby="hb-result-title" data-tutorial="result">
        <Sprite className="hb-finale" src={art.finale(finaleTier)} frames={24} frameW={256} frameH={144} scale={mobile ? 1 : 2} seconds={1.92} loop />
        <h2 id="hb-result-title">{master ? (result.won ? "大师模式：完美！" : "大师模式：失败") : result.reason === "misfire" ? "烟火大会失败" : "烟火大会结束"}</h2>
        <p className="hb-final-score"><b>{result.score}</b> 分{!master && result.won && <span>{text}</span>}</p>
        <p className="hb-final-reason">{reason}</p>
        {best.games > 0 && (
          <p className="hb-final-best">
            本房间已打 {best.games} 局{best.score !== undefined ? `，最高 ${best.score} 分` : ""}{best.masterWins ? `，大师模式打满 ${best.masterWins} 次` : ""}
          </p>
        )}
        <div className="hb-rematch">
          {actions ? (
            <div className="gm-panel-actions">
              <button className="quiet-button" type="button" onClick={onHide}>看牌桌</button>
              {actions}
            </div>
          ) : spectating ? (
            <>
              <span>{room.rematch ? `等玩家决定要不要再来一局（${room.rematch.acceptedIds.length}/${room.members.length}）` : "对局结束"}</span>
              <div className="gm-panel-actions">
                <button className="quiet-button" type="button" onClick={onHide}>看牌桌</button>
                <button className="quiet-button" type="button" onClick={onLeave}>离开观战</button>
              </div>
            </>
          ) : room.rematch ? (
            <>
              <span>再来一局？还剩 {Math.ceil(room.rematch.remainingMs / 1000)} 秒（{room.rematch.acceptedIds.length}/{room.members.length} 人同意）</span>
              <div className="gm-panel-actions">
                <button className="quiet-button" type="button" onClick={onHide}>看牌桌</button>
                <button className="quiet-button" type="button" onClick={() => onRematch(false)}>离开</button>
                <button className="primary-button" type="button" disabled={accepted} onClick={() => onRematch(true)}>{accepted ? "等其他人" : "再来一局"}</button>
              </div>
            </>
          ) : (
            <div className="gm-panel-actions">
              <button className="quiet-button" type="button" onClick={onHide}>看牌桌</button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default GameBoard;
