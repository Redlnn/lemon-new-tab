export type Point = { x: number; y: number }
export type Bounds = (Point & { width: number; height: number }) | null
export type MapField = { values: Float32Array; cols: number; rows: number; step: number }
export type MapRequest = {
  id: number
  seed: number
  width: number
  height: number
  viewWidth: number
  viewHeight: number
  anchorWidth: number
  anchorHeight: number
  scale: number
  navigation: Bounds
  quiet?: NonNullable<Bounds>[]
  compassCandidates?: Point[]
  preview?: boolean
  previewOnly?: boolean
  first?: boolean
  shoreline?: boolean
  islandLimit?: number
  showNavigationLake?: boolean
  navigationLakeSize?: number
}
export type MapCounts = {
  trains: number
  ships: number
  islands: number
  showNavigationLake: boolean
  navigationLakeSize: number
}
export type Place = Point & {
  id: number
  kind: 'town' | 'castle' | 'port'
  name: string
  angle: number
  pier?: { offset: number; length: number }
}
export type Route = { points: Point[]; from: number; to: number }
export type Label = Point & { text: string; size: number; region: boolean }
export type Symbol = Point & {
  kind: 'mountain' | 'hill' | 'pine' | 'tree' | 'grass'
  size: number
}
export type MapData = {
  seed: number
  width: number
  height: number
  navigation: Bounds
  navigationLakeCenter: Point | null
  compass: Point
  coast: Point[][][]
  waterPolygons: Point[][]
  rivers: Point[][]
  riverWidths: number[][]
  places: Place[]
  roads: Route[]
  rails: Route[]
  bridges: (Point & { angle: number; length: number })[]
  symbols: Symbol[]
  labels: Label[]
  waves: Point[]
  ships: Point[][]
}

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
export function random(seed: number, x: number, y = 0) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + (seed | 0)
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
export function noise(seed: number, x: number, y: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y)
  let u = x - ix,
    v = y - iy
  u = u * u * (3 - 2 * u)
  v = v * v * (3 - 2 * v)
  const a = random(seed, ix, iy),
    b = random(seed, ix + 1, iy)
  const c = random(seed, ix, iy + 1),
    d = random(seed, ix + 1, iy + 1)
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v
}

// Arc-length sampling keeps each carriage on its own part of a bend.
export function pathLengths(points: Point[]) {
  const lengths = [0]
  for (let i = 1; i < points.length; i++)
    lengths.push(lengths[i - 1]! + distance(points[i - 1]!, points[i]!))
  return lengths
}
export function samplePath(points: Point[], lengths: number[], at: number) {
  const total = lengths.at(-1) || 1
  at = Math.max(0, Math.min(total - 0.001, at))
  let lo = 1,
    hi = lengths.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (lengths[mid]! < at) lo = mid + 1
    else hi = mid
  }
  const a = points[lo - 1]!,
    b = points[lo]!
  const t = (at - lengths[lo - 1]!) / Math.max(0.001, lengths[lo]! - lengths[lo - 1]!)
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  }
}
