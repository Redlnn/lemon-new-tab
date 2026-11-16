import { createExtensionWorker } from '@/shared/worker'

import { createCoastAnimation } from './coastAnimation'
import type { MapFrame, MapPreview, MapError, MapPreviewComplete } from './map.worker'
import mapWorkerUrl from './map.worker?worker&url'
import type { Bounds, MapCounts, MapRequest } from './model'
import { noise } from './model'
import { createMapMotion } from './paint'

// Static geography is uploaded only when it changes. The transparent animation
// layer never copies the paper map every frame; expensive work stays off-thread.
export function createMapScene(
  background: HTMLCanvasElement,
  canvas: HTMLCanvasElement,
  coastCanvas: HTMLCanvasElement,
  detailsCanvas: HTMLCanvasElement,
  getCounts: () => MapCounts,
  onError: () => void,
) {
  const ground = background.getContext('2d', { alpha: false })!,
    ctx = canvas.getContext('2d')!,
    detailCtx = detailsCanvas.getContext('2d')!
  if (!ground || !ctx || !detailCtx) throw new Error('Canvas 2D unavailable')
  const coast = createCoastAnimation(coastCanvas)
  detailsCanvas.hidden = true
  const worker = createExtensionWorker(mapWorkerUrl)
  const seed = Math.floor(Math.random() * 0x7fffffff)
  const anchorWidth = window.innerWidth,
    anchorHeight = window.innerHeight
  let width = 0,
    height = 0,
    scale = 1,
    generation = 0,
    busy = false,
    disposed = false
  let navigation: Bounds = null,
    key = '',
    requestedKey = '',
    bitmap: ImageBitmap | null = null
  let bitmapScale = 1
  let previewBitmap: ImageBitmap | null = null,
    previewScale = 1
  let pending: MapRequest | null = null,
    timer: ReturnType<typeof setTimeout> | undefined
  let motion: ReturnType<typeof createMapMotion> | null = null
  let baseBitmap: ImageBitmap | null = null,
    detailsBitmap: ImageBitmap | null = null,
    introActive = false
  let lastTime = 0
  let lastAnimate = true
  let revealStart = 0,
    revealPainted = -1,
    lastRevealPaint = -Infinity
  const mask = document.createElement('canvas'),
    maskCtx = mask.getContext('2d')!
  let maskNoise = new Float32Array(),
    maskPixels: ImageData | null = null

  function paintBackground() {
    ground.fillStyle = '#efdcae'
    ground.fillRect(0, 0, background.width, background.height)
    if (previewBitmap)
      ground.drawImage(
        previewBitmap,
        0,
        0,
        (previewBitmap.width / previewScale) * scale,
        (previewBitmap.height / previewScale) * scale,
      )
    const visibleBitmap = introActive && baseBitmap ? baseBitmap : bitmap
    if (visibleBitmap)
      ground.drawImage(
        visibleBitmap,
        0,
        0,
        (visibleBitmap.width / bitmapScale) * scale,
        (visibleBitmap.height / bitmapScale) * scale,
      )
  }
  function paintDetails() {
    if (detailsBitmap)
      detailCtx.drawImage(
        detailsBitmap,
        0,
        0,
        (detailsBitmap.width / bitmapScale) * scale,
        (detailsBitmap.height / bitmapScale) * scale,
      )
  }
  function startReveal(time: number) {
    revealStart = time
    revealPainted = -1
    lastRevealPaint = -Infinity
    detailsCanvas.width = background.width
    detailsCanvas.height = background.height
    detailsCanvas.style.width = background.style.width
    detailsCanvas.style.height = background.style.height
    mask.width = Math.ceil(width / 8)
    mask.height = Math.ceil(height / 8)
    maskPixels = maskCtx.createImageData(mask.width, mask.height)
    maskNoise = new Float32Array(mask.width * mask.height)
    for (let y = 0; y < mask.height; y++)
      for (let x = 0; x < mask.width; x++)
        maskNoise[y * mask.width + x] = noise(seed + 922, (x * 8) / 340, (y * 8) / 340)
    detailsCanvas.hidden = false
    detailsCanvas.style.opacity = '1'
  }
  function paintReveal(time: number) {
    if (!introActive || !detailsBitmap) return
    const progress = Math.min(1, Math.max(0, (time - revealStart) / 1.2))
    // Ink soaks into irregular patches; labels and symbols use the same mask.
    if (progress !== revealPainted && (progress === 1 || time - lastRevealPaint >= 1 / 24)) {
      revealPainted = progress
      lastRevealPaint = time
      detailCtx.setTransform(1, 0, 0, 1, 0, 0)
      detailCtx.clearRect(0, 0, detailsCanvas.width, detailsCanvas.height)
      paintDetails()
      if (progress < 1 && maskPixels) {
        const pixels = maskPixels.data,
          threshold = progress * 1.24 - 0.12
        for (let i = 0; i < maskNoise.length; i++) {
          const edge = Math.min(1, Math.max(0, (threshold - maskNoise[i]! + 0.12) / 0.24)),
            smooth = edge * edge * (3 - 2 * edge),
            offset = i * 4
          pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 255
          pixels[offset + 3] = Math.round(smooth * 255)
        }
        maskCtx.putImageData(maskPixels, 0, 0)
        detailCtx.globalCompositeOperation = 'destination-in'
        detailCtx.imageSmoothingEnabled = true
        detailCtx.drawImage(mask, 0, 0, detailsCanvas.width, detailsCanvas.height)
        detailCtx.globalCompositeOperation = 'source-over'
      }
    }
  }
  function revealVisibility(p: { x: number; y: number }) {
    if (!introActive) return 1
    const threshold = revealPainted * 1.24 - 0.12,
      n = noise(seed + 922, p.x / 340, p.y / 340),
      edge = Math.min(1, Math.max(0, (threshold - n + 0.12) / 0.24))
    return edge * edge * (3 - 2 * edge)
  }
  function finishReveal() {
    if (!introActive) return
    introActive = false
    if (detailsBitmap) {
      detailCtx.setTransform(1, 0, 0, 1, 0, 0)
      detailCtx.clearRect(0, 0, detailsCanvas.width, detailsCanvas.height)
      paintDetails()
    }
    baseBitmap?.close()
    baseBitmap = null
    maskPixels = null
    maskNoise = new Float32Array()
    previewBitmap?.close()
    previewBitmap = null
    paintBackground()
    sendPending()
  }
  worker.onmessage = (
    event: MessageEvent<MapFrame | MapPreview | MapError | MapPreviewComplete>,
  ) => {
    const frame = event.data
    if ('previewComplete' in frame) {
      busy = false
      sendPending()
      return
    }
    if ('preview' in frame) {
      if (disposed || frame.id !== generation) frame.bitmap.close()
      else {
        previewBitmap?.close()
        previewBitmap = frame.bitmap
        previewScale = frame.scale
        paintBackground()
        background.dataset.preview = String(frame.id)
        background.dataset.previewMs = frame.milliseconds.toFixed(1)
      }
      return
    }
    busy = false
    if (disposed || frame.id !== generation) {
      if ('bitmap' in frame) {
        frame.bitmap.close()
        frame.paper.close()
        frame.base?.close()
        frame.details?.close()
      }
    } else if ('error' in frame) {
      console.error('[map]', frame.error)
      onError()
    } else {
      const firstFrame = !bitmap
      const expanded =
        !!bitmap &&
        (width > bitmap.width / bitmapScale + 80 || height > bitmap.height / bitmapScale + 80)
      bitmap?.close()
      bitmap = frame.bitmap
      bitmapScale = frame.scale
      detailsBitmap?.close()
      detailsBitmap = frame.details ?? null
      coast.begin(bitmap, frame.paper, frame.field, frame.scale, lastTime, lastAnimate && !expanded)
      frame.paper.close()
      introActive = firstFrame && !!frame.base && !!frame.details && coast.isActive()
      if (introActive) {
        baseBitmap = frame.base!
        startReveal(lastTime)
      } else {
        frame.base?.close()
        detailsCanvas.width = background.width
        detailsCanvas.height = background.height
        detailsCanvas.style.width = background.style.width
        detailsCanvas.style.height = background.style.height
        detailsCanvas.hidden = false
        paintDetails()
        previewBitmap?.close()
        previewBitmap = null
      }
      paintBackground()
      const moving = coast.draw(lastTime, lastAnimate)
      paintReveal(lastTime)
      background.dataset.coastMoving = String(moving)
      motion = createMapMotion(frame.motion, getCounts)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      motion(ctx, lastTime, coast.visibility, revealVisibility)
      staticPainted = false
      background.dataset.ready = String(frame.id)
      background.dataset.generationMs = frame.milliseconds.toFixed(1)
      background.dataset.counts = JSON.stringify(frame.counts)
      background.dataset.navigation = JSON.stringify(frame.motion.navigation)
      background.dataset.compass = JSON.stringify(frame.motion.compass)
    }
    sendPending()
  }
  worker.onerror = () => {
    if (!disposed) {
      console.error('[map] Worker failed to load or execute')
      onError()
    }
  }
  worker.onmessageerror = (event) => {
    if (!disposed) {
      console.error('[map] Worker returned an unreadable message:', event)
      onError()
    }
  }
  function sendPending() {
    if (!pending || busy || disposed || introActive) return
    busy = true
    try {
      // A queued request can wait until the initial transition completes.
      // Determine this at dispatch time, not when the layout was measured.
      pending.first = !bitmap
      pending.shoreline = !coast.available()
      worker.postMessage(pending)
    } catch (error) {
      busy = false
      console.error('[map] Could not send map request to worker:', error)
      onError()
    }
    pending = null
  }
  function requestMap(immediate = false, previewOnly = false) {
    clearTimeout(timer)
    const send = () => {
      const viewWidth = window.innerWidth,
        viewHeight = window.innerHeight
      const islandLimit = getCounts().islands
      const counts = getCounts()
      const nextKey = `${previewOnly},${width},${height},${scale},${viewWidth},${viewHeight},${key},${islandLimit},${counts.showNavigationLake},${counts.navigationLakeSize}`
      if (nextKey === requestedKey) return
      requestedKey = nextKey
      const quiet = [
        ...document.querySelectorAll(
          '.clock, .search-box, .quick-links__category-groups, .action-btn-container, .dock',
        ),
      ]
        .map((element) => {
          const r = element.getBoundingClientRect()
          return { x: r.left - 15, y: r.top - 12, width: r.width + 30, height: r.height + 24 }
        })
        .filter((r) => r.width > 30 && r.height > 24)
      const corners = [
        { x: 72, y: 80 },
        { x: viewWidth - 72, y: 80 },
        { x: viewWidth - 72, y: viewHeight - 90 },
        { x: 72, y: viewHeight - 90 },
      ]
      const compassCandidates = corners
        .map((_, i) => corners[(i + (seed % 4)) % 4]!)
        .filter(
          (p) =>
            !quiet.some(
              (q) =>
                p.x + 60 > q.x &&
                p.x - 60 < q.x + q.width &&
                p.y + 60 > q.y &&
                p.y - 60 < q.y + q.height,
            ),
        )
      const fillNeeded = bitmap
        ? width > bitmap.width / bitmapScale + 1 || height > bitmap.height / bitmapScale + 1
        : true
      const hasPreview =
        previewBitmap &&
        width <= previewBitmap.width / previewScale + 1 &&
        height <= previewBitmap.height / previewScale + 1
      pending = {
        id: ++generation,
        seed,
        width,
        height,
        viewWidth,
        viewHeight,
        anchorWidth,
        anchorHeight,
        scale,
        navigation,
        quiet,
        previewOnly,
        islandLimit,
        showNavigationLake: counts.showNavigationLake,
        navigationLakeSize: counts.navigationLakeSize,
        first: !bitmap,
        preview: previewOnly || (fillNeeded && !hasPreview),
        compassCandidates: compassCandidates.length
          ? compassCandidates
          : [corners[(seed + 1) % 4]!],
      }
      background.dataset.requested = String(generation)
      sendPending()
    }
    if (immediate) send()
    else timer = setTimeout(send, 80)
  }
  function resizeViewport(trim = false) {
    const nextScale = Math.round(Math.min(devicePixelRatio || 1, 1.5) * 100) / 100
    const reuse = !trim && nextScale === scale
    const nextWidth = Math.max(reuse ? width : 0, Math.ceil(window.innerWidth / 256) * 256 + 128)
    const nextHeight = Math.max(reuse ? height : 0, Math.ceil(window.innerHeight / 256) * 256 + 128)
    if (nextWidth === width && nextHeight === height && scale === nextScale) return false
    if (introActive) {
      coast.draw(lastTime, false)
      finishReveal()
    }
    width = nextWidth
    height = nextHeight
    scale = nextScale
    for (const target of [background, canvas]) {
      target.width = Math.ceil(width * scale)
      target.height = Math.ceil(height * scale)
      target.style.width = `${width}px`
      target.style.height = `${height}px`
    }
    detailsCanvas.width = background.width
    detailsCanvas.height = background.height
    detailsCanvas.style.width = background.style.width
    detailsCanvas.style.height = background.style.height
    paintDetails()
    paintBackground()
    staticPainted = false
    coast.resize()
    if (!trim && bitmap) requestMap(false, true)
    return true
  }
  function updateNavigation(bounds: DOMRect | null) {
    const nextKey = bounds
      ? `${Math.round(bounds.left)},${Math.round(bounds.top)},${Math.round(bounds.width)},${Math.round(bounds.height)}`
      : ''
    if (nextKey === key) return
    key = nextKey
    navigation = bounds
      ? { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height }
      : null
    requestMap(!bitmap)
  }
  function resize(bounds: DOMRect | null) {
    // The shared controller calls this after the drag settles. Release large
    // high-DPR backing stores instead of retaining the largest window forever.
    resizeViewport(true)
    updateNavigation(bounds)
    requestMap(!bitmap)
  }
  let staticPainted = false
  function draw(time: number, bounds: DOMRect | null, animate = true) {
    lastTime = animate ? time : 0
    lastAnimate = animate
    updateNavigation(bounds)
    const moving = coast.draw(lastTime, animate)
    paintReveal(lastTime)
    if (!moving) finishReveal()
    if (background.dataset.coastMoving !== String(moving))
      background.dataset.coastMoving = String(moving)
    if (!animate && staticPainted) return
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    motion?.(ctx, animate ? time : 0, coast.visibility, revealVisibility)
    staticPainted = !animate && !!motion
  }
  return {
    resizeViewport,
    resize,
    draw,
    loseCoastContext() {
      coast.loseContext()
      finishReveal()
      paintBackground()
      requestedKey = ''
      requestMap(true)
    },
    invalidateLayout(rebuild = true) {
      requestedKey = ''
      if (rebuild) requestMap()
    },
    dispose() {
      disposed = true
      clearTimeout(timer)
      worker.terminate()
      bitmap?.close()
      previewBitmap?.close()
      baseBitmap?.close()
      detailsBitmap?.close()
      coast.dispose()
      background.width =
        background.height =
        canvas.width =
        canvas.height =
        detailsCanvas.width =
        detailsCanvas.height =
          0
    },
  }
}
