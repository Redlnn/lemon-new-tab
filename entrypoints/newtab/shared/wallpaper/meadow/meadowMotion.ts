export type MeadowPoint = { x: number; y: number }

// 九帧对应一个完整步态周期；每次只显示一帧。
export function meadowRunFrame(phase: number): number {
  const cycle = (((phase / (2 * Math.PI)) % 1) + 1) % 1
  return Math.floor(cycle * 9)
}

// 人物坐标在身体中部，点击位置对应脚下的草地；边缘留出半个人物的空间。
export function meadowClickTarget(
  point: MeadowPoint,
  width: number,
  height: number,
  scale: number,
): MeadowPoint {
  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))
  return {
    x: clamp(point.x, 76 * scale, Math.max(76 * scale, width - 76 * scale)),
    y: clamp(point.y - 72 * scale, 95 * scale, Math.max(95 * scale, height - 85 * scale)),
  }
}

// 素材的正面朝右、斜背面朝左；镜像它们以覆盖四个移动象限。
export function meadowMoveFacing(from: MeadowPoint, to: MeadowPoint) {
  const dx = to.x - from.x
  const back = to.y < from.y
  return { back, mirror: back ? dx > 0 : dx < 0 }
}

// 如果旧位置已经在画面外，沿目标指向旧位置的方向，找画面外的进场起点。
export function meadowResizeEntry(
  old: MeadowPoint,
  target: MeadowPoint,
  width: number,
  height: number,
  scale: number,
): MeadowPoint {
  const left = -612 * scale - 24,
    right = width + 96 * scale + 24,
    top = -610 * scale - 24,
    bottom = height + 116 * scale + 24
  if (old.x >= left && old.x <= right && old.y >= top && old.y <= bottom) return { ...old }
  const dx = old.x - target.x,
    dy = old.y - target.y
  const tx = dx > 0 ? (right - target.x) / dx : dx < 0 ? (left - target.x) / dx : Infinity
  const ty = dy > 0 ? (bottom - target.y) / dy : dy < 0 ? (top - target.y) / dy : Infinity
  const t = Math.min(1, Math.max(0, Math.min(tx, ty)))
  return { x: target.x + dx * t, y: target.y + dy * t }
}
