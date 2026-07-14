import { storeToRefs } from 'pinia'

import i18next from 'i18next'

import { isImageFile } from '@/shared/media'
import enhancedFetch from '@/shared/network/fetch'
import { type BingWallpaperResolution, useSettingsStore } from '@/shared/settings'

import { type BingWallpaperInfo, bingInfoCache } from './bingInfoCache'
import { useBingWallpaperStorge } from './wallpaperStorge'
import { useWallpaperUrlStore } from './wallpaperUrlStore'

interface BingWallpaperImage {
  fullstartdate: number
  url: string
  urlbase: string
  copyright: string
  copyrightlink: string
  title: string
}

interface BingWallpaperResp {
  images: BingWallpaperImage[]
}

const createEmptyInfo = (): BingWallpaperImage => ({
  fullstartdate: 0,
  url: '',
  urlbase: '',
  copyright: '',
  copyrightlink: '',
  title: '',
})

function formatUTCCompact(date: Date): number {
  const Y = date.getUTCFullYear()
  const M = date.getUTCMonth() + 1
  const D = date.getUTCDate()
  const h = date.getUTCHours()
  const m = date.getUTCMinutes()

  return Y * 100000000 + M * 1000000 + D * 10000 + h * 100 + m
}

class BingWallpaperURLGetter {
  private initialized = false
  private initTask: Promise<void> | null = null
  private refreshGeneration = 0
  private activeImageRequest: AbortController | null = null
  private readonly COOLDOWN_MS = 30 * 60 * 1000
  private readonly IMAGE_TIMEOUT_MS = 20 * 1000

  public info: ShallowRef<BingWallpaperImage> = shallowRef(createEmptyInfo())
  public uhdUrl: Ref<string> = ref('')

  public getBgUrl() {
    return storeToRefs(useWallpaperUrlStore()).bingUrl
  }

  public getInfo() {
    return this.info
  }

  private getImageUrls(image: BingWallpaperImage, resolution: BingWallpaperResolution) {
    const baseUrl = `https://www.bing.com${image.urlbase}`
    if (resolution === 'uhd') return [`${baseUrl}_UHD.jpg`]
    return [`${baseUrl}_1920x1080.webp`, `${baseUrl}_1920x1080.jpg`]
  }

  private updateUHDUrl(url: string) {
    const match = url.match(/(?:https?:\/\/[^/]+)?(\/th\?id=[^&]+?)_(?:[0-9]+x[0-9]+|UHD)\.jpg/i)
    this.uhdUrl.value = match ? `https://www.bing.com${match[1]}_UHD.jpg` : ''
  }

  private clearInfo() {
    this.info.value = createEmptyInfo()
    this.uhdUrl.value = ''
  }

  private applyCachedInfo(cache: BingWallpaperInfo, expectedId: string) {
    const currentId = useSettingsStore().background.bing.id
    if (!expectedId || currentId !== expectedId || cache.wallpaperId !== expectedId) {
      if (currentId === expectedId) this.clearInfo()
      return
    }

    this.info.value = {
      ...createEmptyInfo(),
      url: cache.url,
      copyright: cache.copyright,
      copyrightlink: cache.copyrightlink,
      title: cache.title,
    }
    this.updateUHDUrl(cache.url)
  }

  private async syncCachedInfo(expectedId: string) {
    if (!expectedId) {
      this.clearInfo()
      return
    }

    const settings = useSettingsStore()
    const cache = await bingInfoCache.getValue()
    if (settings.background.bing.id !== expectedId) return

    // 旧版本的信息缓存没有 wallpaperId；当本地图片仍有效时可安全补齐关联。
    if (!cache.wallpaperId && cache.url) {
      const migratedCache = { ...cache, wallpaperId: expectedId }
      await bingInfoCache.setValue(migratedCache)
      if (settings.background.bing.id === expectedId) {
        this.applyCachedInfo(migratedCache, expectedId)
      }
      return
    }

    this.applyCachedInfo(cache, expectedId)
  }

  private setupInfoSync() {
    const settings = useSettingsStore()
    watch(
      () => settings.background.bing.id,
      (id) => {
        void this.syncCachedInfo(id).catch((error) => {
          console.warn('[bing-wallpaper] Failed to sync cached information:', error)
        })
      },
    )
    bingInfoCache.watch((cache) => {
      const id = settings.background.bing.id
      if (!cache || !id || cache.wallpaperId !== id) {
        this.clearInfo()
        return
      }
      this.applyCachedInfo(cache, id)
    })
  }

