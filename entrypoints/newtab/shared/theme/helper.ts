import {
  alphaFromArgb,
  blueFromArgb,
  greenFromArgb,
  redFromArgb,
} from '@material/material-color-utilities'

/**
 * 从给定的 int32 颜色值返回 RGBA
 *
 * @param argb ARGB representation of a int32 color.
 * @return RGBA representation of a int32 color.
 */
export function rgbaFromArgb(argb: number): Rgba {
  const r = redFromArgb(argb)
  const g = greenFromArgb(argb)
  const b = blueFromArgb(argb)
  const a = alphaFromArgb(argb)
  return { r, g, b, a }
}
