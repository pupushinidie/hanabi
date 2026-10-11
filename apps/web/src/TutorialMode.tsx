/**
 * 花火的新手教程：在浏览器里按剧本走一局（packages/game/src/tutorial.ts），
 * 牌桌就是真正对局的 GameBoard，咕噜嘎的对话框叠在上面；剧本走完接着把这局打完，对手交给人机。
 * 不连服务器，不占房间；首页、等候房间都能进来（从等候房间进来时，房主开局会自动回到牌桌，见 App.tsx）。
 *
 * 给提示、出牌要点好几下（点牌 → 选颜色/数字 → 发出），GameBoard 用 onUiState 告诉这里选中了什么，
 * 高亮跟着从牌挪到下一个要点的按钮上。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  apply,
  botCommand,
  createPracticeGame,
  createTutorialGame,
  createTutorialRng,
  DEFAULT_ROOM_ACCESS,
  redactGameForViewer,
  sameCommand,
  TUTORIAL_RIVAL,
  TUTORIAL_RIVAL_NAME,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  type GameCommand,
  type GameState,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type TutorialRng,
  type TutorialStep,
} from "@hanabi/game";
import GameBoard, { type UiState } from "./GameBoard.js";
import { Coach, isTouchDevice, StepPips, type CoachView } from "./tutorial/Coach.js";
import { writeTutorial } from "./tutorial/storage.js";
import { useTutorial } from "./tutorial/useTutorial.js";
import { GAME_ID } from "./tutorialGame.js";

const SELF_MEMBER = "tutorial-self";

const randomSeed = () => Math.floor(Math.random() * 2 ** 32);

/** do 步骤：按界面状态决定现在该高亮哪里（牌 → 颜色/数字按钮 → 发出提示；牌 → 出牌/弃牌）。 */
function doAnchor(step: Extract<TutorialStep, { kind: "do" }>, ui: UiState): string | undefined {
  const expect = step.expect;
  if (expect.type === "CLUE") {
    if (ui.kind === "clue") return "clue-send";
    if (ui.kind === "mate") return expect.kind === "color" ? "clue-color" : "clue-rank";
    return step.anchor;
  }
  if (expect.type === "PLAY" || expect.type === "DISCARD") {
    if (ui.kind === "mine" && ui.cardId === expect.cardId) return expect.type === "PLAY" ? "action-play" : "action-discard";
    return step.anchor;
  }
  return step.anchor;
}

