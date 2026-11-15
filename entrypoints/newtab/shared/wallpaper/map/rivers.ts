import { distance, noise, pathLengths, type Point } from './model'

export function riverMouth(dry: Point, wet: Point, water: (x: number, y: number) => number) {
  let lo = 0,
    hi = 1
  for (let i = 0; i < 14; i++) {
    const t = (lo + hi) / 2
    if (water(dry.x + (wet.x - dry.x) * t, dry.y + (wet.y - dry.y) * t) < 0) hi = t
    else lo = t
  }
  return { x: dry.x + (wet.x - dry.x) * hi, y: dry.y + (wet.y - dry.y) * hi }
}

const key = (p: Point) => `${p.x},${p.y}`
type Node = { point: Point; control: Point; next?: Node; upstream?: Node; reach: number }

// Shape the graph once. Shared downstream edges have identical curves and
// tangents, including when a different tributary approaches the junction.
export function shapeRivers(
  rivers: Point[][],
  water: (x: number, y: number) => number,
  seed: number,
) {
  const nodes = new Map<string, Node>()
  for (const river of rivers) {
    let previous: Node | undefined,
      reach = 0
    for (const p of river) {
      let node = nodes.get(key(p))
      if (!node) {
        node = { point: p, control: p, reach: 0 }
        nodes.set(key(p), node)
      }
      if (previous) {
        reach += distance(previous.point, p)
        previous.next = node
        if (reach > node.reach) {
          node.upstream = previous
          node.reach = reach
        }
      }
      previous = node
    }
  }
  for (const node of nodes.values()) {
    if (!node.next || !node.upstream) continue
    const before = node.upstream.point,
      after = node.next.point,
      length = distance(before, after) || 1,
      p = node.point
    const offset =
      ((noise(seed + 821, p.x / 105, p.y / 105) - 0.5) * 54 +
        (noise(seed + 823, p.x / 43, p.y / 43) - 0.5) * 14) *
      Math.min(1, Math.max(0, water(p.x, p.y) / 50))
    node.control = {
      x: p.x - ((after.y - before.y) / length) * offset,
      y: p.y + ((after.x - before.x) / length) * offset,
    }
  }
  const tangent = (node: Node) => {
    const before = node.upstream?.control || node.control,
      after = node.next?.control || node.control,
      length = distance(before, after) || 1
    return { x: (after.x - before.x) / length, y: (after.y - before.y) / length }
  }
  const edges = new Map<Node, Point[]>()
  function segment(node: Node) {
    if (edges.has(node)) return edges.get(node)!
    const next = node.next!,
      a = node.control,
      b = next.control,
      length = distance(a, b),
      samples = Math.max(2, Math.ceil(length / 4)),
      ta = tangent(node),
      tb = tangent(next),
      points: Point[] = []
    for (let i = 1; i <= samples; i++) {
      const t = i / samples,
        t2 = t * t,
        t3 = t2 * t
      const interpolate = (a: number, b: number, da: number, db: number) =>
        (2 * t3 - 3 * t2 + 1) * a +
        (t3 - 2 * t2 + t) * da * length +
        (-2 * t3 + 3 * t2) * b +
        (t3 - t2) * db * length
      points.push(
        i === samples
          ? b
          : { x: interpolate(a.x, b.x, ta.x, tb.x), y: interpolate(a.y, b.y, ta.y, tb.y) },
      )
    }
    edges.set(node, points)
    return points
  }
  return rivers
    .map((river) => {
      const result: Point[] = [nodes.get(key(river[0]!))!.control]
      for (let i = 0; i < river.length - 1; i++)
        for (const p of segment(nodes.get(key(river[i]!))!)) {
          const previous = result.at(-1)!
          if (water(p.x, p.y) < 0 && result.length === 1 && water(previous.x, previous.y) < 0) {
            result[0] = p
            continue
          }
          if (water(p.x, p.y) < 0) {
            result.push(riverMouth(previous, p, water))
            return result
          }
          if (result.length === 1 && water(previous.x, previous.y) < 0)
            result[0] = riverMouth(p, previous, water)
          if (distance(previous, p) > 0.01) result.push(p)
        }
      return result
    })
    .filter((path) => path.length > 3)
}

// Lake outlets start as developed channels. Other streams widen as they
// travel; shared samples also accumulate tributaries' contribution.
export function riverWidths(rivers: Point[][], water: (x: number, y: number) => number) {
  const shared = new Map<string, { width: number; sources: number }>()
  const widths = rivers.map((river) => {
    const lengths = pathLengths(river),
      lake = Math.abs(water(river[0]!.x, river[0]!.y)) < 1
    return river.map((p, i) => {
      const width = lake ? 1.9 : Math.min(3.3, 0.65 + Math.sqrt(lengths[i]!) * 0.085)
      const previous = shared.get(key(p))
      shared.set(key(p), {
        width: Math.max(width, previous?.width || 0),
        sources: (previous?.sources || 0) + 1,
      })
      return width
    })
  })
  for (let r = 0; r < rivers.length; r++) {
    let previous = 0
    for (let i = 0; i < rivers[r]!.length; i++) {
      const flow = shared.get(key(rivers[r]![i]!))!
      previous = Math.max(previous, Math.min(3.8, flow.width + Math.sqrt(flow.sources - 1) * 0.24))
      widths[r]![i] = previous
    }
  }
  return widths
}
