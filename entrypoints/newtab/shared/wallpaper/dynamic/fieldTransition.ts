/** Capture the visible field in screen coordinates, including an interrupted transition. */
export function snapshotField(
  from: Float32Array,
  to: Float32Array,
  mix: number,
  oldWidth: number,
  oldHeight: number,
  width: number,
  height: number,
  empty: number,
  step: number,
): Float32Array {
  const result = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const oldX = Math.min(x, oldWidth - 1),
        oldY = Math.min(y, oldHeight - 1)
      const oldIndex = oldY * oldWidth + oldX
      const value = from[oldIndex]! * (1 - mix) + to[oldIndex]! * mix
      const outside = Math.hypot(x - oldX, y - oldY) * step
      result[y * width + x] = outside ? Math.min(empty, value + outside) : value
    }
  }
  return result
}
