import { storage } from '#imports'

import { coordinateStorage } from '@/shared/storage/syncWrite'

interface CustomSearchEngine {
  id: string
  name: string
  url: string
  icon?: string
}

export interface CustomSearchEngineStorage {
  items: CustomSearchEngine[]
}

export const defaultCustomSearchEngine: CustomSearchEngineStorage = { items: [] }

const rawStorage = storage.defineItem<CustomSearchEngineStorage>('local:customSearchEngine', {
  fallback: structuredClone(defaultCustomSearchEngine),
})

export const customSearchEngineStorage = coordinateStorage(rawStorage)
