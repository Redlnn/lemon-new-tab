export type BeachRect = { x: number; y: number; w: number; h: number }

// The field uses a Gaussian around half of each rectangle. Leave room for up to
// three overlapping groups per island without joining the navigation island.
const ISLAND_GAP = 300

export function beachRegionsSeparate(a: BeachRect, b: BeachRect, gap = ISLAND_GAP): boolean {
  const dx = Math.max(0, Math.abs(a.x + a.w / 2 - b.x - b.w / 2) - (a.w + b.w) / 4)
  const dy = Math.max(0, Math.abs(a.y + a.h / 2 - b.y - b.h / 2) - (a.h + b.h) / 4)
  return Math.hypot(dx, dy) >= gap
}

export function shouldRepositionBeachIslands(
  previous: { width: number; height: number },
  width: number,
  height: number,
): boolean {
  return (
    Math.abs(width - previous.width) >= Math.max(160, previous.width * 0.2) ||
    Math.abs(height - previous.height) >= Math.max(160, previous.height * 0.2)
  )
}

/** Place a few differently proportioned islands, leaving space for deep water. */
export function createBeachIslands(
  width: number,
  height: number,
  main: BeachRect | null,
  random: () => number = Math.random,
  gap = ISLAND_GAP,
): BeachRect[] {
  const islands: BeachRect[] = []
  const count = Math.min(3, Math.max(1, Math.floor((width * height) / 1300000) + 1))
  for (let attempt = 0; attempt < 120 && islands.length < count; attempt++) {
    const shape = random()
    const short = 25 + random() * 85
    const long = 120 + random() * 380
    const w = shape < 0.35 ? long : shape < 0.7 ? short : 40 + random() * 260
    const h = shape < 0.35 ? short : shape < 0.7 ? long : 40 + random() * 260
    const island = { x: random() * width - w / 2, y: random() * height - h / 2, w, h }
    if (
      (main && !beachRegionsSeparate(island, main, gap)) ||
      islands.some((other) => !beachRegionsSeparate(island, other, gap))
    )
      continue
    islands.push(island)
  }
  return islands
}
