import { createExtensionWorker } from '@/shared/worker'

import { limitCanvasScale } from '../dynamic/viewport'

import { createCoastAnimation } from './coastAnimation'
import type { MapFrame, MapPreview, MapError } from './map.worker'
import mapWorkerUrl from './map.worker?worker&url'
import type { Bounds, MapCounts, MapField, MapRequest } from './model'
import { noise } from './model'
import { createMapMotion } from './paint'

// Bilinear shoreline distance used to fade trains and ships near the coast when
// the WebGL transition layer is not created.
const createFieldVisibility = (field: MapField) => {
  const { values, cols, rows, step } = field
  const sample = (x: number, y: number) => {
    const fx = Math.max(0, Math.min(cols - 1.001, x / step))
    const fy = Math.max(0, Math.min(rows - 1.001, y / step))
    const ix = Math.floor(fx),
      iy = Math.floor(fy),
      tx = fx - ix,
      ty = fy - iy,
      i = iy * cols + ix
    return (
      (values[i]! * (1 - tx) + values[i + 1]! * tx) * (1 - ty) +
      (values[i + cols]! * (1 - tx) + values[i + cols + 1]! * tx) * ty
    )
  }
  return (p: { x: number; y: number }, water: boolean) =>
    Math.max(0, Math.min(1, (water ? -sample(p.x, p.y) : sample(p.x, p.y)) / 8))
}

