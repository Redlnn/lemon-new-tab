import { storage } from '#imports'

export const searchHistoriesStorage = storage.defineItem<string[]>('local:searchHistories', {
  fallback: [],
})
