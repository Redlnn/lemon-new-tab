import type { Point } from './model'

// Find a small pier wholly inside the water, rather than rotating a fixed
// board around the harbour building's dry-land centre.
export function placePier(p: Point, water: (x: number, y: number) => number) {
  const gx = water(p.x + 5, p.y) - water(p.x - 5, p.y),
    gy = water(p.x, p.y + 5) - water(p.x, p.y - 5)
  const facing = Math.atan2(-gy, -gx)
  let best: { angle: number; offset: number; length: number; score: number } | undefined
  for (const turn of [0, -1, 1, -2, 2, -3, 3, -4, 4]) {
    const angle = facing + turn * 0.16,
      dx = Math.cos(angle),
      dy = Math.sin(angle)
    for (let offset = Math.max(8, Math.floor(water(p.x, p.y)) - 4); offset <= 88; offset += 2) {
      if (water(p.x + dx * offset, p.y + dy * offset) > -6) continue
      for (const length of [26, 22, 18]) {
        let valid = true
        check: for (let t = offset; t <= offset + length; t += 2)
          for (const side of [-4, 4]) {
            if (water(p.x + dx * t - dy * side, p.y + dy * t + dx * side) > -1) {
              valid = false
              break check
            }
          }
        if (!valid) continue
        const score = offset + Math.abs(turn) * 4
        if (!best || score < best.score) best = { angle, offset, length, score }
        if (turn === 0) return best
        break
      }
      if (best && best.angle === angle) break
    }
  }
  return best
}
