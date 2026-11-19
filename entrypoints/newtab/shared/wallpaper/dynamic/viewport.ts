// Keep a little extra canvas outside the clipped viewport so normal window
// dragging can reveal already rendered pixels without stretching or reallocating.
const VIEWPORT_BUFFER = 256
const MAX_CANVAS_PIXELS = 10 * 1024 * 1024

export function limitCanvasScale(width: number, height: number, scale: number, maxSize = Infinity) {
  return Math.min(
    scale,
    maxSize / width,
    maxSize / height,
    Math.sqrt(MAX_CANVAS_PIXELS / (width * height)),
  )
}

export function canvasViewportSize(
  canvas: HTMLCanvasElement,
  scale: number,
  previousScale: number,
  trim = false,
  maxSize = Infinity,
) {
  const box = canvas.parentElement?.getBoundingClientRect()
  const width = box?.width || window.innerWidth
  const height = box?.height || window.innerHeight
  const bufferedWidth = Math.max(1, Math.ceil(width / VIEWPORT_BUFFER) * VIEWPORT_BUFFER)
  const bufferedHeight = Math.max(1, Math.ceil(height / VIEWPORT_BUFFER) * VIEWPORT_BUFFER)
  scale = limitCanvasScale(bufferedWidth, bufferedHeight, scale, maxSize)
  const requiredWidth = Math.max(1, Math.ceil(width * scale))
  const requiredHeight = Math.max(1, Math.ceil(height * scale))
  const reuse = canvas.style.width !== '' && previousScale === scale && !trim
  const roundedWidth = Math.ceil(bufferedWidth * scale)
  const roundedHeight = Math.ceil(bufferedHeight * scale)
  const nextWidth = reuse && canvas.width >= requiredWidth ? canvas.width : roundedWidth
  const nextHeight = reuse && canvas.height >= requiredHeight ? canvas.height : roundedHeight
  const fits =
    nextWidth * nextHeight <= MAX_CANVAS_PIXELS && Math.max(nextWidth, nextHeight) <= maxSize
  return {
    width: fits ? nextWidth : roundedWidth,
    height: fits ? nextHeight : roundedHeight,
    scale,
  }
}

export function setCanvasViewportStyle(canvas: HTMLCanvasElement, scale: number) {
  canvas.style.width = `${canvas.width / scale}px`
  canvas.style.height = `${canvas.height / scale}px`
}
