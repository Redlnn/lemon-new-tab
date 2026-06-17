import { defineStore } from 'pinia'

import { acquireFaviconRef, releaseFaviconRef } from '@/shared/media'

import {
  customSearchEngineStorage,
  type CustomSearchEngineStorage,
  defaultCustomSearchEngine,
} from './customSearchEngineStorage'

export const useCustomSearchEngineStore = defineStore('customSearchEngine', () => {
  const items = ref(structuredClone(defaultCustomSearchEngine.items))
  const loaded = ref(false)
  const acquiredUrls = new Set<string>()
  let initTask: Promise<void> | null = null

  const syncFaviconRefs = (nextUrls: string[]) => {
    const nextUrlSet = new Set(nextUrls)

    acquiredUrls.forEach((url) => {
      if (!nextUrlSet.has(url)) {
        releaseFaviconRef(url)
        acquiredUrls.delete(url)
      }
    })

    nextUrlSet.forEach((url) => {
      if (!acquiredUrls.has(url)) {
        acquireFaviconRef(url)
        acquiredUrls.add(url)
      }
    })
  }

  const applyItems = (nextItems: CustomSearchEngineStorage['items']) => {
    items.value = nextItems
    syncFaviconRefs(nextItems.map((item) => item.url))
  }

  const init = async () => {
    if (loaded.value) return
    if (initTask) return await initTask

    initTask = (async () => {
      const data = await customSearchEngineStorage.getValue()
      applyItems(data.items)
      loaded.value = true
    })()

    try {
      await initTask
    } finally {
      initTask = null
    }
  }

  const replace = (data: CustomSearchEngineStorage) => {
    applyItems(data.items)
    loaded.value = true
  }

  const deinit = () => {
    acquiredUrls.forEach((url) => releaseFaviconRef(url))
    acquiredUrls.clear()
  }

  const save = async (data?: CustomSearchEngineStorage) => {
    if (data) {
      applyItems(data.items)
      loaded.value = true
    } else {
      if (!loaded.value) {
        await init()
      }
      syncFaviconRefs(toRaw(items.value).map((item) => item.url))
    }
    await customSearchEngineStorage.setValue({ items: toRaw(items.value) })
  }

  return { items, loaded, init, replace, deinit, save }
})
