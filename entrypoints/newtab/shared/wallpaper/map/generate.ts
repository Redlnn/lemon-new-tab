import { coastContours } from './coast'
import {
  distance,
  noise,
  pathLengths,
  random,
  type MapData,
  type MapRequest,
  type Place,
  type Point,
} from './model'
import { placePier } from './ports'
import { riverMouth, riverWidths, shapeRivers } from './rivers'
import { LineIndex } from './spatial'
import { createTerrain, MinHeap } from './terrain'

const directions = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
] as const
const roots = [
  'Val',
  'Bel',
  'Sil',
  'Alder',
  'Monte',
  'Riva',
  'Cala',
  'Argen',
  'Dun',
  'Fara',
  'Elden',
  'Aure',
  'Castel',
  'Lora',
  'Cor',
  'Vel',
  'Isen',
  'Bran',
  'Mar',
  'Tor',
  'Fal',
  'Nord',
  'Ash',
  'Ros',
]
const endings = [
  'dora',
  'monte',
  'varia',
  'mere',
  'luce',
  'forte',
  'bria',
  'ton',
  'heim',
  'vale',
  'ora',
  'mar',
  'haven',
  'wick',
  'gard',
  'field',
  'shire',
  'crest',
  'holm',
  'brook',
  'borne',
  'wyn',
  'fall',
  'moor',
]

