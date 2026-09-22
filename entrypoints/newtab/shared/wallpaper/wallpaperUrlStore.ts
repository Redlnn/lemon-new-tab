import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

import { useSettingsStore } from '@/shared/settings'

import { useBingWallpaperStorge } from './wallpaperStorge'

export const useWallpaperUrlStore = defineStore('wallpaperUrl', () => {
  const settings = useSettingsStore()
  const bingUrl = ref('')
  let resolvedId = ''
  let pending: { id: string; task: Promise<typeof bingUrl> } | undefined
  async function getUrl() {
    const id = settings.background.bing.id
    if (resolvedId === id && bingUrl.value) return bingUrl
    if (pending?.id === id) return pending.task
    const task = (async () => {
      const blob = id ? await useBingWallpaperStorge.getItem<Blob>(id) : null
      if (settings.background.bing.id !== id) return bingUrl
      const old = bingUrl.value
      bingUrl.value = blob ? URL.createObjectURL(blob) : ''
      resolvedId = id
      if (old) URL.revokeObjectURL(old)
      return bingUrl
    })()
    pending = { id, task }
    try {
      return await task
    } finally {
      if (pending?.task === task) pending = undefined
    }
  }
  watch(
    () => settings.background.bing.id,
    () => {
      void getUrl().catch(console.error)
    },
  )
  return { bingUrl, getUrl }
})
