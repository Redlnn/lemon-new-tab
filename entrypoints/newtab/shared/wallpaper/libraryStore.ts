import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'

import { useSettingsStore } from '@/shared/settings'
import { idbGet } from '@/shared/storage/idb'
import {
  allocateWallpaper,
  emptyWallpaperLibrary,
  readWallpaperLibrary,
  updateWallpaperLibrary,
  wallpaperStore,
  type WallpaperItem,
  type WallpaperVariant,
} from '@/shared/wallpaperLibrary'

export const useLocalWallpaperStore = defineStore('localWallpaperLibrary', () => {
  const settings = useSettingsStore()
  const library = shallowRef(emptyWallpaperLibrary())
  const selected = ref<Record<WallpaperVariant, string>>({ light: '', dark: '' })
  const displayed = shallowRef<{
    variant: WallpaperVariant
    item: WallpaperItem
    url: string
  } | null>(null)
  let initTask: Promise<void> | undefined
  let selectionTask: Promise<void> | undefined
  const allocations = new Map<WallpaperVariant, Promise<string>>()
  const urls = new Map<string, Promise<string>>()
  const channel = new BroadcastChannel('lemon-wallpaper-library')
  channel.onmessage = () => {
    void reload()
  }

  async function reload() {
    library.value = await readWallpaperLibrary()
  }
  function init() {
    return (initTask ??= reload().catch((error) => {
      initTask = undefined
      throw error
    }))
  }
  async function changed() {
    await reload()
    channel.postMessage(null)
    const { sendSyncDataChanged } = await import('@/shared/webdavSync/notifications')
    sendSyncDataChanged()
  }
  async function select(variant: WallpaperVariant, id: string) {
    await updateWallpaperLibrary((value) => {
      if (value[variant].items.some((item) => item.id === id)) value[variant].fixedId = id
    })
    selected.value = { ...selected.value, [variant]: id }
    await changed()
  }
  async function choose(variant: WallpaperVariant, advance = false) {
    await init()
    selectionTask ??= Promise.all(
      (['light', 'dark'] as const).map(async (group) => {
        if (selected.value[group] || !library.value[group].items.length) return
        const id = await allocateWallpaper(
          group,
          settings.background.rotation.enabled,
          settings.background.rotation.order,
        )
        if (!selected.value[group]) selected.value = { ...selected.value, [group]: id }
      }),
    ).then(() => {})
    await selectionTask
    const group = library.value[variant]
    if (!advance && group.items.some((item) => item.id === selected.value[variant]))
      return selected.value[variant]
    let pending = allocations.get(variant)
    if (!pending) {
      pending = allocateWallpaper(variant, advance, settings.background.rotation.order)
      allocations.set(variant, pending)
    }
    try {
      const id = await pending
      selected.value = { ...selected.value, [variant]: id }
      return id
    } finally {
      allocations.delete(variant)
    }
  }
  function getUrl(variant: WallpaperVariant, item: WallpaperItem) {
    const key = `${variant}:${item.id}:${item.sha256 ?? ''}`
    let pending = urls.get(key)
    if (!pending) {
      pending = idbGet(wallpaperStore(variant), item.id)
        .then((blob) => {
          if (!(blob instanceof Blob)) throw new Error('Wallpaper file is missing')
          return URL.createObjectURL(blob)
        })
        .catch((error) => {
          urls.delete(key)
          throw error
        })
      urls.set(key, pending)
    }
    return pending
  }
  function releaseExcept(keys: Set<string>) {
    for (const [key, pending] of urls) {
      if (keys.has(key)) continue
      urls.delete(key)
      void pending.then((url) => URL.revokeObjectURL(url)).catch(() => {})
    }
  }
  return {
    library,
    selected,
    displayed,
    init,
    reload,
    changed,
    select,
    choose,
    getUrl,
    releaseExcept,
  }
})

/** 解码完成才替换画面，视频只等待首帧，不在后台播放。 */
export async function prepareWallpaper(url: string, video: boolean): Promise<void> {
  if (!video) {
    const image = new Image()
    image.src = url
    await image.decode()
    return
  }
  await new Promise<void>((resolve, reject) => {
    const element = document.createElement('video')
    const timer = window.setTimeout(() => finish(new Error('Video preview timed out')), 15000)
    const finish = (error?: Error) => {
      clearTimeout(timer)
      element.onloadeddata = null
      element.onerror = null
      element.removeAttribute('src')
      element.load()
      if (error) reject(error)
      else resolve()
    }
    element.muted = true
    element.preload = 'auto'
    element.onloadeddata = () => finish()
    element.onerror = () => finish(new Error('Video could not be decoded'))
    element.src = url
  })
}
