import { idbClear, idbGet, idbSet } from '@/shared/storage/idb'
import type { CachedImage } from '@/shared/storage/idb'

function logOnlineWallpaperCacheFailure(
  operation: 'read' | 'write' | 'clear',
  error: unknown,
  url?: string,
) {
  const target = url ? ` for ${url}` : ''
  console.warn(`[wallpaper-cache] ${operation} failure${target}:`, error)
}

/**
 * 获取缓存的在线壁纸
 * @param url 壁纸URL
 * @returns 缓存的数据，如果不存在则返回 null
 */
export async function getCachedOnlineWallpaper(url: string): Promise<CachedImage | null> {
  try {
    return (await idbGet('onlineWallpaperCache', url)) ?? null
  } catch (error) {
    logOnlineWallpaperCacheFailure('read', error, url)
    return null
  }
}

/**
 * 缓存在线壁纸
 * @param url 壁纸URL
 * @param cacheData 缓存数据（Blob + 时间戳）
 */
export async function cacheOnlineWallpaper(url: string, cacheData: CachedImage): Promise<void> {
  try {
    await idbSet('onlineWallpaperCache', url, cacheData)
  } catch (error) {
    logOnlineWallpaperCacheFailure('write', error, url)
  }
}

/**
 * 清除所有在线壁纸缓存
 */
export async function clearAllOnlineWallpaperCache(url?: string): Promise<void> {
  try {
    if (url) URL.revokeObjectURL(url)
    await idbClear('onlineWallpaperCache')
  } catch (error) {
    logOnlineWallpaperCacheFailure('clear', error, url)
  }
}