// Static geography is uploaded only when it changes. The transparent animation
// layer never copies the paper map every frame; expensive work stays off-thread.
export function createMapScene(
  background: HTMLCanvasElement,
  canvas: HTMLCanvasElement,
  coastCanvas: HTMLCanvasElement,
  detailsCanvas: HTMLCanvasElement,
  getCounts: () => MapCounts,
  onError: () => void,
  disableEntrance: boolean,
  onFirstFrame: () => void,
) {
  const ground = background.getContext('2d', { alpha: false })!,
    ctx = canvas.getContext('2d')!,
    detailCtx = detailsCanvas.getContext('2d')!
  if (!ground || !ctx || !detailCtx) throw new Error('Canvas 2D unavailable')
  const worker = createExtensionWorker(mapWorkerUrl)
  // The WebGL coast layer exists only for the entrance transition. Without it
  // the worker paints the same shorelines into the map bitmap, which avoids
  // creating (and warming) a second WebGL context for static maps.
  const coast = disableEntrance ? null : createCoastAnimation(coastCanvas)
  if (!coast) coastCanvas.hidden = true
  let fieldVisibility: ReturnType<typeof createFieldVisibility> | null = null
  const fullVisibility = () => 1
  detailsCanvas.hidden = true
  detailsCanvas.width = detailsCanvas.height = 1
  const seed = Math.floor(Math.random() * 0x7fffffff)
  const anchorWidth = window.innerWidth,
    anchorHeight = window.innerHeight
  let width = 0,
    height = 0,
    scale = 1,
    generation = 0,
    busy = false,
    resizing = false,
    lastViewport = '',
    disposed = false
  let navigation: Bounds = null,
    key = '',
    requestedKey = '',
    bitmap: ImageBitmap | null = null
  let bitmapScale = 1
  let preview: MapPreview | null = null
  let pending: MapRequest | null = null,
    timer: ReturnType<typeof setTimeout> | undefined
  let motion: ReturnType<typeof createMapMotion> | null = null
  let detailsBitmap: ImageBitmap | null = null,
    introActive = false
  let lastTime = 0
  let revealStart = 0,
    revealPainted = -1,
    lastRevealPaint = -Infinity
  const mask = document.createElement('canvas'),
    maskCtx = mask.getContext('2d')!
  let maskNoise = new Float32Array(),
    maskPixels: ImageData | null = null
  let cancelCoastWarmup: (() => void) | undefined
  let coastWarmed = false

  // The first large WebGL allocation and shader run cost tens of milliseconds
  // on some drivers. Do it while the layer is still hidden instead of on the
  // frame that finally shows the map.
  const scheduleCoastWarmup = () => {
    if (coastWarmed || !coast?.available()) return
    coastWarmed = true
    const run = () => {
      cancelCoastWarmup = undefined
      if (!disposed) coast.prepare(width, height)
    }
    if (typeof requestIdleCallback === 'function') {
      const request = requestIdleCallback(run, { timeout: 100 })
      cancelCoastWarmup = () => cancelIdleCallback(request)
    } else {
      const request = setTimeout(run, 100)
      cancelCoastWarmup = () => clearTimeout(request)
    }
  }

  const paintBackground = () => {
    ground.fillStyle = '#efdcae'
    ground.fillRect(0, 0, background.width, background.height)
    if (preview) {
      const ratio = scale / preview.scale
      ground.drawImage(
        preview.bitmap,
        0,
        0,
        preview.bitmap.width * ratio,
        preview.bitmap.height * ratio,
      )
    }
    if (bitmap)
      ground.drawImage(
        bitmap,
        0,
        0,
        (bitmap.width / bitmapScale) * scale,
        (bitmap.height / bitmapScale) * scale,
      )
  }
  const clearPreview = () => {
    preview?.bitmap.close()
    preview = null
  }
  const paintDetails = () => {
    if (detailsBitmap)
      detailCtx.drawImage(
        detailsBitmap,
        0,
        0,
        (detailsBitmap.width / bitmapScale) * scale,
        (detailsBitmap.height / bitmapScale) * scale,
      )
  }
  const startReveal = (time: number) => {
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
  const paintReveal = (time: number) => {
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
  const revealVisibility = (p: { x: number; y: number }) => {
    if (!introActive) return 1
    const threshold = revealPainted * 1.24 - 0.12,
      n = noise(seed + 922, p.x / 340, p.y / 340),
      edge = Math.min(1, Math.max(0, (threshold - n + 0.12) / 0.24))
    return edge * edge * (3 - 2 * edge)
  }
  const disableCoast = (error?: unknown) => {
    if (!coast?.available()) return
    if (error) console.warn('[map] Using Canvas 2D shorelines:', error)
    coast.loseContext()
    requestedKey = ''
    requestMap()
  }
  const finishTransition = () => {
    if (!bitmap || !detailsBitmap) return
    const combined = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = combined.getContext('2d', { alpha: false })
    if (!context) throw new Error('Could not combine map layers')
    context.drawImage(bitmap, 0, 0)
    try {
      coast?.bake(context, bitmap.width, bitmap.height)
    } catch (error) {
      disableCoast(error)
    }
    context.drawImage(detailsBitmap, 0, 0)
    const flattened = combined.transferToImageBitmap()
    bitmap.close()
    bitmap = flattened
    detailsBitmap.close()
    detailsBitmap = null
    detailsCanvas.hidden = true
    detailsCanvas.width = detailsCanvas.height = 1
    introActive = false
    mask.width = mask.height = 1
    maskPixels = null
    maskNoise = new Float32Array()
    clearPreview()
    paintBackground()
  }
  const visibility = () =>
    coast?.available() && coast.isActive() ? coast.visibility : (fieldVisibility ?? fullVisibility)
  worker.onmessage = (event: MessageEvent<MapFrame | MapPreview | MapError>) => {
    const frame = event.data
    if ('preview' in frame) {
      if (disposed || frame.id !== generation || bitmap) frame.bitmap.close()
      else {
        clearPreview()
        preview = frame
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
        frame.paper?.close()
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
      if (frame.paper) {
        try {
          coast?.begin(bitmap, frame.paper, frame.field, frame.scale, lastTime, !expanded)
        } catch (error) {
          disableCoast(error)
        } finally {
          frame.paper.close()
        }
      }
      fieldVisibility = createFieldVisibility(frame.field)
      const moving = coast?.draw(lastTime) ?? false
      introActive = firstFrame && !!detailsBitmap && moving
      if (introActive) {
        startReveal(lastTime)
      } else {
        if (moving && detailsBitmap) {
          detailsCanvas.width = background.width
          detailsCanvas.height = background.height
          detailsCanvas.style.width = background.style.width
          detailsCanvas.style.height = background.style.height
          detailsCanvas.hidden = false
          paintDetails()
        }
        clearPreview()
      }
      if (!moving && detailsBitmap) finishTransition()
      else {
        paintBackground()
        paintReveal(lastTime)
      }
      background.dataset.coastMoving = String(moving)
      motion = createMapMotion(frame.motion, getCounts)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      motion(ctx, lastTime, visibility(), revealVisibility)
      background.dataset.ready = String(frame.id)
      background.dataset.generationMs = frame.milliseconds.toFixed(1)
      background.dataset.counts = JSON.stringify(frame.counts)
      background.dataset.navigation = JSON.stringify(frame.motion.navigation)
      background.dataset.compass = JSON.stringify(frame.motion.compass)
      if (firstFrame) onFirstFrame()
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
  const sendPending = () => {
    if (!pending || busy || disposed || resizing || introActive) return
    const request = pending
    pending = null
    busy = true
    try {
      // A queued request can wait until the initial transition completes.
      // Determine this at dispatch time, not when the layout was measured.
      request.preview = !bitmap && !disableEntrance
      request.shoreline = !coast?.available()
      worker.postMessage(request)
    } catch (error) {
      busy = false
      console.error('[map] Could not send map request to worker:', error)
      onError()
    }
  }
  const requestMap = (immediate = false) => {
    if (resizing) return
    clearTimeout(timer)
    const send = () => {
      const viewWidth = window.innerWidth,
        viewHeight = window.innerHeight
      const counts = getCounts()
      const nextKey = `${width},${height},${scale},${viewWidth},${viewHeight},${key},${counts.islands},${counts.showNavigationLake},${counts.navigationLakeSize}`
      if (nextKey === requestedKey) return
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
      requestedKey = nextKey
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
        islandLimit: counts.islands,
        showNavigationLake: counts.showNavigationLake,
        navigationLakeSize: counts.navigationLakeSize,
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
  const viewportKey = () => `${window.innerWidth},${window.innerHeight},${devicePixelRatio}`
  const resizeViewport = (trim = false) => {
    if (resizing && window.innerWidth <= width && window.innerHeight <= height) return false
    const bufferedWidth = Math.ceil(window.innerWidth / 256) * 256 + 128
    const bufferedHeight = Math.ceil(window.innerHeight / 256) * 256 + 128
    const desiredScale = resizing
      ? scale
      : Math.round(Math.min(devicePixelRatio || 1, 1.5) * 100) / 100
    const nextScale = limitCanvasScale(bufferedWidth, bufferedHeight, desiredScale)
    const reuse = !trim && nextScale === scale
    const reuseWidth = Math.max(width, bufferedWidth)
    const reuseHeight = Math.max(height, bufferedHeight)
    const fits = reuse && limitCanvasScale(reuseWidth, reuseHeight, nextScale) === nextScale
    const nextWidth = fits ? reuseWidth : bufferedWidth
    const nextHeight = fits ? reuseHeight : bufferedHeight
    if (nextWidth === width && nextHeight === height && scale === nextScale) return false
    if (!resizing && detailsBitmap) {
      finishTransition()
      sendPending()
    }
    width = nextWidth
    height = nextHeight
    scale = nextScale
    for (const target of [background, canvas]) {
      const pixelWidth = Math.ceil(width * scale),
        pixelHeight = Math.ceil(height * scale)
      if (target.width !== pixelWidth) target.width = pixelWidth
      if (target.height !== pixelHeight) target.height = pixelHeight
      target.style.width = `${width}px`
      target.style.height = `${height}px`
    }
    paintBackground()
    scheduleCoastWarmup()
    return true
  }
  const startResize = () => {
    const nextViewport = viewportKey()
    if (!resizing && bitmap && lastViewport !== nextViewport) {
      resizing = true
      clearTimeout(timer)
      if (busy || pending) {
        // Discard an obsolete full result and let the settled viewport request it again if needed.
        generation++
        requestedKey = ''
      }
      pending = null
    }
    lastViewport = nextViewport
  }
  const updateNavigation = (bounds: DOMRect | null) => {
    const next = bounds
      ? {
          x: Math.round(bounds.left),
          y: Math.round(bounds.top),
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
        }
      : null
    const nextKey = next ? `${next.x},${next.y},${next.width},${next.height}` : ''
    if (nextKey === key) return false
    key = nextKey
    navigation = next
    return true
  }
  const resize = (bounds: DOMRect | null) => {
    // The shared controller calls this after the drag settles. Release large
    // high-DPR backing stores instead of retaining the largest window forever.
    resizing = false
    lastViewport = viewportKey()
    resizeViewport(true)
    updateNavigation(bounds)
    requestMap(!bitmap)
  }
  const draw = (time: number, bounds: DOMRect | null) => {
    lastTime = time
    if (updateNavigation(bounds)) requestMap(!bitmap)
    const moving = (resizing ? coast?.isActive() : coast?.draw(time)) ?? false
    if (!resizing) paintReveal(lastTime)
    if (!resizing && !moving && detailsBitmap) {
      finishTransition()
      sendPending()
    }
    if (background.dataset.coastMoving !== String(moving))
      background.dataset.coastMoving = String(moving)
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    const currentBitmap = bitmap
    const clipMotion =
      resizing &&
      currentBitmap &&
      (width > currentBitmap.width / bitmapScale || height > currentBitmap.height / bitmapScale)
    if (clipMotion) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, currentBitmap.width / bitmapScale, currentBitmap.height / bitmapScale)
      ctx.clip()
    }
    motion?.(ctx, time, visibility(), revealVisibility)
    if (clipMotion) ctx.restore()
  }
  return {
    startResize,
    resizeViewport,
    resize,
    draw,
    loseCoastContext() {
      if (disposed || !coast?.available()) return
      disableCoast()
      finishTransition()
    },
    invalidateLayout(rebuild = true) {
      requestedKey = ''
      if (rebuild) requestMap()
    },
    dispose() {
      disposed = true
      clearTimeout(timer)
      cancelCoastWarmup?.()
      worker.terminate()
      bitmap?.close()
      clearPreview()
      detailsBitmap?.close()
      coast?.dispose()
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
