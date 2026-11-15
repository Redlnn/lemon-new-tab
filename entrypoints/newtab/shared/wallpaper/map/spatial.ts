import type { Point } from './model'

type Segment = { a: Point; b: Point }
// Both decoration clearance and bridge detection query local segments instead
// of scanning every river and railway for every one of thousands of symbols.
export class LineIndex {
  private cells = new Map<string, Segment[]>()
  constructor(paths: Point[][]) {
    for (const path of paths)
      for (let i = 1; i < path.length; i++) {
        const segment = { a: path[i - 1]!, b: path[i]! }
        this.visit(segment.a, segment.b, 0, (key) => {
          const cell = this.cells.get(key)
          if (cell) cell.push(segment)
          else this.cells.set(key, [segment])
        })
      }
  }
  private visit(a: Point, b: Point, margin: number, visit: (key: string) => void) {
    for (
      let y = Math.floor((Math.min(a.y, b.y) - margin) / 64);
      y <= Math.floor((Math.max(a.y, b.y) + margin) / 64);
      y++
    )
      for (
        let x = Math.floor((Math.min(a.x, b.x) - margin) / 64);
        x <= Math.floor((Math.max(a.x, b.x) + margin) / 64);
        x++
      )
        visit(`${x},${y}`)
  }
  near(p: Point, margin: number) {
    let hit = false
    this.visit(p, p, margin, (key) => {
      if (hit) return
      for (const { a, b } of this.cells.get(key) || []) {
        const dx = b.x - a.x,
          dy = b.y - a.y,
          t = Math.max(
            0,
            Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
          )
        if (Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t) < margin) {
          hit = true
          return
        }
      }
    })
    return hit
  }
  crossings(a: Point, b: Point) {
    const candidates = new Set<Segment>(),
      hits: Point[] = []
    this.visit(a, b, 0, (key) => {
      for (const segment of this.cells.get(key) || []) candidates.add(segment)
    })
    for (const { a: c, b: d } of candidates) {
      const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x)
      if (Math.abs(den) < 0.001) continue
      const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den
      const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den
      if (t > 0 && t < 1 && u > 0 && u < 1)
        hits.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) })
    }
    return hits
  }
}
