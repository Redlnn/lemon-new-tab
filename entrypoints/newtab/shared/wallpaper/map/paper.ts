import { noise } from './model'

function pigment(seed: number, x: number, y: number) {
  const blot = noise(seed + 499, x / 42, y / 42) * 0.45 + noise(seed + 500, x / 115, y / 115) * 0.55
  const ochre = Math.min(0.64, Math.max(0, blot - 0.32) * 1.2)
  // A few of the darkest stains have a narrow dried-water rim. The pigment
  // shifts toward golden ochre rather than subtracting equal RGB amounts.
  const rim = Math.exp(-Math.pow((blot - 0.74) / 0.045, 2)) * 0.045
  const fibre = (noise(seed + 501, x / 6, y / 6) - 0.5) * 1.8
  const r = Math.round(239 - ochre * 34 - rim * 68 + fibre),
    g = Math.round(220 - ochre * 60 - rim * 85 + fibre * 0.7),
    b = Math.round(174 - ochre * 87 - rim * 96 + fibre * 0.4)
  return (r << 16) | (g << 8) | b
}
export function paperColor(seed: number, x: number, y: number) {
  const color = pigment(seed, x, y)
  return `rgb(${color >>> 16} ${(color >>> 8) & 255} ${color & 255})`
}

let cached: { seed: number; width: number; height: number; canvas: OffscreenCanvas } | undefined
export function paperTexture(seed: number, width: number, height: number) {
  if (cached && cached.seed === seed && cached.width === width && cached.height === height)
    return cached.canvas
  const canvas = new OffscreenCanvas(Math.ceil(width / 4), Math.ceil(height / 4)),
    ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(canvas.width, canvas.height)
  for (let y = 0; y < canvas.height; y++)
    for (let x = 0; x < canvas.width; x++) {
      const color = pigment(seed, x * 4, y * 4),
        offset = (y * canvas.width + x) * 4
      image.data[offset] = color >>> 16
      image.data[offset + 1] = (color >>> 8) & 255
      image.data[offset + 2] = color & 255
      image.data[offset + 3] = 255
    }
  ctx.putImageData(image, 0, 0)
  cached = { seed, width, height, canvas }
  return canvas
}
