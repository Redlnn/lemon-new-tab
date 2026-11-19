import { paintCompass, paintLabel } from './annotations'
import {
  noise,
  random,
  pathLengths,
  samplePath,
  type MapData,
  type MapRequest,
  type MapCounts,
  type Place,
  type Point,
  type Symbol,
} from './model'
import { paperColor, paperTexture } from './paper'

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
const ink = '#654323',
  paper = '#efdcae',
  waterColor = '#f7e5b8'
function path(ctx: Context, points: Point[], close = false) {
  if (!points.length) return
  ctx.moveTo(points[0]!.x, points[0]!.y)
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i]!.x, points[i]!.y)
  if (close) ctx.closePath()
}
function symbol(ctx: Context, s: Symbol, seed: number) {
  ctx.save()
  ctx.translate(s.x, s.y)
  ctx.lineWidth = (s.kind === 'mountain' ? 0.85 : 0.65) * 1.25
  ctx.strokeStyle = ink
  ctx.fillStyle = paperColor(seed, s.x, s.y)
  const z = s.size
  ctx.beginPath()
  if (s.kind === 'mountain') {
    ctx.moveTo(-z * 0.8, 4)
    ctx.quadraticCurveTo(-z * 0.3, -z * 0.82, -z * 0.15, -z)
    ctx.quadraticCurveTo(-z * 0.1, -z * 1.07, -z * 0.04, -z * 0.98)
    ctx.quadraticCurveTo(z * 0.38, -z * 0.52, z * 0.8, 4)
    ctx.closePath()
    ctx.fill()
    ctx.save()
    ctx.clip()
    ctx.beginPath()
    ctx.moveTo(-z * 0.8, 4)
    ctx.quadraticCurveTo(-z * 0.3, -z * 0.82, -z * 0.15, -z)
    ctx.quadraticCurveTo(-z * 0.1, -z * 1.07, -z * 0.04, -z * 0.98)
    ctx.quadraticCurveTo(z * 0.38, -z * 0.52, z * 0.8, 4)
    ctx.moveTo(-z * 0.12, -z)
    ctx.lineTo(z * 0.02, -z * 0.4)
    ctx.lineTo(z * 0.2, -z * 0.24)
    ctx.lineTo(z * 0.18, -z * 0.08)
    for (let i = 0.15; i < 0.95; i += 0.12) {
      ctx.moveTo(-z * 0.12 + i * z * 0.92, -z + i * (z + 4))
      ctx.lineTo(-z * 0.12 + i * z * 0.58, -z + i * (z + 4) + z * 0.26)
    }
    ctx.stroke()
    ctx.restore()
    ctx.restore()
    return
  } else if (s.kind === 'hill') {
    ctx.moveTo(-z, 0)
    ctx.quadraticCurveTo(0, -z * 1.05, z, 0)
    ctx.moveTo(0, -z * 0.4)
    ctx.lineTo(z * 0.25, 0)
    ctx.moveTo(z * 0.3, -z * 0.27)
    ctx.lineTo(z * 0.48, 0)
  } else if (s.kind === 'pine') {
    ctx.moveTo(-z * 0.7, 0)
    ctx.quadraticCurveTo(-z * 0.6, -z * 0.5, -z * 0.32, -z * 0.65)
    ctx.lineTo(-z * 0.5, -z * 0.65)
    ctx.quadraticCurveTo(-z * 0.3, -z * 1.4, 0, -z * 1.8)
    ctx.quadraticCurveTo(z * 0.3, -z * 1.4, z * 0.5, -z * 0.65)
    ctx.lineTo(z * 0.32, -z * 0.65)
    ctx.quadraticCurveTo(z * 0.6, -z * 0.5, z * 0.7, 0)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, 4)
    ctx.lineTo(0, -z * 0.9)
    ctx.moveTo(-z * 0.35, -z * 0.5)
    ctx.lineTo(z * 0.3, -z * 0.5)
  } else if (s.kind === 'tree') {
    ctx.moveTo(0, 4)
    ctx.lineTo(0, -z * 0.6)
    ctx.moveTo(z * 0.64, -z * 1.15)
    ctx.ellipse(0, -z * 1.15, z * 0.64, z * 0.85, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.moveTo(1, -z * 0.8)
    ctx.lineTo(z * 0.35, -z * 1.1)
  } else {
    ctx.moveTo(-4, 0)
    ctx.lineTo(4, 0)
    ctx.moveTo(0, -1)
    ctx.lineTo(0, -5)
    ctx.moveTo(-2, -1)
    ctx.lineTo(-3, -4)
    ctx.moveTo(2, -1)
    ctx.lineTo(3, -4)
  }
  ctx.stroke()
  ctx.restore()
}
function house(ctx: Context, x: number, y: number, w: number, h: number, spire = false) {
  ctx.beginPath()
  ctx.roundRect(x - w / 2, y - h, w, h, 1)
  ctx.moveTo(x - w / 2 - 1, y - h)
  const peak = y - h - w * (spire ? 1.05 : 0.65)
  ctx.quadraticCurveTo(x - 1, peak - 1, x, peak)
  ctx.quadraticCurveTo(x + 2, peak + 2, x + w / 2 + 1, y - h)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x, y - h * 0.64)
  ctx.lineTo(x, y - h * 0.46)
  ctx.moveTo(x - 1, y)
  ctx.lineTo(x - 1, y - 3)
  ctx.lineTo(x + 1, y - 3)
  ctx.lineTo(x + 1, y)
  ctx.stroke()
}
function settlement(ctx: Context, place: Place) {
  ctx.save()
  ctx.translate(place.x, place.y)
  ctx.lineWidth = 0.8 * 1.25
  ctx.fillStyle = paper
  ctx.strokeStyle = ink
  if (place.kind === 'port') {
    // Warehouse, quay approach, mooring posts and a small lifting crane.
    house(ctx, -10, 0, 14, 10)
    house(ctx, 3, -1, 10, 13)
    ctx.save()
    ctx.rotate(place.angle)
    const start = place.pier?.offset || 0,
      end = start + (place.pier?.length || 0)
    ctx.beginPath()
    ctx.moveTo(6, -2)
    ctx.lineTo(start, -2)
    ctx.lineTo(start, 2)
    ctx.lineTo(6, 2)
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(start, -4)
    ctx.lineTo(end, -4)
    ctx.lineTo(end, 4)
    ctx.lineTo(start, 4)
    ctx.closePath()
    for (let x = start + 3; x < end; x += 4) {
      ctx.moveTo(x, -4)
      ctx.lineTo(x, 4)
    }
    ctx.stroke()
    for (const x of [start, end])
      for (const y of [-5, 5]) {
        ctx.beginPath()
        ctx.arc(x, y, 1.1, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
    ctx.beginPath()
    ctx.moveTo(start + 7, -4)
    ctx.lineTo(start + 7, -15)
    ctx.lineTo(start + 18, -9)
    ctx.lineTo(start + 17, -4)
    ctx.moveTo(start + 7, -12)
    ctx.lineTo(start + 15, -9)
    ctx.stroke()
    ctx.restore()
  } else if (place.kind === 'castle') {
    house(ctx, -13, 1, 10, 19, true)
    house(ctx, 12, 1, 10, 19, true)
    house(ctx, 0, -5, 14, 23, true)
    ctx.beginPath()
    ctx.rect(-14, -9, 28, 13)
    ctx.fill()
    ctx.stroke()
    for (let x = -14; x < 14; x += 5) ctx.strokeRect(x, -12, 3, 3)
    ctx.beginPath()
    ctx.moveTo(-3, 4)
    ctx.lineTo(-3, -2)
    ctx.arc(0, -2, 3, Math.PI, 0)
    ctx.lineTo(3, 4)
    ctx.stroke()
  } else {
    house(ctx, -14, -4, 9, 11)
    house(ctx, 0, -7, 11, 18, true)
    house(ctx, 13, -3, 10, 12)
    house(ctx, -19, 5, 8, 8)
    house(ctx, -7, 6, 10, 10)
    house(ctx, 6, 6, 9, 9)
    house(ctx, 20, 5, 8, 10)
  }
  ctx.beginPath()
  ctx.moveTo(-12, 11)
  ctx.lineTo(13, 11)
  ctx.moveTo(-7, 14)
  ctx.lineTo(10, 14)
  ctx.stroke()
  ctx.restore()
}
export function paintTerrain(
  ctx: Context,
  map: Pick<MapData, 'width' | 'height' | 'seed' | 'coast' | 'waterPolygons'>,
  scale: number,
  shoreline = true,
) {
  const { width, height, seed } = map
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.fillStyle = paper
  ctx.fillRect(0, 0, width, height)
  const texture = paperTexture(seed, width, height)
  ctx.drawImage(texture, 0, 0, texture.width * 4, texture.height * 4)
  ctx.beginPath()
  for (const polygon of map.waterPolygons) path(ctx, polygon, true)
  ctx.fillStyle = waterColor
  ctx.fill()
  ctx.save()
  ctx.clip()
  ctx.globalAlpha = 0.15
  for (let y = 0; y < height; y += 38)
    for (let x = 0; x < width; x += 45) {
      ctx.fillStyle = random(seed, x, y) > 0.5 ? '#fff5d5' : '#b9a372'
      ctx.fillRect(x + random(seed + 2, x, y) * 30, y + random(seed + 3, x, y) * 30, 0.8, 0.8)
    }
  ctx.restore()
  if (shoreline) paintCoast(ctx, map.coast, seed)
}

export function paintCoast(ctx: Context, coast: MapData['coast'], seed: number) {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  coast.forEach((segments, i) => {
    for (let band = 0; band < 3; band++) {
      ctx.beginPath()
      for (const segment of segments) {
        if (
          Math.min(2, Math.floor(noise(seed + 44, segment[0]!.x / 60, segment[0]!.y / 60) * 3)) ===
          band
        )
          path(ctx, segment)
      }
      ctx.strokeStyle = i === 0 ? '#625137' : '#a39269'
      ctx.lineWidth = (i === 0 ? 1.35 + band * 0.4 : 0.6 + band * 0.18) * 1.25
      ctx.stroke()
    }
  })
}

export function paintMapDetails(ctx: Context, map: MapData, request: MapRequest) {
  ctx.setTransform(request.scale, 0, 0, request.scale, 0, 0)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const { width, height, seed } = map
  ctx.save()
  ctx.strokeStyle = 'rgba(101,67,35,0.24)'
  ctx.lineWidth = 0.8
  ctx.setLineDash([3, 7])
  const reach = Math.hypot(width, height) + 100
  for (let i = 0; i < 16; i++) {
    const angle = (i * Math.PI) / 8,
      dx = Math.cos(angle),
      dy = Math.sin(angle)
    ctx.beginPath()
    ctx.moveTo(map.compass.x + dx * 54, map.compass.y + dy * 54)
    ctx.lineTo(map.compass.x + dx * reach, map.compass.y + dy * reach)
    ctx.stroke()
  }
  ctx.restore()
  ctx.fillStyle = '#786c50'
  for (const [r, river] of map.rivers.entries()) {
    ctx.beginPath()
    // A filled ribbon follows the finely sampled curve with continuously
    // varying width, instead of many constant-width overlapping strokes.
    for (const side of [-1, 1]) {
      for (let j = 0; j < river.length; j++) {
        const i = side === -1 ? j : river.length - 1 - j,
          p = river[i]!,
          a = river[Math.max(0, i - 1)]!,
          b = river[Math.min(river.length - 1, i + 1)]!,
          length = Math.hypot(b.x - a.x, b.y - a.y) || 1,
          half = (map.riverWidths[r]![i]! / 2) * side,
          x = p.x - ((b.y - a.y) / length) * half,
          y = p.y + ((b.x - a.x) / length) * half
        if (side === -1 && j === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
    }
    ctx.closePath()
    ctx.fill()
  }
  ctx.strokeStyle = '#8f7e5c'
  ctx.lineWidth = 0.8 * 1.25
  ctx.setLineDash([3.5, 3])
  for (const road of map.roads) {
    ctx.beginPath()
    path(ctx, road.points)
    ctx.stroke()
  }
  ctx.setLineDash([])
  for (const rail of map.rails) {
    const lengths = pathLengths(rail.points),
      total = lengths.at(-1)!
    ctx.strokeStyle = '#716044'
    ctx.lineWidth = 0.6 * 1.25
    for (const side of [-1.5, 1.5]) {
      ctx.beginPath()
      for (let d = 0; d <= total; d += 3) {
        const p = samplePath(rail.points, lengths, d),
          x = p.x - Math.sin(p.angle) * side,
          y = p.y + Math.cos(p.angle) * side
        if (d === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    ctx.beginPath()
    for (let d = 0; d < total; d += 7) {
      const p = samplePath(rail.points, lengths, d),
        dx = Math.sin(p.angle) * 3,
        dy = Math.cos(p.angle) * 3
      ctx.moveTo(p.x - dx, p.y + dy)
      ctx.lineTo(p.x + dx, p.y - dy)
    }
    ctx.stroke()
  }
  for (const bridge of map.bridges) {
    ctx.save()
    ctx.translate(bridge.x, bridge.y)
    ctx.rotate(bridge.angle)
    ctx.fillStyle = paper
    ctx.fillRect(-bridge.length / 2, -4, bridge.length, 8)
    ctx.strokeStyle = ink
    ctx.lineWidth = 0.8 * 1.25
    ctx.beginPath()
    for (const y of [-4, 4]) {
      ctx.moveTo(-bridge.length / 2, y)
      ctx.lineTo(bridge.length / 2, y)
    }
    for (let x = -bridge.length / 2; x <= bridge.length / 2; x += 4) {
      ctx.moveTo(x, -4)
      ctx.lineTo(x, 4)
    }
    for (const y of [-1.5, 1.5]) {
      ctx.moveTo(-bridge.length / 2, y)
      ctx.lineTo(bridge.length / 2, y)
    }
    ctx.stroke()
    ctx.restore()
  }
  for (const s of map.symbols) symbol(ctx, s, seed)
  for (const place of map.places) settlement(ctx, place)
  ctx.fillStyle = 'rgba(93,70,35,0.07)'
  for (let i = 0; i < (width * height) / 100; i++)
    ctx.fillRect(random(seed + 18, i) * width, random(seed + 19, i) * height, 0.65, 0.65)
  for (const label of map.labels) paintLabel(ctx, label)
  paintCompass(ctx, map.compass.x, map.compass.y)
}

export type MotionData = Pick<
  MapData,
  | 'seed'
  | 'navigation'
  | 'navigationLakeCenter'
  | 'compass'
  | 'places'
  | 'rails'
  | 'waves'
  | 'ships'
>
export function createMapMotion(map: MotionData, getCounts: () => MapCounts) {
  const rails = map.rails
    .map((route) => ({ route, lengths: pathLengths(route.points) }))
    .filter(({ lengths }) => lengths.at(-1)! > 120)
    .map(({ route, lengths }) => ({
      points: route.points,
      lengths,
      phase: random(514, route.from, route.to),
    }))
  // 火车每次出场仍然随机选铁轨，但随机序列由地图种子决定：同一张地图重绘时
  // 火车的身份和相位保持连续，不会因为重新生成而全部跳轨。
  const trainSeed = map.seed
  const ships = map.ships.map((points) => ({
    points,
    lengths: pathLengths(points),
    phase: random(515, Math.round(points[0]!.x), Math.round(points[0]!.y)),
  }))
  const trainCycle = Math.max(0, ...rails.map((rail) => rail.lengths.at(-1)! + 90)) * 2
  const dirty: { x: number; y: number; width: number; height: number }[] = []
  let dirtyCount = 0
  const mark = (x: number, y: number, width: number, height: number) => {
    const box = dirty[dirtyCount]
    if (box) {
      box.x = x
      box.y = y
      box.width = width
      box.height = height
    } else dirty.push({ x, y, width, height })
    dirtyCount++
  }
  return (
    ctx: CanvasRenderingContext2D,
    time: number,
    visibility: (p: Point, water: boolean) => number = () => 1,
    revealVisibility: (p: Point) => number = () => 1,
  ) => {
    for (let i = 0; i < dirtyCount; i++) {
      const box = dirty[i]!
      ctx.clearRect(box.x, box.y, box.width, box.height)
    }
    dirtyCount = 0
    const { trains, ships: shipLimit, showNavigationLake, navigationLakeSize } = getCounts()
    const viewportWidth = window.innerWidth,
      viewportHeight = window.innerHeight
    const visible = (p: Point, margin: number) =>
      p.x >= -margin &&
      p.x <= viewportWidth + margin &&
      p.y >= -margin &&
      p.y <= viewportHeight + margin
    const lake = map.navigationLakeCenter
    if (lake && showNavigationLake) {
      const radius = navigationLakeSize
      const lakeRx = radius * 0.44
      const lakeRy = radius * 0.44
      for (let i = 0; i < 5; i++) {
        const p = {
          x: lake.x + Math.sin(i * 2.1) * lakeRx * 0.55,
          y: lake.y + Math.cos(i * 1.7) * lakeRy * 0.55,
        }
        if (!visible(p, radius)) continue
        mark(p.x - 18, p.y - 8, 36, 16)
        ctx.globalAlpha = (0.3 + 0.18 * Math.sin(time * 0.65 + i * 2.4)) * revealVisibility(p)
        ctx.beginPath()
        ctx.ellipse(p.x, p.y + Math.sin(time + i) * 1.2, 7 + (i % 2) * 3, 2.5, 0, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }
    ctx.strokeStyle = ink
    ctx.lineWidth = 0.8 * 1.25
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (let i = 0; i < map.waves.length; i++) {
      const p = map.waves[i]!,
        y = p.y + Math.sin(time * 0.8 + i) * 1.1
      if (!visible(p, 8)) continue
      const alpha = visibility(p, true) * revealVisibility(p)
      if (alpha <= 0) continue
      mark(p.x - 8, p.y - 7, 16, 12)
      ctx.globalAlpha = (0.25 + 0.22 * Math.sin(time * 0.65 + i * 2.4)) * alpha
      ctx.beginPath()
      ctx.moveTo(p.x - 5, y)
      ctx.quadraticCurveTo(p.x - 2.5, y - 3, p.x, y)
      ctx.quadraticCurveTo(p.x + 2.5, y - 3, p.x + 5, y)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ships.forEach((ship, index) => {
      if (index >= shipLimit) return
      const total = ship.lengths.at(-1)!,
        p = samplePath(ship.points, ship.lengths, (time * 4 + total * ship.phase) % total)
      if (!visible(p, 30)) return
      const alpha = visibility(p, true) * revealVisibility(p)
      if (alpha <= 0) return
      mark(p.x - 30, p.y - 32, 60, 58)
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.translate(p.x, p.y + Math.sin(time + ship.phase * 6) * 1.3)
      ctx.scale(Math.cos(p.angle) < 0 ? -1 : 1, 1)
      ctx.rotate(Math.sin(p.angle) * 0.06)
      ctx.fillStyle = waterColor
      ctx.beginPath()
      ctx.moveTo(-17, 4)
      ctx.lineTo(18, 4)
      ctx.quadraticCurveTo(15, 12, 10, 12)
      ctx.quadraticCurveTo(-10, 15, -17, 4)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(-11, 8)
      ctx.quadraticCurveTo(0, 11, 12, 8)
      ctx.stroke()
      for (const [x, h] of [
        [-6, 20],
        [5, 25],
      ] as const) {
        ctx.beginPath()
        ctx.moveTo(x, 5)
        ctx.lineTo(x, -h)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(x + 1, -h + 3)
        ctx.quadraticCurveTo(x + 15, -h / 2, x + 2, 0)
        ctx.lineTo(x - 7, 0)
        ctx.quadraticCurveTo(x - 3, -h / 2, x + 1, -h + 3)
        ctx.fill()
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.moveTo(-15, 17)
      ctx.quadraticCurveTo(-5, 15, 3, 17)
      ctx.moveTo(7, 17)
      ctx.lineTo(17, 17)
      ctx.stroke()
      ctx.restore()
    })
    const trainSlots = Math.min(trains, 10)
    if (trainSlots && rails.length) {
      for (let index = 0; index < trainSlots; index++) {
        const travel = time * 17 + rails[index % rails.length]!.phase * trainCycle,
          trip = Math.floor(travel / trainCycle),
          cyclePhase = travel % trainCycle,
          rail = rails[Math.floor(random(trainSeed + trip, index) * rails.length)]!,
          total = rail.lengths.at(-1)!,
          span = total + 90,
          phase = (cyclePhase / trainCycle) * span * 2
        const forward = phase < span,
          head = forward ? phase - 35 : span * 2 - phase + 35
        for (let car = 3; car >= 0; car--) {
          const d = head + (forward ? -1 : 1) * car * 11
          if (d < 0 || d >= total) continue
          const p = samplePath(rail.points, rail.lengths, d)
          if (!visible(p, 30)) continue
          const alpha = visibility(p, false) * revealVisibility(p)
          if (alpha <= 0) continue
          mark(p.x - 30, p.y - 30, 60, 60)
          ctx.save()
          ctx.globalAlpha = alpha
          ctx.translate(p.x, p.y)
          ctx.rotate(p.angle + (forward ? 0 : Math.PI))
          ctx.fillStyle = car ? '#8d7954' : '#594b34'
          ctx.fillRect(-4, -2.5, 8, 5)
          ctx.strokeRect(-4, -2.5, 8, 5)
          if (!car) {
            ctx.fillStyle = '#e9dbb7'
            ctx.fillRect(1, -1.5, 2, 3)
            for (let puff = 0; puff < 3; puff++) {
              const age = (time * 0.6 + puff / 3) % 1
              ctx.globalAlpha = (1 - age) * 0.24 * alpha
              ctx.beginPath()
              ctx.arc(-age * 18, -4 - age * 9, 1 + age * 4, 0, Math.PI * 2)
              ctx.stroke()
            }
            ctx.globalAlpha = 1
          }
          ctx.restore()
        }
      }
    }
    for (const place of map.places) {
      if (place.kind !== 'castle') continue
      if (!visible(place, 50)) continue
      const alpha = visibility(place, false) * revealVisibility(place)
      if (alpha <= 0) continue
      ctx.globalAlpha = alpha
      const x = place.x,
        y = place.y - 46,
        flutter = Math.sin(time * 2 + place.id) * 1.8
      mark(x - 2, y - 10, 16, 18)
      ctx.beginPath()
      ctx.moveTo(x, y + 4)
      ctx.lineTo(x, y - 8)
      ctx.lineTo(x + 10, y - 6 + flutter)
      ctx.lineTo(x, y - 2)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }
}
