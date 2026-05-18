import { defineStore } from 'pinia'

import { acquireFaviconRef, releaseFaviconRef } from '@/shared/media'

import {
  customSearchEngineStorage,
  type CustomSearchEngineStorage,
  defaultCustomSearchEngine,
} from './customSearchEngineStorage'

export const useCustomSearchEngineStore = defineStore('customSearchEngine', () => {
  const items = ref(structuredClone(defaultCustomSearchEngine.items))
  const acquiredUrls = new Set<string>()

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
    const data = await customSearchEngineStorage.getValue()
    applyItems(data.items)
  }

  const replace = (data: CustomSearchEngineStorage) => {
    applyItems(data.items)
  }

  const deinit = () => {
    acquiredUrls.forEach((url) => releaseFaviconRef(url))
    acquiredUrls.clear()
  }

  const save = async (data?: CustomSearchEngineStorage) => {
    if (data) {
      applyItems(data.items)
    } else {
      syncFaviconRefs(toRaw(items.value).map((item) => item.url))
    }
    await customSearchEngineStorage.setValue({ items: toRaw(items.value) })
  }

  return { items, init, replace, deinit, save }
})
