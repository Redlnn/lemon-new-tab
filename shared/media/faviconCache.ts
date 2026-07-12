import {
  idbClear,
  idbDeleteMany,
  idbGet,
  idbGetAllEntries,
  idbSet,
  idbSetMany,
} from '@/shared/storage/idb'

export type { FaviconCacheEntry } from '@/shared/storage/idb'

export const FAVICON_CACHE_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days in ms
export const FAVICON_CACHE_MAX_ENTRIES = 200

/** 返回指定 origin 的缓存条目；若不存在或发生存储错误则返回 null。
 * 注意：该函数不会检查 TTL。调用方应比较 `entry.fetchedAt` 与 `FAVICON_CACHE_TTL`，并在过期时触发刷新。 */
export async function getFaviconCacheEntry(origin: string) {
  try {
    return (await idbGet('favicon', origin)) ?? null
  } catch {
    return null
  }
}

/** 一次性读取全部持久化缓存，供新标签页挂载前预热 L1。 */
export async function getAllFaviconCacheEntries(): Promise<
  Array<readonly [string, import('@/shared/storage/idb').FaviconCacheEntry]>
> {
  try {
    return await idbGetAllEntries('favicon')
  } catch {
    return []
  }
}

/** 将缓存条目写入（或覆盖）指定 origin。`entry.fetchedAt` 应为 `Date.now()`。
 * 存储失败时会静默忽略错误。 */
export async function setFaviconCacheEntry(
  origin: string,
  entry: import('@/shared/storage/idb').FaviconCacheEntry,
): Promise<void> {
  try {
    await idbSet('favicon', origin, entry)
  } catch {
    // 缓存写入失败时静默处理
  }
}

/** 批量写入缓存条目。 */
export async function setFaviconCacheEntries(
  entries: ReadonlyArray<readonly [string, import('@/shared/storage/idb').FaviconCacheEntry]>,
): Promise<void> {
  try {
    await idbSetMany('favicon', entries)
  } catch {
    // 缓存写入失败时静默处理
  }
}

export function selectFaviconEntriesToDelete(
  entries: ReadonlyArray<readonly [string, import('@/shared/storage/idb').FaviconCacheEntry]>,
  now = Date.now(),
): string[] {
  const freshEntries: Array<readonly [string, import('@/shared/storage/idb').FaviconCacheEntry]> =
    []
  const keysToDelete: string[] = []

  for (const entry of entries) {
    if (now - entry[1].fetchedAt > FAVICON_CACHE_TTL) keysToDelete.push(entry[0])
    else freshEntries.push(entry)
  }

  freshEntries.sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
  keysToDelete.push(...freshEntries.slice(FAVICON_CACHE_MAX_ENTRIES).map(([key]) => key))
  return keysToDelete
}

/** 删除超过 TTL 或 200 条上限的最旧持久化缓存。 */
export async function pruneFaviconCacheEntries(now = Date.now()): Promise<void> {
  try {
    const entries = await idbGetAllEntries('favicon')
    await idbDeleteMany('favicon', selectFaviconEntriesToDelete(entries, now))
  } catch {
    // 缓存整理失败时静默处理
  }
}

/** 清空所有 favicon 持久化缓存。失败时会静默忽略错误。 */
export async function clearFaviconCacheEntries(): Promise<void> {
  try {
    await idbClear('favicon')
  } catch {
    // 缓存清理失败时静默处理
  }
}
