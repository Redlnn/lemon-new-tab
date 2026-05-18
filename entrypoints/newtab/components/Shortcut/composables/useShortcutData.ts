import type { TopSites } from 'webextension-polyfill'

import { shortcutStorage, useShortcutStore, type Shortcut } from '@/shared/shortcut'

import { blockedTopSitesStorage } from '@newtab/shared/storages/topSitesStorage'

import { invalidateTopSitesCache } from '../utils/topSites'

const refreshListeners = new Set<() => void>()
const topSitesReloadRefs = new Set<Ref<boolean>>()
let stopShortcutStorageWatch: (() => void) | null = null
let stopBlockedTopSitesWatch: (() => void) | null = null

function notifyShortcutConsumers() {
  refreshListeners.forEach((listener) => listener())
}

function ensureShortcutWatchers(store: ReturnType<typeof useShortcutStore>) {
  if (!stopShortcutStorageWatch) {
    stopShortcutStorageWatch = shortcutStorage.watch(async (newValue) => {
      if (newValue) {
        store.replace(newValue)
      }
      notifyShortcutConsumers()
    })
  }

  if (!stopBlockedTopSitesWatch) {
    stopBlockedTopSitesWatch = blockedTopSitesStorage.watch(() => {
      topSitesReloadRefs.forEach((needsReload) => {
        needsReload.value = true
      })
      invalidateTopSitesCache()
      notifyShortcutConsumers()
    })
  }
}

function maybeStopShortcutWatchers() {
  if (refreshListeners.size > 0 || topSitesReloadRefs.size > 0) {
    return
  }

  stopShortcutStorageWatch?.()
  stopShortcutStorageWatch = null
  stopBlockedTopSitesWatch?.()
  stopBlockedTopSitesWatch = null
}

/**
 * 快捷方式数据层：
 * - 维护 topSites / shortcuts / mounted / topSitesNeedsReload 状态
 * - 监听 storage 变化并自动调用外部传入的 refresh 回调
 * 注：allItems 合并逻辑由调用方自行定义（不同组件对数据的组织方式不同）
 */
export function useShortcutData(refreshDebounced: () => void) {
  const shortcutStore = useShortcutStore()

  const topSites = shallowRef<TopSites.MostVisitedURL[]>([])
  const shortcuts = shallowRef<Shortcut[]>([])
  const mounted = ref(false)
  const topSitesNeedsReload = ref(true)

  refreshListeners.add(refreshDebounced)
  topSitesReloadRefs.add(topSitesNeedsReload)
  ensureShortcutWatchers(shortcutStore)

  if (getCurrentScope()) {
    onScopeDispose(() => {
      refreshListeners.delete(refreshDebounced)
      topSitesReloadRefs.delete(topSitesNeedsReload)
      maybeStopShortcutWatchers()
    })
  }

  return {
    topSites,
    shortcuts,
    mounted,
    topSitesNeedsReload,
  }
}
