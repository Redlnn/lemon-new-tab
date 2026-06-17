import { storeToRefs } from 'pinia'

import i18next from 'i18next'

import enhancedFetch from '@/shared/network/fetch'
import { useSettingsStore } from '@/shared/settings'

import { useBingWallpaperStorge, useWallpaperUrlStore } from '.'

import { bingInfoCache } from './bingInfoCache'

interface BingWallpaperImage {
  startdate: number
  fullstartdate: number
  enddate: number
  url: string
  urlbase: string
  copyright: string
  copyrightlink: string
  title: string
  quiz: string
  wp: boolean
  hsh: string
  drk: number
  top: number
  bot: number
  hs: unknown[]
}

interface BingWallpaperResp {
  images: BingWallpaperImage[]
  tooltips: {
    loading: string
    previous: string
    next: string
    walle: string
    walls: string
  }
}

function formatUTCCompact(date: Date): number {
  const Y = date.getUTCFullYear()
  const M = date.getUTCMonth() + 1
  const D = date.getUTCDate()
  const h = date.getUTCHours()
  const m = date.getUTCMinutes()

  // 拼接成 202511111600 这种整数格式再转字符串
  return Y * 100000000 + M * 1000000 + D * 10000 + h * 100 + m
}

class BingWallpaperURLGetter {
  private isRefreshing = false
  private readonly COOLDOWN_MS = 30 * 60 * 1000 // 30 分钟

  public info: ShallowRef<BingWallpaperImage> = shallowRef({
    startdate: 0,
    fullstartdate: 0,
    enddate: 0,
    url: '',
    urlbase: '',
    copyright: '',
    copyrightlink: '',
    title: '',
    quiz: '',
    wp: false,
    hsh: '',
    drk: 0,
    top: 0,
    bot: 0,
    hs: [],
  })
  public uhdUrl: Ref<string> = ref('')

  public getBgUrl() {
    return storeToRefs(useWallpaperUrlStore()).bingUrl
  }

  public getInfo() {
    return this.info
  }

  private toWebp(url: string) {
    return url.replace(/\/th\?id=([^&]+)_([0-9x]+|UHD)\.jpg.*$/, '/th?id=$1_$2.webp')
  }

  private updateUHDUrl(url: string) {
    this.uhdUrl.value = url.replace(
      /\/th\?id=([^&]+)_([0-9x]+|UHD)\.jpg.*$/,
      'https://bing.com/th?id=$1_UHD.jpg',
    )
  }

  public async init() {
    const settings = useSettingsStore()

    // 兼容旧版逻辑：如果 updateDate 存在，迁移到 startdate
    if (typeof settings.background.bing.updateDate === 'string') {
      // 将旧版的 new Date().toDateString() 格式转换为 ISO 格式
      const parsedDate = new Date(settings.background.bing.updateDate)
      if (!isNaN(parsedDate.getTime())) {
        settings.background.bing.updateDate = formatUTCCompact(parsedDate)
        // await settings.save()
      }
    }

    await this.resolveLocalBingWallpaperURL()

    void this.refresh() // 后台检查更新，不阻塞壁纸上屏
  }

  private async resolveLocalBingWallpaperURL() {
    const settings = useSettingsStore()
    const { id } = settings.background.bing
    const wallpaperUrlStore = useWallpaperUrlStore()

    // 尝试从 store 获取 URL (会自动处理缓存和从 DB 加载)
    const url = await wallpaperUrlStore.getUrl('bing')

    if (url.value) {
      const cache = await bingInfoCache.getValue()
      this.info.value = {
        ...this.info.value,
        url: cache.url,
        copyright: cache.copyright,
        copyrightlink: cache.copyrightlink,
        title: cache.title,
      }
      this.updateUHDUrl(cache.url)
      return url
    }

    // 如果获取失败（文件不存在或不是图片），则清除相关数据和缓存
    settings.background.bing.id = ''
    settings.background.bing.updateDate = 0
    await bingInfoCache.setValue({
      url: '',
      copyright: '',
      copyrightlink: '',
      title: '',
      lastCheckTime: 0,
    })
    await useBingWallpaperStorge.removeItem(id)
    await this.revokeSettingsURL()
    return null
  }