export function generateMap(request: MapRequest, previous?: MapData): MapData {
  const { seed, width, height, navigation } = request
  if (previous?.seed !== seed) previous = undefined
  const terrain = createTerrain(request)
  const { water, ridge, elevation } = terrain
  const candidates = request.compassCandidates || [{ x: 72, y: request.viewHeight - 90 }]
  const compass = candidates.find((p) => Math.abs(water(p.x, p.y)) > 85) || candidates[0]!
  const quiet = [
    ...(request.quiet || []),
    ...(navigation ? [navigation] : []),
    { x: compass.x - 65, y: compass.y - 65, width: 130, height: 130 },
  ]
  const inQuiet = (p: Point, margin = 0) =>
    quiet.some(
      (q) =>
        p.x > q.x - margin &&
        p.x < q.x + q.width + margin &&
        p.y > q.y - margin &&
        p.y < q.y + q.height + margin,
    )
  const map: MapData = {
    seed,
    width,
    height,
    viewWidth: request.viewWidth,
    viewHeight: request.viewHeight,
    navigation,
    navigationLakeCenter:
      navigation && request.showNavigationLake !== false
        ? { x: navigation.x + navigation.width * 0.51, y: navigation.y + navigation.height * 0.55 }
        : null,
    compass,
    ...coastContours(width, height, water),
    rivers: [],
    riverWidths: [],
    places: [],
    roads: [],
    rails: [],
    bridges: [],
    symbols: [],
    labels: [],
    waves: [],
    ships: [],
  }
  // Priority flood establishes an acyclic drainage tree to the ocean or world
  // boundary, including outlets from inland depressions. Filled heights never
  // decrease upstream, so rivers cannot loop or terminate on a random hillside.
  const step = 24,
    cols = Math.ceil(width / step) + 1,
    rows = Math.ceil(height / step) + 1,
    count = cols * rows
  const heights = new Float32Array(count),
    filled = new Float32Array(count).fill(Infinity)
  const parent = new Int32Array(count).fill(-1),
    visited = new Uint8Array(count)
  const heap = new MinHeap()
  const point = (id: number) => ({ x: (id % cols) * step, y: Math.floor(id / cols) * step })
  const cell = (p: Point) =>
    Math.max(0, Math.min(rows - 1, Math.round(p.y / step))) * cols +
    Math.max(0, Math.min(cols - 1, Math.round(p.x / step)))
  for (let id = 0; id < count; id++) {
    const p = point(id)
    heights[id] = elevation(p.x, p.y) + Math.max(0, 95 - distance(p, compass)) * 0.06
    if (
      terrain.sea(p.x, p.y) < -8 ||
      p.x === 0 ||
      p.y === 0 ||
      id % cols === cols - 1 ||
      Math.floor(id / cols) === rows - 1
    ) {
      filled[id] = heights[id]!
      visited[id] = 1
      heap.push(id, filled[id]!)
    }
  }
  while (heap.size) {
    const current = heap.pop().id,
      x = current % cols,
      y = Math.floor(current / cols)
    for (const [dx, dy] of directions) {
      const nx = x + dx,
        ny = y + dy
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
      const next = ny * cols + nx
      if (visited[next]) continue
      visited[next] = 1
      filled[next] = Math.max(heights[next]!, filled[current]! + 0.0001)
      parent[next] = current
      heap.push(next, filled[next]!)
    }
  }
  function riverFrom(id: number) {
    const points: Point[] = []
    let current = id
    while (current >= 0 && points.length < count) {
      const p = point(current)
      points.push(p)
      if (points.length > 1 && water(p.x, p.y) < 0) break
      current = parent[current]!
    }
    if (points.length < 6) return
    map.rivers.push(points)
  }
  for (let y = 100; y < height - 70; y += 300)
    for (let x = 100; x < width - 70; x += 340) {
      let best = -1,
        score = 0
      for (let dy = -60; dy <= 60; dy += 24)
        for (let dx = -60; dx <= 60; dx += 24) {
          const id = cell({ x: x + dx, y: y + dy }),
            p = point(id)
          if (!inQuiet(p, 20) && water(p.x, p.y) > 80 && heights[id]! > score) {
            best = id
            score = heights[id]!
          }
        }
      if (best >= 0 && score > 0.85) riverFrom(best)
    }
  for (const lake of terrain.lakes) {
    // Walk the drainage tree through the lake and start its outlet on land.
    let current = cell(lake),
      safety = count
    let previous = point(current)
    while (current >= 0 && safety--) {
      const p = point(current)
      if (water(p.x, p.y) >= 0) {
        const before = map.rivers.length
        riverFrom(current)
        if (map.rivers.length > before) map.rivers.at(-1)!.unshift(riverMouth(p, previous, water))
        break
      }
      previous = p
      current = parent[current]!
    }
  }

  map.rivers = shapeRivers(map.rivers, water, seed)
  if (previous) {
    const oldWater = createTerrain({
      ...request,
      width: previous.width,
      height: previous.height,
      viewWidth: previous.viewWidth,
      viewHeight: previous.viewHeight,
      navigation: previous.navigation,
    }).water
    const riverKey = (path: Point[]) => {
      const head = path[0]!
      const lake =
        Math.abs(water(head.x, head.y)) < 8
          ? terrain.lakes.find((lake) => distance(head, lake) < Math.max(lake.rx, lake.ry) + 30)
          : undefined
      return lake ? `lake:${lake.x},${lake.y}` : `${head.x.toFixed(1)},${head.y.toFixed(1)}`
    }
    const retained = new Map(
      previous.rivers
        .filter((path) => {
          const end = path.at(-1)!,
            boundary = end.x <= 0 || end.y <= 0 || end.x >= width - 1 || end.y >= height - 1
          const head = path[0]!
          if (
            head.x >= width ||
            head.y >= height ||
            (Math.abs(oldWater(head.x, head.y)) < 8 && Math.abs(water(head.x, head.y)) > 8)
          )
            return false
          return (
            (water(end.x, end.y) <= 0.1 || boundary) &&
            path.every(
              (p, i) =>
                distance(p, compass) > 66 &&
                (i === 0 || i === path.length - 1 || water(p.x, p.y) >= -0.1),
            )
          )
        })
        .map((path) => [riverKey(path), path]),
    )
    map.rivers = map.rivers.map((path) => retained.get(riverKey(path)) || path)
    const included = new Set(map.rivers)
    for (const path of retained.values()) if (!included.has(path)) map.rivers.push(path)
  }
  map.riverWidths = riverWidths(map.rivers, water)
  for (let r = 0; r < map.rivers.length; r++) {
    const river = map.rivers[r]!,
      mouth = river.at(-1)!
    if (terrain.sea(mouth.x, mouth.y) > 2 || terrain.navigationWater(mouth.x, mouth.y) < 25)
      continue
    const lengths = pathLengths(river),
      end = lengths.at(-1)!
    for (let i = 0; i < river.length; i++) {
      const ramp = Math.min(70, end),
        t = Math.max(0, (lengths[i]! - (end - ramp)) / Math.max(1, ramp)),
        width = map.riverWidths[r]![i]!
      map.riverWidths[r]![i] = width + (7.5 - width) * t * t
    }
  }
  function name(id: number) {
    // A bijection over the syllable pairs gives stable names independent of
    // which neighbouring places a moved navigation area removes.
    const n = (id * 131 + seed) % (roots.length * endings.length)
    return roots[n % roots.length]! + endings[Math.floor(n / roots.length)]!
  }
  for (let gy = 0; gy * 260 < height; gy++)
    for (let gx = 0; gx * 310 < width; gx++) {
      const id = gy * 32 + gx
      let best: Point | undefined,
        score = -Infinity
      for (let attempt = 0; attempt < 12; attempt++) {
        const p = {
          x: gx * 310 + 50 + random(seed + attempt, gx, gy) * 210,
          y: gy * 260 + 65 + random(seed + 30 + attempt, gx, gy) * 150,
        }
        const d = water(p.x, p.y)
        if (
          p.x > width - 40 ||
          p.y > height - 40 ||
          d < 45 ||
          inQuiet(p, 40) ||
          terrain.navigationWater(p.x, p.y) < 55
        )
          continue
        const value = -ridge(p.x, p.y) + random(seed, id, attempt) * 0.3
        if (value > score) {
          best = p
          score = value
        }
      }
      if (best && map.places.every((p) => distance(p, best!) > 145)) {
        map.places.push({
          ...best,
          id,
          name: name(id),
          kind: random(seed + 9, id) < 0.28 ? 'castle' : 'town',
          angle: 0,
        })
      }
    }
  // Ports occupy dry ground on a coast and face the same queried water field.
  // Small inland lakes have no room for harbour buildings and cranes.
  const proposedPorts: Place[] = []
  for (const town of map.places.slice()) {
    let port: Point | undefined,
      best = 185
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 16)
      for (let radius = 60; radius < 185; radius += 16) {
        const p = { x: town.x + Math.cos(angle) * radius, y: town.y + Math.sin(angle) * radius }
        if (p.x < 40 || p.y < 40 || p.x > width - 40 || p.y > height - 40) continue
        const d = water(p.x, p.y)
        if (
          !inQuiet(p, 40) &&
          d > 12 &&
          d < 28 &&
          !terrain.lakes.some(
            (lake) =>
              Math.min(lake.rx, lake.ry) < 28 &&
              distance(p, lake) < Math.max(lake.rx, lake.ry) + 65,
          ) &&
          terrain.navigationWater(p.x, p.y) > 50 &&
          radius < best &&
          [...map.places, ...proposedPorts].every((q) => distance(p, q) > 65)
        ) {
          port = p
          best = radius
        }
      }
    if (port) {
      const pier = placePier(port, water)
      if (!pier) continue
      proposedPorts.push({
        ...port,
        id: town.id + 100000,
        kind: 'port',
        name: `${town.name} Quay`,
        angle: pier.angle,
        pier: { offset: pier.offset, length: pier.length },
      })
    }
  }
  const lakePorts = new Map<number, Place>()
  for (const port of proposedPorts) {
    const lakeIndex = terrain.lakes.findIndex(
      (lake) => distance(port, lake) < Math.max(lake.rx, lake.ry) + 65,
    )
    if (lakeIndex < 0) {
      map.places.push(port)
      continue
    }
    const chosen = lakePorts.get(lakeIndex)
    if (!chosen || random(seed + 914, port.id) < random(seed + 914, chosen.id))
      lakePorts.set(lakeIndex, port)
  }
  map.places.push(...lakePorts.values())

  function segmentOnLand(a: Point, b: Point, margin = 8) {
    const n = Math.ceil(distance(a, b) / 8)
    for (let i = 0; i <= n; i++) {
      const t = i / Math.max(1, n)
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      if (water(p.x, p.y) < margin || distance(p, compass) < 66) return false
    }
    return true
  }
  const landCells = new WeakMap<Place, number>()
  function landCell(p: Place) {
    const cached = landCells.get(p)
    if (cached !== undefined) return cached
    const center = cell(p),
      cx = center % cols,
      cy = Math.floor(center / cols)
    let result = -1,
      nearest = Infinity
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx,
          y = cy + dy
        if (x < 0 || y < 0 || x >= cols || y >= rows) continue
        const id = y * cols + x,
          q = point(id),
          d = distance(p, q)
        if (d < nearest && segmentOnLand(p, q)) {
          result = id
          nearest = d
        }
      }
    landCells.set(p, result)
    return result
  }
  // Cache grid edges and connected components once. In particular an island
  // must not cause every failed MST candidate to repeat an exhaustive A* search.
  const landEdges = new Uint8Array(count),
    components = new Int32Array(count).fill(-1)
  const ridges = new Float32Array(count),
    shore = new Float32Array(count)
  for (let id = 0; id < count; id++) {
    const p = point(id),
      x = id % cols,
      y = Math.floor(id / cols)
    ridges[id] = ridge(p.x, p.y)
    shore[id] = water(p.x, p.y)
    if (shore[id]! < 8) continue
    directions.forEach(([dx, dy], index) => {
      if (x + dx < 0 || y + dy < 0 || x + dx >= cols || y + dy >= rows) return
      if (segmentOnLand(p, point((y + dy) * cols + x + dx)))
        landEdges[id] = landEdges[id]! | (1 << index)
    })
  }
  let component = 0
  for (let id = 0; id < count; id++) {
    if (!landEdges[id] || components[id]! >= 0) continue
    const queue = [id]
    components[id] = component
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head]!
      directions.forEach(([dx, dy], index) => {
        if (!(landEdges[current]! & (1 << index))) return
        const next = current + dy * cols + dx
        if (components[next]! >= 0) return
        components[next] = component
        queue.push(next)
      })
    }
    component++
  }
  function route(from: Place, to: Place, railway: boolean): Point[] {
    const onRoute = (a: Point, b: Point) => {
      if (!segmentOnLand(a, b)) return false
      if (!railway) return true
      const n = Math.ceil(distance(a, b) / 8)
      for (let i = 0; i <= n; i++) {
        const t = i / Math.max(1, n),
          p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
        if (water(p.x, p.y) < 34 && distance(p, from) > 60 && distance(p, to) > 60) return false
      }
      return true
    }
    const start = landCell(from),
      end = landCell(to)
    if (start < 0 || end < 0 || components[start] !== components[end]) return []
    const costs = new Float32Array(count).fill(Infinity),
      previous = new Int32Array(count).fill(-1)
    const open = new MinHeap(),
      closed = new Uint8Array(count)
    costs[start] = 0
    open.push(start, 0)
    while (open.size) {
      const current = open.pop().id
      if (closed[current]) continue
      if (current === end) {
        const path: Point[] = [to]
        let next = current
        while (next !== start && next >= 0) {
          path.push(point(next))
          next = previous[next]!
        }
        path.push(from)
        path.reverse()
        // Greedy visibility simplification, then soften corners only where the
        // smoothed segments remain on land. No bridge may span an inland sea.
        const simple: Point[] = [from]
        for (let i = 0; i < path.length - 1;) {
          let j = Math.min(path.length - 1, i + 8)
          while (j > i + 1 && !onRoute(path[i]!, path[j]!)) j--
          simple.push(path[j]!)
          i = j
        }
        let smooth = simple
        for (let pass = 0; pass < 2; pass++) {
          const nextPath: Point[] = [smooth[0]!]
          for (let i = 0; i < smooth.length - 1; i++) {
            const a = smooth[i]!,
              b = smooth[i + 1]!
            const q = { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }
            const r = { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 }
            if (onRoute(nextPath.at(-1)!, q) && onRoute(q, r)) nextPath.push(q, r)
            else nextPath.push(a, b)
          }
          nextPath.push(smooth.at(-1)!)
          if (nextPath.every((p, i) => !i || onRoute(nextPath[i - 1]!, p))) smooth = nextPath
        }
        return smooth
      }
      closed[current] = 1
      const x = current % cols,
        y = Math.floor(current / cols)
      for (let direction = 0; direction < directions.length; direction++) {
        if (!(landEdges[current]! & (1 << direction))) continue
        const [dx, dy] = directions[direction]!
        const nx = x + dx,
          ny = y + dy
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
        const next = ny * cols + nx,
          b = point(next)
        if (closed[next]) continue
        if (railway && shore[next]! < 46 && distance(b, from) > 72 && distance(b, to) > 72) continue
        const slope = Math.abs(heights[next]! - heights[current]!)
        const cost =
          costs[current]! +
          Math.hypot(dx, dy) *
            (1 +
              ridges[next]! * (railway ? 8 : 3) +
              slope * (railway ? 14 : 5) +
              Math.max(0, 90 - shore[next]!) / (railway ? 9 : 60))
        if (cost >= costs[next]!) continue
        costs[next] = cost
        previous[next] = current
        open.push(next, cost + distance(b, to) / step)
      }
    }
    return []
  }
  // A harbour belongs to its named settlement, not just whichever node the
  // spanning tree happens to reach first. Reject unreachable shore sites.
  map.places = map.places.filter((port) => {
    if (port.kind !== 'port') return true
    const town = map.places.find((p) => p.id === port.id - 100000)!
    const points = route(town, port, false)
    if (points.length < 2) return false
    map.roads.push({ from: town.id, to: port.id, points })
    return true
  })
  // Kruskal's graph: if two nodes share reachable land, the network connects
  // them; disconnected islands never receive a straight line across the sea.
  const links: { a: Place; b: Place; length: number }[] = []
  for (let i = 0; i < map.places.length; i++)
    for (let j = i + 1; j < map.places.length; j++) {
      const a = map.places[i]!,
        b = map.places[j]!
      links.push({ a, b, length: distance(a, b) })
    }
  links.sort((a, b) => a.length - b.length)
  const groups = new Map(map.places.map((p) => [p.id, p.id]))
  function group(id: number): number {
    const p = groups.get(id)!
    return p === id ? id : group(p)
  }
  // Keep unaffected links and only plan missing connections. Resizing or
  // moving the navigation sea must not rearrange distant towns' rail network.
  const placesById = new Map(map.places.map((place) => [place.id, place]))
  const validOldRoute = (route: MapData['rails'][number], railway: boolean) => {
    const from = placesById.get(route.from),
      to = placesById.get(route.to)
    if (
      !from ||
      !to ||
      distance(from, route.points[0]!) > 1 ||
      distance(to, route.points.at(-1)!) > 1
    )
      return false
    return route.points.every((p, i) => {
      if (i && !segmentOnLand(route.points[i - 1]!, p)) return false
      return !railway || water(p.x, p.y) >= 34 || distance(p, from) < 80 || distance(p, to) < 80
    })
  }
  for (const rail of previous?.rails || []) {
    if (!validOldRoute(rail, true)) continue
    const ga = group(rail.from),
      gb = group(rail.to)
    if (ga === gb) continue
    groups.set(ga, gb)
    map.rails.push(rail)
  }
  map.roads.push(
    ...(previous?.roads || []).filter(
      (road) =>
        validOldRoute(road, false) &&
        !map.roads.some((r) => r.from === road.from && r.to === road.to),
    ),
  )
  for (const port of map.places.filter((p) => p.kind === 'port')) {
    const town = placesById.get(port.id - 100000)!
    if (
      map.rails.some(
        (r) => (r.from === town.id && r.to === port.id) || (r.to === town.id && r.from === port.id),
      )
    )
      continue
    const points = route(town, port, true)
    if (points.length < 2) continue
    map.rails.push({ from: town.id, to: port.id, points })
    const ga = group(town.id),
      gb = group(port.id)
    if (ga !== gb) groups.set(ga, gb)
  }
  for (const link of links) {
    const ga = group(link.a.id),
      gb = group(link.b.id)
    if (ga === gb) continue
    const rail = route(link.a, link.b, true)
    if (rail.length < 2) continue
    groups.set(ga, gb)
    map.rails.push({ points: rail, from: link.a.id, to: link.b.id })
    if (map.roads.some((r) => r.from === link.a.id && r.to === link.b.id)) continue
    const road = route(link.a, link.b, false)
    if (road.length > 1) map.roads.push({ points: road, from: link.a.id, to: link.b.id })
  }
  // A narrow neck may be walkable but too close to the coast for rails.
  // Keep the rail clearance and connect such districts by road instead.
  for (const road of map.roads) {
    const ga = group(road.from),
      gb = group(road.to)
    if (ga !== gb) groups.set(ga, gb)
  }
  for (const link of links) {
    const ga = group(link.a.id),
      gb = group(link.b.id)
    if (ga === gb) continue
    const points = route(link.a, link.b, false)
    if (points.length < 2) continue
    map.roads.push({ points, from: link.a.id, to: link.b.id })
    groups.set(ga, gb)
  }
  for (const link of links.slice(0, map.places.length * 2)) {
    if (
      random(seed + 64, link.a.id, link.b.id) > 0.12 ||
      map.roads.some((r) => r.from === link.a.id && r.to === link.b.id)
    )
      continue
    const road = route(link.a, link.b, false)
    if (road.length > 1) map.roads.push({ points: road, from: link.a.id, to: link.b.id })
  }

  const crossingLines = new LineIndex([...map.rivers, ...map.roads.map((r) => r.points)])
  for (const rail of map.rails)
    for (let i = 1; i < rail.points.length; i++) {
      const a = rail.points[i - 1]!,
        b = rail.points[i]!
      for (const hit of crossingLines.crossings(a, b)) {
        if (
          map.places.every((p) => distance(p, hit) > 30) &&
          map.bridges.every((p) => distance(p, hit) > 30)
        )
          map.bridges.push({ ...hit, angle: Math.atan2(b.y - a.y, b.x - a.x), length: 19 })
      }
    }

  const lineIndices = new WeakMap<Point[][], LineIndex>()
  const nearLines = (p: Point, paths: Point[][], margin: number) => {
    let index = lineIndices.get(paths)
    if (!index) {
      index = new LineIndex(paths)
      lineIndices.set(paths, index)
    }
    return index.near(p, margin)
  }
  const routes = [...map.roads, ...map.rails].map((r) => r.points)
  for (let gy = 0; gy * 17 < height; gy++)
    for (let gx = 0; gx * 19 < width; gx++) {
      const x = gx * 19 + random(seed, gx, gy) * 15,
        y = gy * 17 + random(seed + 1, gx, gy) * 13
      const p = { x, y },
        d = water(x, y)
      if (
        d < (terrain.isIsland(x, y) ? 5 : 20) ||
        inQuiet(p, 12) ||
        map.places.some((t) => distance(t, p) < 43) ||
        nearLines(p, map.rivers, 9) ||
        nearLines(p, routes, 8)
      )
        continue
      const r = ridge(x, y),
        forest = noise(seed + 108, x / 160, y / 160),
        chance = random(seed + 16, gx, gy),
        onIsland = terrain.isIsland(x, y)
      const kind = onIsland
        ? chance < 0.16
          ? 'grass'
          : chance > 0.89
            ? 'tree'
            : null
        : r > 0.55 && d > 50
          ? 'mountain'
          : r > 0.36
            ? 'hill'
            : forest > 0.6
              ? random(seed + 117, gx, gy) > 0.35
                ? 'pine'
                : 'tree'
              : chance < 0.08
                ? 'grass'
                : chance > 0.97
                  ? 'tree'
                  : null
      if (
        !kind ||
        (kind === 'mountain' && chance < 0.68) ||
        (kind === 'hill' && chance < 0.7) ||
        (forest > 0.6 && chance < 0.32)
      )
        continue
      map.symbols.push({
        x,
        y,
        kind,
        size: kind === 'mountain' ? 15 + chance * 14 : kind === 'hill' ? 9 : 4 + chance * 3,
      })
    }
  map.symbols.sort((a, b) => a.y - b.y)

  const occupied: { x: number; y: number; width: number; height: number }[] = map.places.map(
    (p) => ({ x: p.x - 28, y: p.y - 35, width: 56, height: 46 }),
  )
  if (navigation)
    occupied.push({
      x: navigation.x - 22,
      y: navigation.y - 24,
      width: navigation.width + 44,
      height: navigation.height + 48,
    })
  occupied.push(...quiet)
  const symbolsNearY = function* (y: number, radius: number) {
    const min = y - radius,
      max = y + radius
    let low = 0,
      high = map.symbols.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (map.symbols[mid]!.y < min) low = mid + 1
      else high = mid
    }
    for (let i = low; i < map.symbols.length; i++) {
      const symbol = map.symbols[i]!
      if (symbol.y > max) break
      if (Math.abs(symbol.y - y) < radius) yield symbol
    }
  }
  const label = (text: string, candidates: Point[], size: number, region = false) => {
    if (map.labels.some((label) => label.text === text)) return
    const w = text.length * size * (region ? 0.66 : 0.53)
    const placements = region
      ? candidates
          .map((p) => {
            let density = 0
            for (const symbol of symbolsNearY(p.y, 40))
              if (Math.abs(symbol.x - p.x) < w * 0.6) density++
            return { p, density }
          })
          .sort((a, b) => a.density - b.density)
          .map(({ p }) => p)
      : candidates
    placement: for (const p of placements) {
      const box = { x: p.x - w / 2 - 3, y: p.y - size - 2, width: w + 6, height: size + 7 }
      if (
        box.x < 15 ||
        box.y < 15 ||
        box.x + box.width > width - 15 ||
        box.y + box.height > height - 15
      )
        continue
      if (
        occupied.some(
          (o) =>
            box.x < o.x + o.width &&
            box.x + box.width > o.x &&
            box.y < o.y + o.height &&
            box.y + box.height > o.y,
        )
      )
        continue
      if (nearLines(p, map.rivers, 12) || nearLines(p, routes, 12)) continue
      for (const symbol of symbolsNearY(p.y, 22))
        if (symbol.kind === 'mountain' && Math.abs(symbol.x - p.x) < w / 2 + 12) continue placement
      occupied.push(box)
      map.labels.push({ ...p, text, size, region })
      return
    }
  }
  for (const p of map.places)
    label(
      p.name,
      [
        { x: p.x, y: p.y - 42 },
        { x: p.x, y: p.y + 29 },
        { x: p.x + 70, y: p.y - 15 },
        { x: p.x - 70, y: p.y - 15 },
      ],
      12,
    )
  for (const lake of terrain.lakes)
    label(
      `Lacus ${name(Math.round(lake.x) + 500000)}`,
      [
        { x: lake.x, y: lake.y - lake.ry - 13 },
        { x: lake.x, y: lake.y + lake.ry + 23 },
      ],
      11,
    )
  for (let y = 150; y < height; y += 430)
    for (let x = 230; x < width; x += 570) {
      if (water(x, y) < 65 || terrain.navigationWater(x, y) < 80) continue
      const title = `${ridge(x, y) > 0.45 ? 'ALPES' : 'TERRA'} ${name((x + y) * 10 + 700000).toUpperCase()}`
      label(
        title,
        [
          { x, y },
          { x: x + 40, y: y + 65 },
          { x: x - 40, y: y - 65 },
        ],
        16,
        true,
      )
    }
  // Sparse animated ink waves and closed, strictly water-only ship paths.
  map.symbols = map.symbols.filter(
    (symbol) =>
      !map.labels.some(
        (label) =>
          Math.abs(symbol.x - label.x) <
            label.text.length * label.size * (label.region ? 0.34 : 0.28) +
              (label.region ? 14 : 5) &&
          symbol.y > label.y - label.size - (label.region ? 16 : 3) &&
          symbol.y < label.y + (label.region ? 22 : 12),
      ),
  )
  for (let y = 25; y < height; y += 66)
    for (let x = 25; x < width; x += 88) {
      const p = { x: x + random(seed, x, y) * 30, y: y + random(seed + 3, x, y) * 24 }
      if (!inQuiet(p, 10) && water(p.x, p.y) < -20 && terrain.navigationWater(p.x, p.y) > 30)
        map.waves.push(p)
      if (
        !inQuiet(p, 100) &&
        water(p.x, p.y) < -55 &&
        map.ships.length < 10 &&
        map.ships.every((path) => distance(path[0]!, p) > 260)
      ) {
        for (const shrink of [1, 0.65, 0.4]) {
          const path: Point[] = []
          for (let i = 0; i <= 80; i++) {
            const angle = (i / 80) * Math.PI * 2
            const vertical = seed % 4 < 2
            const q = {
              x: p.x + Math.cos(angle) * (vertical ? 24 : 75) * shrink,
              y: p.y + Math.sin(angle) * (vertical ? 75 : 24) * shrink,
            }
            if (
              water(q.x, q.y) > -28 ||
              q.x < 20 ||
              q.y < 30 ||
              q.x > width - 20 ||
              q.y > height - 20
            )
              break
            path.push(q)
          }
          if (path.length === 81) {
            map.ships.push(path)
            break
          }
        }
      }
    }
  if (previous) {
    const retained = previous.ships.filter((path) =>
      path.every((p) => water(p.x, p.y) < -28 && !inQuiet(p, 30)),
    )
    map.ships = [
      ...retained,
      ...map.ships.filter((path) => retained.every((old) => distance(old[0]!, path[0]!) > 200)),
    ].slice(0, 10)
  }
  return map
}
