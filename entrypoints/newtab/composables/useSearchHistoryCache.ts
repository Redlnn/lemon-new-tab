import { searchHistoriesStorage } from '@newtab/shared/storages/searchHistoriesStorage'

const historiesRef: Ref<string[]> = shallowRef([])
let loaded = false
let loadingPromise: Promise<void> | null = null
let activeConsumers = 0
let stopWatching: (() => void) | null = null
let suppressNextWatch = false

async function loadFromStorage() {
  const list = await searchHistoriesStorage.getValue()
  historiesRef.value = list
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

async function updateStorage(list: string[]) {
  suppressNextWatch = true
  historiesRef.value = list
  await searchHistoriesStorage.setValue(list)
  loaded = true
}

async function addHistory(text: string, limit = 15) {
  if (!text) {
    return
  }
  await ensureLoaded()

  const current = historiesRef.value
  const next: string[] = [text]
  for (let i = 0, len = current.length; i < len && next.length < limit; i++) {
    if (current[i] !== text) {
      next.push(current[i]!)
    }
  }
  await updateStorage(next)
}

async function clearHistories() {
  await ensureLoaded()
  if (historiesRef.value.length === 0) {
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
    histories: readonly(historiesRef),
    ensureLoaded,
    addHistory,
    clearHistories,
  }
}
