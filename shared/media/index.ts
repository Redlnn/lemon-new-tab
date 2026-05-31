import type { Ref } from 'vue'
import { unref, watch } from 'vue'

export * from './verify'
export {
  acquireFaviconRef,
  clearFaviconCache,
  fetchFaviconWithCache,
  releaseFaviconRef,
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
        if (currentSeq === seq && data) iconUrl.value = data
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
