// Keep a little extra canvas outside the clipped viewport so normal window
// dragging can reveal already rendered pixels without stretching or reallocating.
const VIEWPORT_BUFFER = 256

export function canvasViewportSize(
  canvas: HTMLCanvasElement,
  scale: number,
  previousScale: number,
  trim = false,
) {
  const box = canvas.parentElement?.getBoundingClientRect()
  const width = box?.width || window.innerWidth
  const height = box?.height || window.innerHeight
  const requiredWidth = Math.max(1, Math.ceil(width * scale))
  const requiredHeight = Math.max(1, Math.ceil(height * scale))
  const reuse = canvas.style.width !== '' && previousScale === scale && !trim
  const buffered = (value: number) =>
    Math.max(1, Math.ceil(value / VIEWPORT_BUFFER) * VIEWPORT_BUFFER * scale)
  return {
    width: reuse && canvas.width >= requiredWidth ? canvas.width : Math.ceil(buffered(width)),
    height: reuse && canvas.height >= requiredHeight ? canvas.height : Math.ceil(buffered(height)),
  }
}

export function setCanvasViewportStyle(canvas: HTMLCanvasElement, scale: number) {
  canvas.style.width = `${canvas.width / scale}px`
  canvas.style.height = `${canvas.height / scale}px`
}
