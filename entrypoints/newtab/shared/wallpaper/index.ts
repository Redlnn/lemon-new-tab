import { isVideoFile } from '@/shared/media'
import { useSettingsStore } from '@/shared/settings'

import { useDarkWallpaperStorge, useWallpaperStorge } from './wallpaperStorge'
import { useWallpaperUrlStore } from './wallpaperUrlStore'

export * from './wallpaperStorge'
export * from './wallpaperUrlStore'
export * from './bingWallpaper'
export * from './onlineCacheStore'

export async function uploadBackground(imageFile: File, isDarkMode = false) {
  const settings = useSettingsStore()

  const id = crypto.randomUUID()
  const url = URL.createObjectURL(imageFile)

  // 根据模式选择对应的 store & state
  const store = isDarkMode ? useDarkWallpaperStorge : useWallpaperStorge
  const backgroundState = isDarkMode ? settings.background.localDark : settings.background.local
  const previous = { ...backgroundState }

  // 先写入新文件；只有切换成功后才删除旧文件，避免写入失败时丢失当前壁纸。
  const mediaType: 'image' | 'video' = isVideoFile(imageFile) ? 'video' : 'image'
  try {
    await store.setItem<Blob>(id, imageFile)
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }

  if (isDarkMode) settings.background.localDark = { id, url, mediaType }
  else settings.background.local = { id, url, mediaType }

  try {
    await useWallpaperUrlStore().setUrl(isDarkMode ? 'dark' : 'light', url)
  } catch (error) {
    if (isDarkMode) settings.background.localDark = previous
    else settings.background.local = previous
    await store.removeItem(id).catch(() => {})
    URL.revokeObjectURL(url)
    throw error
  }

  const previousUrl = previous.url
  if (previousUrl?.startsWith('blob:') && previousUrl !== url) {
    URL.revokeObjectURL(previousUrl)
  }
  if (previous.id && previous.id !== id) {
    await store.removeItem(previous.id).catch((error) => {
      console.warn('[wallpaper] Failed to remove the previous wallpaper:', error)
    })
  }
}
