import type { SearchHistoryEntryV1 } from '@/shared/webdavSync'

import {
  getSearchHistoryData,
  searchHistoriesStorage,
} from '@newtab/shared/storages/searchHistoriesStorage'

const entriesRef: Ref<SearchHistoryEntryV1[]> = shallowRef([])
const histories = computed(() => entriesRef.value.map((entry) => entry.text))
let loaded = false
let loadingPromise: Promise<void> | null = null
let activeConsumers = 0
let stopWatching: (() => void) | null = null
let suppressNextWatch = false

async function loadFromStorage() {
  const data = await getSearchHistoryData()
  entriesRef.value = data.items
}

async function ensureLoaded(force = false) {
  if (force) {
    loaded = false
  }
  if (loaded) {
    return
  }
  if (!loadingPromise) {
    loadingPromise = loadFromStorage().finally(() => {
      loadingPromise = null
      loaded = true
    })
  }
  await loadingPromise
}

function retainWatcher() {
  activeConsumers += 1

  if (!stopWatching) {
    stopWatching = searchHistoriesStorage.watch(async () => {
      if (suppressNextWatch) {
        suppressNextWatch = false
        return
      }
      await loadFromStorage()
      loaded = true
    })
  }

  return () => {
    activeConsumers = Math.max(0, activeConsumers - 1)
    if (activeConsumers > 0) {
      return
    }

    stopWatching?.()
    stopWatching = null
  }
}

async function updateStorage(items: SearchHistoryEntryV1[]) {
  suppressNextWatch = true
  entriesRef.value = items
  await searchHistoriesStorage.setValue({ version: 1, items })
  loaded = true
}

async function addHistory(text: string, limit = 15) {
  if (!text) {
    return
  }
  await ensureLoaded()

  const current = entriesRef.value
  const existing = current.find((entry) => entry.text === text)
  const next: SearchHistoryEntryV1[] = [
    {
      id: existing?.id ?? crypto.randomUUID(),
      text,
      createdAt: new Date().toISOString(),
    },
  ]
  for (let i = 0, len = current.length; i < len && next.length < limit; i++) {
    if (current[i]?.text !== text) {
      next.push(current[i]!)
    }
  }
  await updateStorage(next)
}

async function clearHistories() {
  await ensureLoaded()
  if (entriesRef.value.length === 0) {
    return
  }
  await updateStorage([])
}

export function useSearchHistoryCache() {
  const releaseWatcher = retainWatcher()

  if (getCurrentScope()) {
    onScopeDispose(releaseWatcher)
  }

  return {
    histories: readonly(histories),
    entries: readonly(entriesRef),
    ensureLoaded,
    addHistory,
    clearHistories,
  }
}
