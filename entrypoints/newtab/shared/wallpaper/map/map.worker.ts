import { coastContours } from './coast'
import { generateMap } from './generate'
import type { MapData, MapRequest, MapField } from './model'
import { paintMap, paintMapDetails, paintTerrain, type MotionData } from './paint'
import { paperTexture } from './paper'
import { createTerrain, sampleMapField } from './terrain'

export type MapFrame = {
  id: number
  scale: number
  bitmap: ImageBitmap
  base?: ImageBitmap
  details?: ImageBitmap
  paper: ImageBitmap
  field: MapField
  motion: MotionData
  milliseconds: number
  counts: Record<string, number>
}
export type MapPreview = {
  id: number
  scale: number
  bitmap: ImageBitmap
  preview: true
  milliseconds: number
}
export type MapError = { id: number; error: string }
export type MapPreviewComplete = { id: number; previewComplete: true }
let previous: MapData | undefined
let previousIslandLimit: number | undefined
let previousLakeKey = ''
self.onmessage = (event: MessageEvent<MapRequest>) => {
  const request = event.data
  try {
    const start = performance.now()
    let previewMs = 0
    if (request.preview) {
      const scale = 0.5,
        canvas = new OffscreenCanvas(
          Math.ceil(request.width * scale),
          Math.ceil(request.height * scale),
        ),
        ctx = canvas.getContext('2d', { alpha: false })!
      if (request.first) {
        const texture = paperTexture(request.seed, request.width, request.height)
        ctx.drawImage(texture, 0, 0, canvas.width, canvas.height)
      } else {
        const terrain = createTerrain(request)
        paintTerrain(
          ctx,
          {
            ...coastContours(request.width, request.height, terrain.water, 16),
            seed: request.seed,
            width: request.width,
            height: request.height,
          },
          scale,
        )
      }
      const bitmap = canvas.transferToImageBitmap()
      previewMs = performance.now() - start
      const preview: MapPreview = {
        id: request.id,
        preview: true,
        scale,
        bitmap,
        milliseconds: previewMs,
      }
      self.postMessage(preview, { transfer: [bitmap] })
    }
    if (request.previewOnly) {
      const complete: MapPreviewComplete = { id: request.id, previewComplete: true }
      self.postMessage(complete)
      return
    }
    const generationStart = performance.now(),
      map = generateMap(
        request,
        previousIslandLimit === request.islandLimit &&
          previousLakeKey === `${request.showNavigationLake},${request.navigationLakeSize}`
          ? previous
          : undefined,
      )
    const generationMs = performance.now() - generationStart
    const canvas = new OffscreenCanvas(
      Math.ceil(request.width * request.scale),
      Math.ceil(request.height * request.scale),
    )
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('Map canvas unavailable')
    let base: ImageBitmap | undefined, details: ImageBitmap | undefined
    if (request.first) {
      paintTerrain(ctx, map, request.scale)
      base = canvas.transferToImageBitmap()
      const detailCanvas = new OffscreenCanvas(canvas.width, canvas.height),
        detailCtx = detailCanvas.getContext('2d')!
      paintMapDetails(detailCtx, map, request)
      details = detailCanvas.transferToImageBitmap()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(base, 0, 0)
      ctx.drawImage(details, 0, 0)
    } else paintMap(ctx, map, request)
    const bitmap = canvas.transferToImageBitmap(),
      { navigation, compass, places, rails, waves, ships } = map
    const texture = paperTexture(request.seed, request.width, request.height)
    const paperCanvas = new OffscreenCanvas(texture.width, texture.height)
    paperCanvas.getContext('2d')!.drawImage(texture, 0, 0)
    const paper = paperCanvas.transferToImageBitmap(),
      field = sampleMapField(request)
    const frame: MapFrame = {
      id: request.id,
      scale: request.scale,
      bitmap,
      base,
      details,
      paper,
      field,
      motion: {
        navigation,
        navigationLakeCenter: map.navigationLakeCenter,
        compass,
        places,
        rails,
        waves,
        ships,
      },
      milliseconds: performance.now() - start,
      counts: {
        generationMs: Math.round(generationMs),
        previewMs: Math.round(previewMs),
        paintMs: Math.round(performance.now() - generationStart - generationMs),
        places: places.length,
        ports: places.filter((p) => p.kind === 'port').length,
        castles: places.filter((p) => p.kind === 'castle').length,
        rivers: map.rivers.length,
        rails: rails.length,
        bridges: map.bridges.length,
        labels: map.labels.length,
        symbols: map.symbols.length,
        ships: ships.length,
      },
    }
    self.postMessage(frame, {
      transfer: [
        bitmap,
        paper,
        ...(base ? [base] : []),
        ...(details ? [details] : []),
        field.values.buffer as ArrayBuffer,
      ],
    })
    previous = map
    previousIslandLimit = request.islandLimit
    previousLakeKey = `${request.showNavigationLake},${request.navigationLakeSize}`
  } catch (error) {
    self.postMessage({ id: request.id, error: String(error) })
  }
}
