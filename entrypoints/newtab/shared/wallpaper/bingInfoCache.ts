import { storage } from '#imports'

export interface BingWallpaperInfo {
  wallpaperId: string
  url: string
  copyright: string
  copyrightlink: string
  title: string
  lastCheckTime: number
}

const defaultInfo: BingWallpaperInfo = {
  wallpaperId: '',
  url: '',
  copyright: '',
  copyrightlink: '',
  title: '',
  lastCheckTime: 0,
} as const

export const bingInfoCache = storage.defineItem<BingWallpaperInfo>('local:bingInfo', {
  fallback: defaultInfo,
})
