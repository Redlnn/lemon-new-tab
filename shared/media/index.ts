import type { Ref } from 'vue'
import { unref, watch } from 'vue'

export * from './verify'
export {
  clearFaviconCache,
  fetchFaviconWithCache,
  hydrateFaviconCache,
  setFaviconCacheEnabled,
  warmFaviconCache,
} from './faviconFetch'

import { fetchFaviconWithCache, peekFaviconFromL1 } from './faviconFetch'

export function getFaviconURL(url: string | Ref<string | null>): Ref<string> {
  const iconUrl = ref('/favicon.png')
  let seq = 0

  const resolve = (u: string | null | undefined) => {
    if (!u) {
      iconUrl.value = '/favicon.png'
      return
    }
    const currentSeq = ++seq
    // 同步检查 L1 缓存：有则直接复用，避免翻页等场景中组件重建时出现图标闪烁；
    // 无则重置为占位图，等待异步获取完成后再更新
    iconUrl.value = peekFaviconFromL1(u) ?? '/favicon.png'

    fetchFaviconWithCache(u)
      .then((data) => {
        if (!data) return
        requestAnimationFrame(() => {
          if (currentSeq === seq) iconUrl.value = data
        })
      })
      .catch(() => {})
  }

  const initial = unref(url)
  resolve(initial)

  if (isRef(url)) {
    watch(url, (v) => resolve(v))
  }

  return iconUrl
}

export function createFaviconUrlResolver() {
  const faviconRefMap = new Map<string, Ref<string>>()

  return (url: string, cacheKey = url): string => {
    if (!faviconRefMap.has(cacheKey)) {
      faviconRefMap.set(cacheKey, getFaviconURL(url))
    }
    return faviconRefMap.get(cacheKey)!.value
  }
}

export type FaviconDisplayState = 'pending' | 'ready' | 'fallback'

export interface FaviconDisplay {
  src: string
  state: FaviconDisplayState
}

const FAVICON_PRELOAD_TIMEOUT = 5_000

function waitForAnimationFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const next = () => {
      if (count-- <= 1) {
        resolve()
        return
      }
      requestAnimationFrame(next)
    }
    requestAnimationFrame(next)
  })
}

function preloadFavicon(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image()
    let settled = false

    const finish = (success: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      image.onload = null
      image.onerror = null
      if (!success) image.src = ''
      resolve(success)
    }

    const timeout = window.setTimeout(() => finish(false), FAVICON_PRELOAD_TIMEOUT)
    image.onload = () => {
      try {
        const decodeTask = image.decode?.()
        if (!decodeTask) {
          finish(true)
          return
        }
        void decodeTask.catch(() => {}).then(() => finish(true))
      } catch {
        finish(true)
      }
    }
    image.onerror = () => finish(false)
    image.src = src
  })
}

/**
 * 返回 favicon 的展示状态。L1 未命中时保持图标位空白，避免默认图标在真实图标到达前闪现。
 */
export function getFaviconDisplay(url: string | Ref<string | null>): Ref<FaviconDisplay> {
  const display = ref<FaviconDisplay>({ src: '', state: 'pending' })
  let seq = 0

  const resolve = async (u: string | null | undefined) => {
    const currentSeq = ++seq
    if (!u) {
      display.value = { src: '/favicon.png', state: 'fallback' }
      return
    }

    const useCachedFavicon = () => {
      const cached = peekFaviconFromL1(u)
      if (!cached) return false
      display.value = { src: cached, state: 'ready' }
      return true
    }

    if (useCachedFavicon()) return
    display.value = { src: '', state: 'pending' }

    // 给启动阶段的 L1 预热两个帧的机会，避免不必要的图标请求，但不阻塞卡片和文字渲染。
    await waitForAnimationFrames(2)
    if (currentSeq !== seq) return
    if (useCachedFavicon()) return

    const favicon = await fetchFaviconWithCache(u).catch(() => null)
    if (currentSeq !== seq) return
    if (!favicon || !(await preloadFavicon(favicon)) || currentSeq !== seq) {
      if (currentSeq === seq) display.value = { src: '/favicon.png', state: 'fallback' }
      return
    }

    requestAnimationFrame(() => {
      if (currentSeq === seq) display.value = { src: favicon, state: 'ready' }
    })
  }

  resolve(unref(url))
  if (isRef(url)) watch(url, resolve)

  return display
}
