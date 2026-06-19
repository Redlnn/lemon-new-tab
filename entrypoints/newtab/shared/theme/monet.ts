import { applyStoredMonetColors, saveMonetColors } from '@/shared/theme/monetStorage'

import MonetWorker from './monet.worker?worker'

let worker: Worker | null = null
// 用于唯一标识每个 Worker 消息请求
let msgId = 0
// 存储待处理的 Promise resolve 函数，key 为 msgId
const pendingResolves = new Map<
  number,
  (result: { cssLight: Record<string, string>; cssDark: Record<string, string> }) => void
>()
// 存储待处理的 Promise 拒绝函数
const pendingRejects = new Map<number, (error: Error) => void>()

function getWorker() {
  if (!worker) {
    worker = new MonetWorker()
    worker.onmessage = (e) => {
      const { id, cssLight, cssDark, error } = e.data
      if (error) {
        pendingRejects.get(id)?.(error)
      } else {
        pendingResolves.get(id)?.({ cssLight, cssDark })
      }
      pendingResolves.delete(id)
      pendingRejects.delete(id)
    }
    worker.onerror = (e) => {
      console.error('Monet worker error:', e)
    }
  }
  return worker
}

/**
 * 使用了 @material/material-color-utilities 中基于图片提取主题色的逻辑
 * 将图片缩放至64x64以内，并可选择只裁剪中心区域
 * 以便给 QuantizerCelebi.quantize 传入裁剪和缩放后的像素数据，控制性能和效果
 *
 * @param image HTMLImageElement
 * @param cropCenter 是否裁剪只要中心区域
 */
async function getThemeFromImage(
  image: HTMLImageElement,
  cropCenter = false,
): Promise<{ cssLight: Record<string, string>; cssDark: Record<string, string> }> {
  if (!image.complete) {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Image load failed'))
    })
  }

  const MAX_SIZE = 64
  const { naturalWidth, naturalHeight } = image

  if (naturalWidth === 0 || naturalHeight === 0) {
    throw new Error('Image has no dimensions')
  }

  let sx = 0
  let sy = 0
  let sw = naturalWidth
  let sh = naturalHeight

  if (cropCenter) {
    sx = Math.floor(naturalWidth * 0.25)
    sy = Math.floor(naturalHeight * 0.25)
    sw = Math.floor(naturalWidth * 0.5)
    sh = Math.floor(naturalHeight * 0.5)
  }

  let width = sw
  let height = sh

  if (sw > MAX_SIZE || sh > MAX_SIZE) {
    const ratio = Math.min(MAX_SIZE / sw, MAX_SIZE / sh)
    width = Math.round(sw * ratio)
    height = Math.round(sh * ratio)
  }

  // 使用 createImageBitmap 异步缩放
  const bitmap = await createImageBitmap(image, sx, sy, sw, sh, {
    resizeWidth: width,
    resizeHeight: height,
    resizeQuality: 'low',
  })

  return new Promise((resolve, reject) => {
    const id = msgId++
    pendingResolves.set(id, resolve)
    pendingRejects.set(id, reject)
    // 将 bitmap 的所有权转移给 Worker，避免拷贝
    getWorker().postMessage({ id, imageBitmap: bitmap, width, height }, [bitmap])
  })
}

type ApplyMonetOptions = {
  cropCenter?: boolean
  sourceKey?: string
}

export async function applyMonet(
  image: HTMLImageElement | undefined | null,
  options: boolean | ApplyMonetOptions = false,
) {
  if (!image) return

  const cropCenter = typeof options === 'boolean' ? options : (options.cropCenter ?? false)
  const sourceKey = typeof options === 'boolean' ? undefined : options.sourceKey

  let cssLight: Record<string, string>
  let cssDark: Record<string, string>
  try {
    const result = await getThemeFromImage(image, cropCenter)
    cssLight = result.cssLight
    cssDark = result.cssDark
  } catch (e) {
    console.error('Failed to extract source color for Monet theme:', e)
    return
  }

  // 保存莫奈颜色到 storage，供 popup 等其他页面使用
  await saveMonetColors(cssLight, cssDark, sourceKey)

  // 应用莫奈颜色到当前页面
  applyStoredMonetColors({ cssLight, cssDark, timestamp: Date.now(), sourceKey })
}
