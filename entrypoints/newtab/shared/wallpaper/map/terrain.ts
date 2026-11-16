import { noise, random, type MapRequest, type MapField } from './model'

export function createTerrain(request: MapRequest) {
  const { seed, anchorWidth, anchorHeight, viewWidth, viewHeight, navigation } = request
  const edge = seed % 4
  const edges = [edge]
  if (random(seed + 626, 0) < 0.48)
    edges.push(
      edge < 2 ? 2 + Math.floor(random(seed + 627, 0) * 2) : Math.floor(random(seed + 627, 0) * 2),
    )
  // Keep the sea depth stable while anchoring right and bottom shores to the viewport.
  const depth = Math.min(anchorWidth, anchorHeight) * (0.17 + random(seed, 19) * 0.15)
  const lakes: { x: number; y: number; rx: number; ry: number }[] = []
  function sea(x: number, y: number) {
    let value = Infinity
    for (const [i, side] of edges.entries()) {
      const across =
        side === 0 ? x : side === 1 ? viewWidth - x : side === 2 ? y : viewHeight - y
      const along = side < 2 ? y : x
      const reach = depth * (i ? 0.65 + random(seed + 628, 0) * 0.2 : 1)
      const shore =
        reach +
        (noise(seed + 3 + i * 17, along / 260, 0) - 0.5) * reach * 1.5 +
        17 * Math.sin(along / 43 + seed + i * 2) +
        (noise(seed + 104 + i * 17, along / 17, 0) - 0.5) * 5
      value = Math.min(value, across - shore)
    }
    return value
  }
  function navigationWater(x: number, y: number) {
    if (!navigation) return Infinity
    // Organic inland water occupies most of the navigation backdrop. Unlike a
    // UI panel its contour may retreat under the outer icons and group tabs.
    if (request.showNavigationLake === false) return Infinity
    const size = Math.max(40, Math.min(200, request.navigationLakeSize ?? 100)) / 100
    const rx = (navigation.width * 0.44 + 8) * size,
      ry = Math.max(navigation.height * 0.5 + 8, Math.min(112, Math.max(62, rx * 0.38))) * size
    const dx = (x - navigation.x - navigation.width * 0.51) / rx
    const dy = (y - navigation.y - navigation.height * 0.55) / ry
    const angle = Math.atan2(dy, dx)
    const rim =
      1 +
      0.1 * Math.sin(angle * 3 + seed) +
      0.065 * Math.sin(angle * 5 - seed * 0.3) +
      0.03 * Math.sin(angle * 9 + seed)
    return (Math.hypot(dx, dy) - rim) / Math.hypot(Math.cos(angle) / rx, Math.sin(angle) / ry)
  }
  // Use stable candidate positions relative to the shore that moves with the viewport.
  const islands: { x: number; y: number; rx: number; ry: number }[] = []
  const islandLimit = Math.max(0, Math.min(10, request.islandLimit ?? 3))
  if (islandLimit && random(seed + 906, 0) < 0.72) {
    const target = 1 + Math.floor(random(seed + 907, 0) * islandLimit)
    const candidates: { x: number; y: number; originalX: number; originalY: number; rank: number }[] = []
    const offsetX = edges.includes(1) ? viewWidth - anchorWidth : 0,
      offsetY = edges.includes(3) ? viewHeight - anchorHeight : 0
    for (let y = 75; y < anchorHeight - 75; y += 85)
      for (let x = 75; x < anchorWidth - 75; x += 85) {
        const px = x + (random(seed + 908, x, y) - 0.5) * 70,
          py = y + (random(seed + 909, x, y) - 0.5) * 70,
          islandX = px + offsetX,
          islandY = py + offsetY
        if (
          islandX >= 0 &&
          islandY >= 0 &&
          islandX < viewWidth &&
          islandY < viewHeight &&
          sea(islandX, islandY) < -145 &&
          navigationWater(islandX, islandY) > 125
        )
          candidates.push({
            x: islandX,
            y: islandY,
            originalX: px,
            originalY: py,
            rank: random(seed + 910, x, y),
          })
      }
    candidates.sort((a, b) => a.rank - b.rank)
    for (const p of candidates) {
      if (islands.length >= target) break
      const rx = 19 + random(seed + 911, p.originalX, p.originalY) * 27,
        ry = 15 + random(seed + 912, p.originalX, p.originalY) * 23
      if (islands.some((other) => Math.hypot(p.x - other.x, p.y - other.y) < 150)) continue
      islands.push({ x: p.x, y: p.y, rx, ry })
    }
  }
  function islandLand(x: number, y: number) {
    let value = -Infinity
    for (const island of islands) {
      if (Math.abs(x - island.x) > island.rx + 15 || Math.abs(y - island.y) > island.ry + 15)
        continue
      const angle = Math.atan2(y - island.y, x - island.x)
      const rim = 1 + 0.1 * Math.sin(angle * 5 + seed) + 0.05 * Math.sin(angle * 9 - seed)
      value = Math.max(
        value,
        (rim - Math.hypot((x - island.x) / island.rx, (y - island.y) / island.ry)) *
          Math.min(island.rx, island.ry),
      )
    }
    return value
  }
  for (let y = 160; y < request.height + 300; y += 360) {
    for (let x = 150; x < request.width + 300; x += 460) {
      if (random(seed + 71, x, y) > 0.47) continue
      const px = x + random(seed, x, y) * 150,
        py = y + random(seed + 1, x, y) * 140
      if (sea(px, py) < 110 || navigationWater(px, py) < 140) continue
      lakes.push({
        x: px,
        y: py,
        rx: 24 + random(seed + 2, x, y) * 28,
        ry: 16 + random(seed + 3, x, y) * 22,
      })
    }
  }
  function water(x: number, y: number) {
    let value = Math.min(Math.max(sea(x, y), islandLand(x, y)), navigationWater(x, y))
    for (const lake of lakes) {
      if (Math.abs(x - lake.x) > lake.rx + 35 || Math.abs(y - lake.y) > lake.ry + 35) continue
      const angle = Math.atan2(y - lake.y, x - lake.x)
      const d =
        (Math.hypot((x - lake.x) / lake.rx, (y - lake.y) / lake.ry) -
          1 -
          0.1 * Math.sin(angle * 5 + seed)) *
        lake.ry
      value = Math.min(value, d)
    }
    return (
      value +
      (noise(seed + 302, x / 17, y / 17) - 0.5) * 3 +
      (noise(seed + 303, x / 7, y / 7) - 0.5)
    )
  }
  function ridge(x: number, y: number) {
    return Math.pow(1 - Math.abs(noise(seed + 34, x / 230, y / 230) * 2 - 1), 5)
  }
  function elevation(x: number, y: number) {
    const d = water(x, y)
    return d < 0
      ? -0.15
      : Math.min(d / 280, 0.5) + ridge(x, y) * 0.9 + noise(seed + 9, x / 500, y / 500) * 0.3
  }
  const isIsland = (x: number, y: number) => islandLand(x, y) > 0
  return { water, sea, navigationWater, elevation, ridge, lakes, islands, isIsland, edges }
}

