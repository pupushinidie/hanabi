import { COLOR_NAMES, type GameState, type LogEntry } from "@hanabi/game";

export function clueValueText(kind: "color" | "rank", value: string | number): string {
  return kind === "color" ? `${COLOR_NAMES[value as keyof typeof COLOR_NAMES]}色` : `数字 ${value}`;
}

/** 一条公开记录写成一句话。selfId 是「你」。 */
export function describe(entry: LogEntry, game: GameState, selfId: string): string {
  const name = (id: string) => (id === selfId ? "你" : game.players.find((p) => p.id === id)?.name ?? "?");
  const auto = "auto" in entry && entry.auto ? "（超时自动）" : "";
  switch (entry.type) {
    case "clue":
      return `${name(entry.player)} 提示 ${name(entry.target)}：${clueValueText(entry.kind, entry.value)}，标中 ${entry.cardIds.length} 张${auto}`;
    case "play":
      return entry.success
        ? `${name(entry.player)} 打出 ${COLOR_NAMES[entry.color]}${entry.rank}${entry.bonus ? "，完成这一色，拿回 1 个提示标记" : ""}`
        : `${name(entry.player)} 打错了 ${COLOR_NAMES[entry.color]}${entry.rank}，用掉 1 个失误标记`;
    case "discard":
      return `${name(entry.player)} 弃掉 ${COLOR_NAMES[entry.color]}${entry.rank}，拿回 1 个提示标记${auto}`;
    case "pass":
      return `${name(entry.player)} 没有能做的事，跳过`;
  }
}
