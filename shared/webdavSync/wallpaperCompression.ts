import { MAX_SYNC_WALLPAPER_BYTES } from './catalog.ts'

const MAX_DIMENSION = 16_384
const MAX_PIXELS = 40_000_000
const MAX_COMPRESSION_SOURCE_BYTES = 100 * 1024 * 1024

export interface StaticImageInfo {
  height: number
  mimeType: 'image/bmp' | 'image/jpeg' | 'image/png' | 'image/webp'
  width: number
}

export interface WallpaperCompressionCandidate {
  blob: Blob
  height: number
  originalSize: number
  width: number
}

export async function inspectStaticWallpaper(
  blob: Blob,
  maxBytes = MAX_SYNC_WALLPAPER_BYTES,
): Promise<StaticImageInfo> {
  if (blob.size === 0 || blob.size > maxBytes) {
    throw new TypeError('Wallpaper size is unsupported')
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const info = inspectImageBytes(bytes)
  if (
    info.width < 1 ||
    info.height < 1 ||
    info.width > MAX_DIMENSION ||
    info.height > MAX_DIMENSION ||
    info.width * info.height > MAX_PIXELS
  ) {
    throw new TypeError('Wallpaper pixel dimensions are too large to compress safely')
  }
  return info
}

export async function createWallpaperCompressionCandidate(
  blob: Blob,
  options: {
    maxDimension?: number
    mimeType?: 'image/jpeg' | 'image/webp'
    quality?: number
  } = {},
): Promise<WallpaperCompressionCandidate> {
  const info = await inspectStaticWallpaper(blob, MAX_COMPRESSION_SOURCE_BYTES)
  const maximum = Math.min(4096, Math.max(512, Math.trunc(options.maxDimension ?? 2560)))
  const scale = Math.min(1, maximum / Math.max(info.width, info.height))
  const width = Math.max(1, Math.round(info.width * scale))
  const height = Math.max(1, Math.round(info.height * scale))
  const bitmap = await createImageBitmap(blob, {
    resizeHeight: height,
    resizeQuality: 'high',
    resizeWidth: width,
  })
  try {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { alpha: options.mimeType !== 'image/jpeg' })
    if (!context) throw new TypeError('Canvas compression is unavailable')
    if (options.mimeType === 'image/jpeg') {
      context.fillStyle = '#000'
      context.fillRect(0, 0, width, height)
    }
    context.drawImage(bitmap, 0, 0, width, height)
    const mimeType = options.mimeType ?? (info.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/webp')
    const quality = Math.min(0.95, Math.max(0.5, options.quality ?? 0.85))
    const compressed = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => value ? resolve(value) : reject(new TypeError('Wallpaper compression failed')),
        mimeType,
        quality,
      )
    })
    if (!compressed.type.startsWith('image/') || compressed.size > MAX_SYNC_WALLPAPER_BYTES) {
      throw new TypeError('Compressed wallpaper is invalid or still too large')
    }
    return { blob: compressed, height, originalSize: blob.size, width }
  } finally {
    bitmap.close()
  }
}

function inspectImageBytes(bytes: Uint8Array): StaticImageInfo {
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return inspectPng(bytes)
  }
  if (hasPrefix(bytes, [0xff, 0xd8])) return inspectJpeg(bytes)
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return inspectWebP(bytes)
  }
  if (ascii(bytes, 0, 2) === 'BM') {
    if (bytes.byteLength < 26) throw new TypeError('BMP wallpaper header is invalid')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return {
      width: Math.abs(view.getInt32(18, true)),
      height: Math.abs(view.getInt32(22, true)),
      mimeType: 'image/bmp',
    }
  }
  throw new TypeError('Wallpaper format cannot be compressed safely')
}

function inspectPng(bytes: Uint8Array): StaticImageInfo {
  if (bytes.byteLength < 33 || ascii(bytes, 12, 4) !== 'IHDR') {
    throw new TypeError('PNG wallpaper header is invalid')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 8
  while (offset + 12 <= bytes.byteLength) {
    const length = view.getUint32(offset)
    const type = ascii(bytes, offset + 4, 4)
    if (type === 'acTL') throw new TypeError('Animated PNG wallpaper cannot be compressed')
    offset += 12 + length
    if (type === 'IEND') break
  }
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
    mimeType: 'image/png',
  }
}

function inspectJpeg(bytes: Uint8Array): StaticImageInfo {
  let offset = 2
  while (offset + 9 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]!
    offset += 2
    if (marker === 0xd8 || marker === 0xd9) continue
    if (offset + 2 > bytes.byteLength) break
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!
    if (length < 2 || offset + length > bytes.byteLength) break
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)) {
      return {
        height: (bytes[offset + 3]! << 8) | bytes[offset + 4]!,
        width: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
        mimeType: 'image/jpeg',
      }
    }
    offset += length
  }
  throw new TypeError('JPEG wallpaper dimensions are unavailable')
}

function inspectWebP(bytes: Uint8Array): StaticImageInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 12
  while (offset + 8 <= bytes.byteLength) {
    const type = ascii(bytes, offset, 4)
    const length = view.getUint32(offset + 4, true)
    const data = offset + 8
    if (type === 'ANIM' || type === 'ANMF') {
      throw new TypeError('Animated WebP wallpaper cannot be compressed')
    }
    if (type === 'VP8X' && length >= 10 && data + 10 <= bytes.byteLength) {
      if ((bytes[data]! & 0x02) !== 0) {
        throw new TypeError('Animated WebP wallpaper cannot be compressed')
      }
      return {
        width: readUint24(bytes, data + 4) + 1,
        height: readUint24(bytes, data + 7) + 1,
        mimeType: 'image/webp',
      }
    }
    if (type === 'VP8 ' && length >= 10 && data + 10 <= bytes.byteLength) {
      if (bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
        return {
          width: view.getUint16(data + 6, true) & 0x3fff,
          height: view.getUint16(data + 8, true) & 0x3fff,
          mimeType: 'image/webp',
        }
      }
    }
    if (type === 'VP8L' && length >= 5 && data + 5 <= bytes.byteLength && bytes[data] === 0x2f) {
      const b1 = bytes[data + 1]!
      const b2 = bytes[data + 2]!
      const b3 = bytes[data + 3]!
      const b4 = bytes[data + 4]!
      return {
        width: 1 + b1 + ((b2 & 0x3f) << 8),
        height: 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
        mimeType: 'image/webp',
      }
    }
    offset = data + length + (length % 2)
  }
  throw new TypeError('WebP wallpaper dimensions are unavailable')
}

function readUint24(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}