// Shared binary heap for drainage and route searches; no linear open-set scan.
export function sampleMapField(request: MapRequest): MapField {
  const step = 12,
    cols = Math.ceil(request.width / step) + 1,
    rows = Math.ceil(request.height / step) + 1,
    values = new Float32Array(cols * rows)
  const { water } = createTerrain(request)
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) values[y * cols + x] = water(x * step, y * step)
  // The analytic terrain field is only distance-like near the shore. Its lake
  // culling bounds and elliptical centres must never become animated contours.
  // Seed subcell shore distances, then sweep to a continuous signed field.
  const distances = new Float32Array(values.length).fill(Infinity)
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x,
        value = values[i]!
      for (const j of [
        x > 0 ? i - 1 : i,
        x + 1 < cols ? i + 1 : i,
        y > 0 ? i - cols : i,
        y + 1 < rows ? i + cols : i,
      ]) {
        const other = values[j]!
        if (value < 0 !== other < 0)
          distances[i] = Math.min(
            distances[i]!,
            (step * Math.abs(value)) / (Math.abs(value) + Math.abs(other)),
          )
      }
    }
  for (const direction of [1, -1])
    for (let yy = 0; yy < rows; yy++)
      for (let xx = 0; xx < cols; xx++) {
        const x = direction > 0 ? xx : cols - 1 - xx,
          y = direction > 0 ? yy : rows - 1 - yy,
          i = y * cols + x
        for (const [dx, dy] of [
          [-direction, 0],
          [-direction, -direction],
          [0, -direction],
          [direction, -direction],
        ]) {
          const nx = x + dx!,
            ny = y + dy!
          if (nx >= 0 && nx < cols && ny >= 0 && ny < rows)
            distances[i] = Math.min(
              distances[i]!,
              distances[ny * cols + nx]! + step * Math.hypot(dx!, dy!),
            )
        }
      }
  for (let i = 0; i < values.length; i++)
    values[i] =
      (values[i]! < 0 ? -1 : 1) *
      (Number.isFinite(distances[i]) ? distances[i]! : Math.abs(values[i]!))
  return { values, cols, rows, step }
}

export class MinHeap {
  private items: { id: number; cost: number }[] = []
  get size() {
    return this.items.length
  }
  push(id: number, cost: number) {
    const item = { id, cost }
    let i = this.items.length
    this.items.push(item)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.items[parent]!.cost <= cost) break
      this.items[i] = this.items[parent]!
      i = parent
    }
    this.items[i] = item
  }
  pop() {
    const first = this.items[0]!
    const last = this.items.pop()!
    if (!this.items.length) return first
    let i = 0
    while (i * 2 + 1 < this.items.length) {
      let child = i * 2 + 1
      if (child + 1 < this.items.length && this.items[child + 1]!.cost < this.items[child]!.cost)
        child++
      if (this.items[child]!.cost >= last.cost) break
      this.items[i] = this.items[child]!
      i = child
    }
    this.items[i] = last
    return first
  }
}
