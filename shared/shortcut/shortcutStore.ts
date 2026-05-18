import { defineStore } from 'pinia'

import { acquireFaviconRef, releaseFaviconRef } from '@/shared/media'

import { defaultShortcuts, type Shortcuts, shortcutStorage } from './shortcutStorage'

export const useShortcutStore = defineStore('shortcut', () => {
  const items = ref(structuredClone(defaultShortcuts.items))
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

  const applyItems = (nextItems: Shortcuts['items'], options?: { acquire?: boolean }) => {
    items.value = nextItems
    if (options?.acquire ?? true) {
      syncFaviconRefs(nextItems.map((item) => item.url))
    } else {
      syncFaviconRefs([])
    }
  }

  const init = async (options?: { acquire?: boolean }) => {
    const shortcut = await shortcutStorage.getValue()
    applyItems(shortcut.items, options)
  }

  const replace = (data: Shortcuts, options?: { acquire?: boolean }) => {
    applyItems(data.items, options)
  }

  const deinit = () => {
    acquiredUrls.forEach((url) => releaseFaviconRef(url))
    acquiredUrls.clear()
  }

  const save = async (data?: Shortcuts) => {
    if (data) {
      applyItems(data.items)
    } else {
      syncFaviconRefs(toRaw(items.value).map((item) => item.url))
    }
    await shortcutStorage.setValue({ items: toRaw(items.value) })
  }

  return { items, init, replace, deinit, save }
})
