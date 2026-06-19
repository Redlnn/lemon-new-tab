import { storage } from '#imports'

import type { YiyanProviderKey, YiyanResult } from './providers'

type YiyanCache = {
  provider: YiyanProviderKey
  res: YiyanResult
  ts: number
}

const SESSION_KEY = 'session:lemon:yiyan:cache'
const LAST_GOOD_KEY = 'local:lemon:yiyan:lastGood'
const REFRESH_TTL = 10 * 60 * 1000

const yiyanCacheStorage = storage.defineItem<YiyanCache | null>(SESSION_KEY, {
  fallback: null,
})

const yiyanLastGoodStorage = storage.defineItem<YiyanCache | null>(LAST_GOOD_KEY, {
  fallback: null,
})

export async function getYiyanCache(): Promise<YiyanCache | null> {
  // session 缓存减少同一会话重复读取；local last-good 用于新标签页冷启动时立即展示旧内容。
  try {
    const [sessionCache, lastGoodCache] = await Promise.all([
      yiyanCacheStorage.getValue(),
      yiyanLastGoodStorage.getValue(),
    ])
    if (!sessionCache) return lastGoodCache
    if (!lastGoodCache) return sessionCache
    return sessionCache.ts >= lastGoodCache.ts ? sessionCache : lastGoodCache
  } catch {
    return null
  }
}

export async function setYiyanCache(provider: YiyanProviderKey, res: YiyanResult): Promise<void> {
  // 同时写 session 和 local，保证当前会话和下一次冷启动都能复用成功结果。
  const payload: YiyanCache = {
    provider,
    res,
    ts: Date.now(),
  }
  try {
    await Promise.all([yiyanCacheStorage.setValue(payload), yiyanLastGoodStorage.setValue(payload)])
  } catch (err) {
    console.error('setYiyanCache error', err)
  }
}

export function isCacheFresh(cache: YiyanCache | null): boolean {
  if (!cache) {
    return false
  }
  return Date.now() - cache.ts <= REFRESH_TTL
}
