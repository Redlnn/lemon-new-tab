import { generateMap } from './generate'
import type { MapData, MapRequest, MapField } from './model'
import { paintMapDetails, paintTerrain, type MotionData } from './paint'
import { paperTexture } from './paper'
import { sampleMapField } from './terrain'

export type MapFrame = {
  id: number
  scale: number
  bitmap: ImageBitmap
  details?: ImageBitmap
  paper?: ImageBitmap
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
let previous:
  | {
      key: string
      map: MapData
      field: MapField
      islandLimit: MapRequest['islandLimit']
      lakeKey: string
    }
  | undefined
self.onmessage = (event: MessageEvent<MapRequest>) => {
  const request = event.data
  try {
    const start = performance.now()
    let previewMs = 0
    if (request.preview) {
      const scale = 0.5
      const canvas = new OffscreenCanvas(
        Math.ceil(request.width * scale),
        Math.ceil(request.height * scale),
      )
      const ctx = canvas.getContext('2d', { alpha: false })!
      const texture = paperTexture(request.seed, request.width, request.height)
      ctx.drawImage(texture, 0, 0, canvas.width, canvas.height)
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
    const geometryKey = JSON.stringify([
      request.seed,
      request.width,
      request.height,
      request.viewWidth,
      request.viewHeight,
      request.anchorWidth,
      request.anchorHeight,
      request.navigation,
      request.quiet,
      request.compassCandidates,
      request.islandLimit,
      request.showNavigationLake,
      request.navigationLakeSize,
    ])
    const cached = previous?.key === geometryKey ? previous : undefined
    const lakeKey = `${request.showNavigationLake},${request.navigationLakeSize}`
    const generationStart = performance.now()
    const map =
      cached?.map ??
      generateMap(
        request,
        previous?.islandLimit === request.islandLimit && previous?.lakeKey === lakeKey
          ? previous.map
          : undefined,
      )
    const generationMs = cached ? 0 : performance.now() - generationStart
    const canvas = new OffscreenCanvas(
      Math.ceil(request.width * request.scale),
      Math.ceil(request.height * request.scale),
    )
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('Map canvas unavailable')
    paintTerrain(ctx, map, request.scale, request.shoreline)
    let details: ImageBitmap | undefined
    let paper: ImageBitmap | undefined
    if (request.shoreline) {
      paintMapDetails(ctx, map, request)
    } else {
      const detailCanvas = new OffscreenCanvas(canvas.width, canvas.height)
      paintMapDetails(detailCanvas.getContext('2d')!, map, request)
      details = detailCanvas.transferToImageBitmap()
      const texture = paperTexture(request.seed, request.width, request.height)
      const paperCanvas = new OffscreenCanvas(texture.width, texture.height)
      paperCanvas.getContext('2d')!.drawImage(texture, 0, 0)
      paper = paperCanvas.transferToImageBitmap()
    }
    const bitmap = canvas.transferToImageBitmap()
    const { seed, navigation, compass, places, rails, waves, ships } = map
    const field = cached?.field ?? sampleMapField(request)
    const fieldValues = field.values.slice()
    const frame: MapFrame = {
      id: request.id,
      scale: request.scale,
      bitmap,
      details,
      paper,
      field: { ...field, values: fieldValues },
      motion: {
        seed,
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
        geometryReused: cached ? 1 : 0,
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
      transfer: [bitmap, ...(paper && details ? [paper, details] : []), fieldValues.buffer],
    })
    previous = { key: geometryKey, map, field, islandLimit: request.islandLimit, lakeKey }
  } catch (error) {
    self.postMessage({ id: request.id, error: String(error) })
  }
}
