import { storage } from '#imports'

import type { SearchHistoryEntryV1 } from '@/shared/webdavSync'

export interface SearchHistoryDataV1 {
  version: 1
  items: SearchHistoryEntryV1[]
}

const defaultSearchHistoryData: SearchHistoryDataV1 = { version: 1, items: [] }

export const searchHistoriesStorage = storage.defineItem<SearchHistoryDataV1>(
  'local:searchHistories',
  { fallback: structuredClone(defaultSearchHistoryData) },
)

function isSearchHistoryEntry(value: unknown): value is SearchHistoryEntryV1 {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<SearchHistoryEntryV1>
  return (
    typeof entry.id === 'string' &&
    typeof entry.text === 'string' &&
    typeof entry.createdAt === 'string' &&
    Number.isFinite(Date.parse(entry.createdAt))
  )
}

function migrateSearchHistory(value: unknown): SearchHistoryDataV1 {
  if (Array.isArray(value)) {
    const migratedAt = Date.now()
    return {
      version: 1,
      items: value
        .filter((item): item is string => typeof item === 'string')
        .map((text, index) => ({
          id: crypto.randomUUID(),
          text,
          createdAt: new Date(migratedAt - index).toISOString(),
        })),
    }
  }

  if (value && typeof value === 'object') {
    const data = value as Partial<SearchHistoryDataV1>
    if (data.version === 1 && Array.isArray(data.items)) {
      return { version: 1, items: data.items.filter(isSearchHistoryEntry) }
    }
  }
  return structuredClone(defaultSearchHistoryData)
}

export async function getSearchHistoryData(): Promise<SearchHistoryDataV1> {
  const raw = await storage.getItem<unknown>(searchHistoriesStorage.key)
  const data = migrateSearchHistory(raw)
  if (raw === null || JSON.stringify(raw) !== JSON.stringify(data)) {
    await searchHistoriesStorage.setValue(data)
  }
  return data
}