  public async init() {
    if (this.initialized) return
    if (this.initTask) return await this.initTask

    this.initTask = (async () => {
      const settings = useSettingsStore()

      // 兼容旧版 new Date().toDateString() 格式。
      if (typeof settings.background.bing.updateDate === 'string') {
        const parsedDate = new Date(settings.background.bing.updateDate)
        if (!isNaN(parsedDate.getTime())) {
          settings.background.bing.updateDate = formatUTCCompact(parsedDate)
        }
      }

      await this.resolveLocalBingWallpaperURL()
      this.setupInfoSync()
      this.initialized = true

      void this.refresh()
    })()

    try {
      await this.initTask
    } finally {
      this.initTask = null
    }
  }

  private async resolveLocalBingWallpaperURL() {
    const settings = useSettingsStore()
    const { id } = settings.background.bing
    const url = await useWallpaperUrlStore().getUrl('bing')

    if (url.value) {
      await this.syncCachedInfo(id)
      return url
    }

    settings.background.bing.id = ''
    settings.background.bing.url = ''
    settings.background.bing.updateDate = 0
    settings.background.bing.cachedResolution = null
    this.clearInfo()

    await bingInfoCache.setValue({
      wallpaperId: '',
      url: '',
      copyright: '',
      copyrightlink: '',
      title: '',
      lastCheckTime: 0,
    })
    if (id) await useBingWallpaperStorge.removeItem(id)
    await settings.save()
    return null
  }

  private async updateInfoCache(
    image: BingWallpaperImage,
    checkTime: number,
    wallpaperId: string,
  ) {
    try {
      await bingInfoCache.setValue({
        wallpaperId,
        url: image.url,
        copyright: image.copyright,
        copyrightlink: image.copyrightlink,
        title: image.title,
        lastCheckTime: checkTime,
      })
    } catch (error) {
      console.warn('[bing-wallpaper] Failed to cache wallpaper information:', error)
      if (useSettingsStore().background.bing.id === wallpaperId) this.clearInfo()
      return false
    }

    if (useSettingsStore().background.bing.id === wallpaperId) {
      this.info.value = image
      this.updateUHDUrl(image.url)
    }
    return true
  }

  private async resetLastCheckTime(checkTime: number) {
    try {
      const cache = await bingInfoCache.getValue()
      if (cache.lastCheckTime === checkTime) {
        await bingInfoCache.setValue({ ...cache, lastCheckTime: 0 })
      }
    } catch (error) {
      console.warn('[bing-wallpaper] Failed to reset the check time:', error)
    }
  }

