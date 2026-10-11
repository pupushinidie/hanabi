import type { ReactNode } from "react";
import type { GameCommand, LobbyRoomSnapshot } from "@hanabi/game";

/** 牌桌（界面阶段换成正式版；这里是引擎阶段的占位，只为了能编译和联机自测）。 */
interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  readonly themeToggle: ReactNode;
  readonly chat: ReactNode;
  readonly onCommand: (command: GameCommand) => void;
  readonly onRematch: (accept: boolean) => void;
  readonly onAuto: (enabled: boolean) => void;
  readonly onDissolve: () => void;
  readonly watchId: string;
  readonly onWatch: (playerId: string) => void;
  readonly onLeave: () => void;
}

export default function GameBoard({ room }: GameBoardProps) {
  const game = room.game!;
  return <pre>{JSON.stringify({ turn: game.turn, fireworks: game.fireworks, clues: game.clueTokens, misfires: game.misfires }, null, 1)}</pre>;
}
