import type { MapData, Point } from './model'

export function coastContours(
  width: number,
  height: number,
  water: (x: number, y: number) => number,
  contourStep = 8,
): Pick<MapData, 'coast' | 'waterPolygons'> {
  const coast: Point[][][] = [[], [], []],
    waterPolygons: Point[][] = []
  // Sample the continuous field once; all coastline levels share the grid.
  const cw = Math.ceil(width / contourStep) + 1,
    ch = Math.ceil(height / contourStep) + 1
  const field = new Float32Array(cw * ch)
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) field[y * cw + x] = water(x * contourStep, y * contourStep)
  for (let y = 0; y < ch - 1; y++)
    for (let x = 0; x < cw - 1; x++) {
      const corners = [
        { x: x * contourStep, y: y * contourStep },
        { x: (x + 1) * contourStep, y: y * contourStep },
        { x: (x + 1) * contourStep, y: (y + 1) * contourStep },
        { x: x * contourStep, y: (y + 1) * contourStep },
      ]
      const values = [
        field[y * cw + x]!,
        field[y * cw + x + 1]!,
        field[(y + 1) * cw + x + 1]!,
        field[(y + 1) * cw + x]!,
      ]
      for (let levelIndex = 0; levelIndex < 3; levelIndex++) {
        const level = levelIndex * 5,
          hits: Point[] = []
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) % 4,
            a = values[i]! - level,
            b = values[j]! - level
          if (a < 0 === b < 0) continue
          const t = a / (a - b),
            p = corners[i]!,
            q = corners[j]!
          hits.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
        }
        for (let i = 0; i + 1 < hits.length; i += 2)
          coast[levelIndex]!.push([hits[i]!, hits[i + 1]!])
      }
      // Clip two triangles, resolving saddle cells consistently with the field.
      if (values.every((value) => value < 0) || values.every((value) => value >= 0)) continue
      for (const indices of [
        [0, 1, 2],
        [0, 2, 3],
      ]) {
        const polygon: Point[] = []
        for (let k = 0; k < 3; k++) {
          const i = indices[k]!,
            j = indices[(k + 1) % 3]!,
            a = values[i]!,
            b = values[j]!
          const p = corners[i]!,
            q = corners[j]!
          if (a < 0) polygon.push(p)
          if (a < 0 !== b < 0) {
            const t = a / (a - b)
            polygon.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
          }
        }
        if (polygon.length > 2) waterPolygons.push(polygon)
      }
    }
  // Merge solid-water cells into scanline runs instead of clipping tens of
  // thousands of adjacent triangles. Only shoreline cells need polygons.
  for (let y = 0; y < ch - 1; y++) {
    let start = -1
    for (let x = 0; x <= cw - 1; x++) {
      const full =
        x < cw - 1 &&
        field[y * cw + x]! < 0 &&
        field[y * cw + x + 1]! < 0 &&
        field[(y + 1) * cw + x]! < 0 &&
        field[(y + 1) * cw + x + 1]! < 0
      if (full && start < 0) start = x
      if (!full && start >= 0) {
        waterPolygons.push([
          { x: start * contourStep, y: y * contourStep },
          { x: x * contourStep, y: y * contourStep },
          { x: x * contourStep, y: (y + 1) * contourStep },
          { x: start * contourStep, y: (y + 1) * contourStep },
        ])
        start = -1
      }
    }
  }

  return { coast, waterPolygons }
}
