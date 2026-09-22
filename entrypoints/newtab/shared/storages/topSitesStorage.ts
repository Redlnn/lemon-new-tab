import { storage } from '#imports'

import { coordinateStorage } from '@/shared/storage/syncWrite'

// storage key 拼写错误，保持兼容性不改动
const rawStorage = storage.defineItem<string[]>('local:blockedTopStites', {
  fallback: [],
})

export const blockedTopSitesStorage = coordinateStorage(rawStorage)
