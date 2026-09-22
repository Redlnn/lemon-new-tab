import { defineStore } from 'pinia'

import { createDraftWriter } from '@/shared/storage/syncWrite'

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

  const writer = createDraftWriter(
    customSearchEngineStorage.raw,
    () => ({ items: toRaw(items.value) }),
    (value) => applyItems(value.items),
    defaultCustomSearchEngine,
  )
  const stopWatch = customSearchEngineStorage.watch((value) => value && writer.receive(value))
  onScopeDispose(stopWatch)

  const init = async () => {
    if (loaded.value) return
    if (initTask) return await initTask

    initTask = (async () => {
      const data = await customSearchEngineStorage.getValue()
      writer.reset(data)
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
    await writer.save()
  }

  return { items, loaded, init, replace, save }
})