  private async fetchWallpaperBlob(
    image: BingWallpaperImage,
    resolution: BingWallpaperResolution,
  ): Promise<Blob | null> {
    // Bing 的 UHD 图片没有 WebP 版本；1080P 保留 JPG 作为兼容回退。
    let lastError: unknown = null

    for (const url of this.getImageUrls(image, resolution)) {
      const controller = new AbortController()
      let timedOut = false
      this.activeImageRequest = controller
      const timeoutId = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, this.IMAGE_TIMEOUT_MS)

      try {
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok) {
          lastError = new Error(`HTTP ${response.status}`)
          continue
        }

        const blob = await response.blob()
        if (!isImageFile(blob)) {
          lastError = new Error(`Unexpected content type: ${blob.type || 'unknown'}`)
          continue
        }
        return blob
      } catch (error) {
        if (controller.signal.aborted && !timedOut) return null
        lastError = error
      } finally {
        clearTimeout(timeoutId)
        if (this.activeImageRequest === controller) this.activeImageRequest = null
      }
    }

    console.error('[bing-wallpaper] Failed to download wallpaper:', lastError)
    return null
  }

  private async cacheWallpaper(
    image: BingWallpaperImage,
    blob: Blob,
    resolution: BingWallpaperResolution,
    generation: number,
    checkTime: number,
  ) {
    const settings = useSettingsStore()
    const isLatest = () =>
      this.refreshGeneration === generation &&
      settings.background.bing.resolution === resolution

    if (!isLatest()) return false

    const bing = settings.background.bing
    const previous = {
      id: bing.id,
      url: bing.url,
      updateDate: bing.updateDate,
      cachedResolution: bing.cachedResolution,
    }
    const newId = crypto.randomUUID()
    await useBingWallpaperStorge.setItem(newId, blob)

    if (!isLatest()) {
      await useBingWallpaperStorge.removeItem(newId)
      return false
    }

    bing.id = newId
    bing.url = ''
    bing.updateDate = image.fullstartdate
    bing.cachedResolution = resolution

    try {
      await settings.save()
    } catch (error) {
      const current = settings.background.bing
      if (current.id === newId) {
        current.id = previous.id
        current.url = previous.url
        current.updateDate = previous.updateDate
        current.cachedResolution = previous.cachedResolution
      }
      await useBingWallpaperStorge.removeItem(newId)
      throw error
    }

    if (settings.background.bing.id !== newId) return false

    // 提交成功后即使元信息写入失败也保留新图片，下一次刷新会重试。
    const infoCached = await this.updateInfoCache(image, checkTime, newId)
    if (!infoCached) await this.resetLastCheckTime(checkTime)

    try {
      await useWallpaperUrlStore().getUrl('bing')
    } catch (error) {
      console.warn('[bing-wallpaper] Failed to resolve the cached wallpaper URL:', error)
    }

    if (previous.id && previous.id !== newId && settings.background.bing.id === newId) {
      try {
        await useBingWallpaperStorge.removeItem(previous.id)
      } catch (error) {
        console.warn('[bing-wallpaper] Failed to remove the previous wallpaper:', error)
      }
    }

    return (
      settings.background.bing.id === newId &&
      settings.background.bing.cachedResolution === resolution
    )
  }

  private notifyRefreshFailure() {
    ElNotification.error({
      title: i18next.t('newtab:notification.bing.title'),
      message: i18next.t('newtab:notification.bing.message'),
    })
  }

  private async runRefresh(force: boolean, notifyOnFailure: boolean) {
    const settings = useSettingsStore()
    const resolution = settings.background.bing.resolution
    const hasRequestedCache = () =>
      Boolean(settings.background.bing.id) &&
      settings.background.bing.cachedResolution === resolution

    let cachedInfo: BingWallpaperInfo | null = null
    try {
      cachedInfo = await bingInfoCache.getValue()
    } catch (error) {
      console.warn('[bing-wallpaper] Failed to read wallpaper information:', error)
    }

    if (
      !force &&
      hasRequestedCache() &&
      cachedInfo &&
      cachedInfo.wallpaperId === settings.background.bing.id &&
      Date.now() - cachedInfo.lastCheckTime < this.COOLDOWN_MS
    ) {
      return true
    }

    const generation = ++this.refreshGeneration
    this.activeImageRequest?.abort()
    this.activeImageRequest = null
    const isLatest = () =>
      this.refreshGeneration === generation &&
      settings.background.bing.resolution === resolution
    const checkTime = Date.now()
    let shouldNotify = false

    try {
      const cache = cachedInfo ?? (await bingInfoCache.getValue())
      await bingInfoCache.setValue({ ...cache, lastCheckTime: checkTime })

      const data = await enhancedFetch<BingWallpaperResp>(
        'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1',
        // 添加 mkt 会使部分地区后续访问 www.bing.com 时发生域名跳转。
        { timeout: 1000 },
      )
      const image = data.images[0]
      if (!image) throw new Error('Bing returned no wallpaper')
      if (!isLatest()) return hasRequestedCache()

      if (
        !force &&
        image.fullstartdate === settings.background.bing.updateDate &&
        hasRequestedCache()
      ) {
        const infoCached = await this.updateInfoCache(
          image,
          checkTime,
          settings.background.bing.id,
        )
        if (!infoCached) await this.resetLastCheckTime(checkTime)
        return true
      }

      const blob = await this.fetchWallpaperBlob(image, resolution)
      if (!isLatest()) return hasRequestedCache()
      shouldNotify = true
      if (!blob) throw new Error('Bing wallpaper download failed')

      const cached = await this.cacheWallpaper(image, blob, resolution, generation, checkTime)
      if (!cached && isLatest()) throw new Error('Bing wallpaper cache was not committed')
      return cached || hasRequestedCache()
    } catch (error) {
      console.error('[bing-wallpaper] Failed to refresh wallpaper:', error)
      if (isLatest()) {
        await this.resetLastCheckTime(checkTime)
        if (!hasRequestedCache()) {
          this.info.value = {
            ...createEmptyInfo(),
            copyright: i18next.t('newtab:notification.bing.message'),
            title: i18next.t('newtab:notification.bing.title'),
          }
        }
        if (notifyOnFailure && shouldNotify) this.notifyRefreshFailure()
      }
      return hasRequestedCache()
    }
  }

  public async refresh(force = false) {
    return await this.runRefresh(force, true)
  }

  public async setResolution(resolution: BingWallpaperResolution) {
    const settings = useSettingsStore()
    const previousResolution = settings.background.bing.resolution

    if (resolution !== '1080p' && resolution !== 'uhd') return false

    if (resolution !== previousResolution) {
      settings.background.bing.resolution = resolution
      try {
        await settings.save()
      } catch (error) {
        settings.background.bing.resolution = previousResolution
        throw error
      }
    }

    const bing = settings.background.bing
    const requiresDownload = !bing.id || bing.cachedResolution !== resolution
    return await this.runRefresh(requiresDownload, false)
  }
}

export const bingWallpaperURLGetter = new BingWallpaperURLGetter()