  private async revokeSettingsURL() {
    const settings = useSettingsStore()

    try {
      if (settings.background.bing.url && settings.background.bing.url.startsWith('blob:')) {
        URL.revokeObjectURL(settings.background.bing.url)
      }
    } catch {}
    settings.background.bing.url = ''
  }

  public async refresh(force = false) {
    // 同一标签页并发保护：如果已有刷新在进行中且非强制，跳过
    if (this.isRefreshing && !force) return
    this.isRefreshing = true

    try {
      const settings = useSettingsStore()

      let data: BingWallpaperResp | null = null

      // 跨标签页冷却期检查（force=true 时绕过）
      if (!force) {
        const cached = await bingInfoCache.getValue()
        if (Date.now() - cached.lastCheckTime < this.COOLDOWN_MS) return
      }

      // 立即更新 lastCheckTime，防止其他标签页在本次请求完成前重复发起
      const checkTime = Date.now()
      {
        const cached = await bingInfoCache.getValue()
        await bingInfoCache.setValue({ ...cached, lastCheckTime: checkTime })
      }

      try {
        data = await enhancedFetch<BingWallpaperResp>(
          'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1',
          // &mkt=zh-CN 加上区域后会导致后续访问 www.bing.com 被跳转到 cn.bing.com
          { timeout: 1000 },
        )
        this.info.value = data.images[0]!
        this.updateUHDUrl(data.images[0]!.url)
        if (data.images[0]!.fullstartdate === settings.background.bing.updateDate && !force) {
          // 最新更新日期等于上次更新日期，无需下载
          return
        }
        // 不等于则重新获取（跳出try）并更新info
        await bingInfoCache.setValue({
          url: data.images[0]!.url,
          copyright: data.images[0]!.copyright,
          copyrightlink: data.images[0]!.copyrightlink,
          title: data.images[0]!.title,
          lastCheckTime: checkTime,
        })
      } catch (error) {
        console.error(error)
        // API 请求失败：重置 lastCheckTime，允许下次打开新标签页时重试
        try {
          const cached = await bingInfoCache.getValue()
          await bingInfoCache.setValue({ ...cached, lastCheckTime: 0 })
        } catch {}
        const cache = await bingInfoCache.getValue()
        if (cache.url.length === 0) {
          // 如果没有缓存
          this.info.value = {
            ...this.info.value,
            copyright: i18next.t('newtab:notification.bing.message'),
            title: i18next.t('newtab:notification.bing.title'),
          }
        }
        return
      }

      const imgUrl = this.toWebp(`https://www.bing.com${data.images[0]!.url}`)

      try {
        const response = await fetch(imgUrl)
        if (!response.ok) {
          // 兜底：网络请求失败，直接使用在线URL
          useWallpaperUrlStore().setUrl('bing', imgUrl)
          return
        }

        const blob = await response.blob()
        const file = new File([blob], 'bing.jpg', { type: blob.type })

        // 清除上次壁纸
        await useBingWallpaperStorge.clear()
        await this.revokeSettingsURL()

        // 保存图片到IndexedDB
        const id = crypto.randomUUID()
        const url = URL.createObjectURL(file)
        await useBingWallpaperStorge.setItem<Blob>(id, file)
        settings.background.bing = {
          id: id,
          url: url,
          updateDate: data.images[0]!.fullstartdate,
        }
        await settings.save()
        await useWallpaperUrlStore().setUrl('bing', url)
      } catch (error) {
        console.error('Failed to get Bing wallpaper:', error)
        ElNotification.error({
          title: i18next.t('newtab:notification.bing.title'),
          message: i18next.t('newtab:notification.bing.message'),
        })
        throw error
      }
    } finally {
      this.isRefreshing = false
    }
  }
}

export const bingWallpaperURLGetter = new BingWallpaperURLGetter()
