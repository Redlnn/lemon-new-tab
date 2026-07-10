import { defineStore } from 'pinia'

import {
  customSearchEngineStorage,
  type CustomSearchEngineStorage,
  defaultCustomSearchEngine,
} from './customSearchEngineStorage'

export const useCustomSearchEngineStore = defineStore('customSearchEngine', () => {
  const items = ref(structuredClone(defaultCustomSearchEngine.items))
  const loaded = ref(false)
  let initTask: Promise<void> | null = null

  const applyItems = (nextItems: CustomSearchEngineStorage['items']) => {
    items.value = nextItems
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

  const save = async (data?: CustomSearchEngineStorage) => {
    if (data) {
      applyItems(data.items)
      loaded.value = true
    } else {
      if (!loaded.value) {
        await init()
      }
    }
    await customSearchEngineStorage.setValue({ items: toRaw(items.value) })
  }

  return { items, loaded, init, replace, save }
})
