import type { CSSProperties, ReactNode } from "react";
import type { CardClues, Color, Rank } from "@hanabi/game";
import { art, COLOR_UI } from "../art.js";
import { CARD_H, CARD_W } from "./layout.js";

type Face = { readonly color: Color; readonly rank: Rank };

/** 原图坐标 → 当前倍数下的绝对定位。 */
function at(x: number, y: number, w: number, h: number, s: number): CSSProperties {
  return { left: x * s, top: y * s, width: w * s, height: h * s };
}

/** 一次性的横排精灵动画（steps(N, jump-none)，末帧停住）。 */
export function Sprite({ src, frames, frameW, frameH, scale, seconds, loop = false, className = "", style }: {
  src: string;
  frames: number;
  frameW: number;
  frameH: number;
  scale: number;
  seconds: number;
  loop?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <i
      className={`hb-sprite ${className}`}
      aria-hidden="true"
      style={{
        width: frameW * scale,
        height: frameH * scale,
        backgroundImage: `url(${src})`,
        backgroundSize: `${frames * 100}% 100%`,
        animationDuration: `${seconds}s`,
        animationTimingFunction: `steps(${frames}, jump-none)`,
        animationIterationCount: loop ? "infinite" : 1,
        ...style,
      }}
    />
  );
}

/** 1× 时牌上的数字只有 18px：在左上角叠一个 24px 的数字（关键信息 ≥24px）。 */
function BigNumber({ rank, color }: { rank: Rank; color?: Color | undefined }) {
  return <b className={color ? `hb-num c-${color}` : "hb-num"} aria-hidden="true">{rank}</b>;
}

export const faceText = (face: Face) => `${COLOR_UI[face.color].name}${face.rank}`;

function clueText(clues: CardClues): string {
  const color = clues.color ? COLOR_UI[clues.color].name : "?";
  const rank = clues.rank ?? "?";
  return clues.color || clues.rank ? `${color}${rank}` : "?";
}

interface CommonProps {
  readonly scale: number;
  /** 套金框（给提示的预览、选中）。 */
  readonly glow?: boolean;
  readonly lifted?: boolean;
  /** 刚收到提示：闪一圈金光。 */
  readonly flash?: string | undefined;
  readonly onClick?: (() => void) | undefined;
  readonly title?: string;
  readonly tutorial?: string;
  readonly children?: ReactNode;
  readonly dim?: boolean;
}

function CardShell({ scale, glow, lifted, flash, onClick, title, tutorial, dim, children }: CommonProps) {
  const body = (
    <span className={["hb-card", lifted ? "lifted" : "", dim ? "dim" : "", onClick ? "clickable" : ""].join(" ")} style={{ width: CARD_W * scale, height: CARD_H * scale }}>
      {children}
      {glow && <img className="hb-glow" src={art.glow} alt="" style={at(-4, -4, 72, 104, scale)} />}
      {flash && <Sprite key={flash} className="hb-flash" src={art.clueFx} frames={8} frameW={72} frameH={104} scale={scale} seconds={0.48} style={at(-4, -4, 72, 104, scale)} />}
    </span>
  );
  return onClick ? (
    <button type="button" className="hb-cardcol" onClick={onClick} title={title} data-tutorial={tutorial}>
      {body}
    </button>
  ) : (
    <span className="hb-cardcol" title={title} data-tutorial={tutorial}>{body}</span>
  );
}

/** 看得到牌面的牌（队友的手牌、结算时亮出的牌）。known：这张牌的主人自己知道的提示，画成左下角的小章。 */
export function FaceCard({ face, known, ...common }: CommonProps & { face: Face; known?: CardClues | undefined }) {
  const s = common.scale;
  return (
    <CardShell {...common}>
      <img className="hb-img" src={art.card(face.color, face.rank)} alt={faceText(face)} />
      {s === 1 && <BigNumber rank={face.rank} color={face.color} />}
      {known?.color && <img className="hb-chip" src={art.clueColor(known.color)} alt="" style={at(4, 74, 16, 16, s)} />}
      {known?.rank && <img className="hb-chip" src={art.clueRank(known.rank)} alt="" style={at(known.color ? 22 : 4, 70, 16, 22, s)} />}
    </CardShell>
  );
}

/** 自己看不到的牌：未知牌背 + 收到的提示（已知颜色换成带色的牌背，已知数字、排除信息叠小图）。 */
export function HiddenCard({ clues, ...common }: CommonProps & { clues: CardClues }) {
  const s = common.scale;
  const notColors = clues.color ? [] : clues.notColors.slice(0, 4);
  const notRanks = clues.rank ? [] : clues.notRanks.slice(0, 4);
  const label = clueText(clues);
  return (
    <CardShell {...common}>
      <img className="hb-img" src={art.unknown(clues.color)} alt={`看不到的牌：${label === "?" ? "没有提示" : `已知 ${label}`}`} />
      {clues.rank && (s === 1 ? <BigNumber rank={clues.rank} color={clues.color} /> : <img className="hb-chip" src={art.clueRank(clues.rank)} alt="" style={at(5, 5, 16, 22, s)} />)}
      {notColors.map((color, index) => <img key={color} className="hb-chip" src={art.notColor(color)} alt="" style={at(5 + 13 * index, 66, 12, 12, s)} />)}
      {notRanks.map((rank, index) => <img key={rank} className="hb-chip" src={art.notRank(rank)} alt="" style={at(5 + 13 * index, 79, 12, 12, s)} />)}
    </CardShell>
  );
}

/** 小牌（24×34）：手机上的队友手牌、弃牌一览、日志。 */
export function MiniCard({ face, scale, dim = false, title }: { face?: Face | null; scale: number; dim?: boolean; title?: string }) {
  const src = face ? art.mini(face.color, face.rank) : art.miniUnknown;
  return <img className={dim ? "hb-mini dim" : "hb-mini"} src={src} alt={face ? faceText(face) : "?"} title={title} style={{ width: 24 * scale, height: 34 * scale }} />;
}
