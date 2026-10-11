/**
 * 像素美术的地址（江户夏祭，PixelLab 出图，见 art/spec.md）。图片放在 public/art 下。
 */
import type { Color, Rank } from "@hanabi/game";

const ROOT = `${import.meta.env.BASE_URL}art/`;

export const art = {
  bgNight: `${ROOT}bg/night@3x.png`,
  bgDay: `${ROOT}bg/day@3x.png`,
  card: (color: Color, rank: Rank) => `${ROOT}cards/${color}${rank}.png`,
  back: `${ROOT}cards/back.png`,
};
