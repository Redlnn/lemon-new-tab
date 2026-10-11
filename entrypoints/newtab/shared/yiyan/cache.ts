import { storage } from '#imports'

import type { YiyanProviderKey, YiyanResult } from './providers'

type YiyanCache = {
  provider: YiyanProviderKey
  res: YiyanResult
  ts: number
}

const LAST_GOOD_KEY = 'local:lemon:yiyan:lastGood'
const REFRESH_TTL = 10 * 60 * 1000

const yiyanLastGoodStorage = storage.defineItem<YiyanCache | null>(LAST_GOOD_KEY, {
  fallback: null,
})

export async function getYiyanCache(): Promise<YiyanCache | null> {
  try {
    return await yiyanLastGoodStorage.getValue()
  } catch {
    return null
  }
}

export async function setYiyanCache(provider: YiyanProviderKey, res: YiyanResult): Promise<void> {
  // 成功结果可用于当前页面刷新和下一次冷启动。
  const payload: YiyanCache = {
    provider,
    res,
    ts: Date.now(),
  }
  try {
    await yiyanLastGoodStorage.setValue(payload)
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