export default function TutorialMode({ name, brand, themeToggle, theme, waitingRoom, onExit }: {
  /** 首页填过的昵称；没填叫「新玩家」。 */
  name: string;
  brand: ReactNode;
  themeToggle: ReactNode;
  theme: "day" | "night";
  /** 从等候房间点进来的：那个房间的房间码。 */
  waitingRoom?: string | undefined;
  onExit: () => void;
}) {
  const selfName = name.trim().length >= 2 ? name.trim() : "新玩家";
  const rng = useRef<TutorialRng | null>(null);
  if (!rng.current) rng.current = createTutorialRng(randomSeed());
  const [ui, setUi] = useState<UiState>({ kind: "none" });

  const tutorial = useTutorial<GameState, GameCommand, TutorialStep>({
    steps: TUTORIAL_STEPS,
    self: TUTORIAL_SELF,
    start: () => createTutorialGame(selfName),
    restart: () => createPracticeGame(selfName, randomSeed()),
    apply: (state, playerId, command) => apply(state, playerId, command, rng.current!).state,
    same: sameCommand,
    actor: (state) => (state.phase === "playing" ? state.players[state.currentPlayer]!.id : null),
    // 整理手牌不分回合，练习局里随时能做（不合法的引擎会拒绝）
    canAct: () => true,
    bot: (state, playerId) => botCommand(redactGameForViewer(state, playerId), playerId),
    botDelay: () => 1500,
    watchDelay: () => 1800,
  });
  const { game, step, index, practice, flash } = tutorial;

  // 走到最后一步就算学完（之后首页不再邀请）
  useEffect(() => {
    if (practice || (step?.kind === "info" && step.finale)) writeTutorial(GAME_ID, "done");
  }, [practice, step?.id]);

  function leave() {
    writeTutorial(GAME_ID, "skipped");
    onExit();
  }

  const members = useMemo<LobbyMember[]>(() => [
    { id: SELF_MEMBER, playerId: TUTORIAL_SELF, name: selfName, isHost: false, connected: true },
    { id: "tutorial-bot", playerId: TUTORIAL_RIVAL, name: TUTORIAL_RIVAL_NAME, isHost: false, connected: true, bot: true },
  ], [selfName]);
  const room = useMemo<LobbyRoomSnapshot>(() => ({
    code: "GULU01",
    spectators: [],
    access: DEFAULT_ROOM_ACCESS,
    capacity: 2,
    options: { masterMode: false },
    best: { games: 0 },
    status: "playing",
    members,
    chat: [],
    voice: [],
    game: redactGameForViewer(game, TUTORIAL_SELF),
  }), [game, members]);

  let view: CoachView | null = null;
  if (step) {
    const note = isTouchDevice() && step.noteTouch ? step.noteTouch : step.note;
    const finale = step.kind === "info" && step.finale === true;
    const anchor = step.kind === "do" ? doAnchor(step, ui) : step.anchor;
    view = {
      key: step.kind === "do" ? `${step.id}-${anchor}` : step.id,
      say: step.say,
      ...(note ? { note } : {}),
      ...(flash ? { flash } : {}),
      anchor: anchor ?? null,
      focus: step.kind !== "watch",
      face: flash ? "surprised" : step.face ?? "base",
      footer: (
        <>
          <StepPips index={index} total={TUTORIAL_STEPS.length} />
          {!finale && <button className="tut-link" type="button" onClick={leave}>跳过教程</button>}
        </>
      ),
      actions: step.kind !== "info" ? null : finale ? (
        <>
          <button className="quiet-button" type="button" onClick={onExit}>结束教程</button>
          <button className="primary-button tut-main" type="button" onClick={tutorial.startPractice}>和咕噜一号打完这局</button>
        </>
      ) : (
        <button className="primary-button tut-main" type="button" onClick={tutorial.next}>下一步 ▶</button>
      ),
    };
  }

  return (
    <div className={practice ? "tut-practice" : "tut-script"} style={{ display: "contents" }}>
      <GameBoard
        room={room}
        busy={false}
        error=""
        notice=""
        brand={brand}
        connection={
          <>
            <span className="connection-status online"><span className="connection-dot" />{practice ? "练习局" : "新手教程"}</span>
            <button className="quiet-button" type="button" onClick={practice ? onExit : leave} data-tutorial="exit">退出教程</button>
          </>
        }
        themeToggle={themeToggle}
        theme={theme}
        chat={<Checklist index={index} practice={practice} waitingRoom={waitingRoom} />}
        onCommand={tutorial.onCommand}
        onRematch={() => undefined}
        onAuto={() => undefined}
        onDissolve={() => undefined}
        watchId={TUTORIAL_SELF}
        onWatch={() => undefined}
        onLeave={onExit}
        selfSeat={TUTORIAL_SELF}
        mode={practice ? "practice" : "tutorial"}
        onUiState={setUi}
        finalActions={
          <>
            <button className="quiet-button" type="button" onClick={onExit}>结束教程</button>
            <button className="primary-button" type="button" onClick={tutorial.newPractice}>再练一局</button>
          </>
        }
      />
      {view && <Coach view={view} />}
    </div>
  );
}

/** 侧栏（真实对局里是聊天）：剧本进行中列出这次学哪几样；练习局只留一句话。 */
function Checklist({ index, practice, waitingRoom }: { index: number; practice: boolean; waitingRoom: string | undefined }) {
  const lessons = TUTORIAL_STEPS.map((step, at) => ({ step, at })).filter(({ step }) => step.lesson);
  const done = lessons.filter(({ at }) => at < index).length;
  return (
    <section className="hb-panel tut-checklist" aria-label="新手教程进度">
      {practice ? (
        <>
          <h3>练习局 <small>教程学完了</small></h3>
          <p>拿不准就点操作面板里的「提示」（键盘 H），我告诉你人机会怎么走。</p>
        </>
      ) : (
        <>
          <h3>新手教程 <small>{done}/{lessons.length}</small></h3>
          <ul>
            {lessons.map(({ step, at }) => {
              const state = at < index ? "done" : at === index ? "now" : "";
              return (
                <li key={step.id} className={state}>
                  <i aria-hidden="true">{state === "done" ? "✓" : state === "now" ? "▶" : "·"}</i>
                  {step.lesson}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {waitingRoom && <p>你还在房间 {waitingRoom} 里，房主一开局就自动回到牌桌。</p>}
    </section>
  );
}
