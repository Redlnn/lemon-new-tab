import type { TopSites } from 'webextension-polyfill'

import { quickLinksStorage, useQuickLinksStore, type QuickLink } from '@/shared/quickLinks'

import { blockedTopSitesStorage } from '@newtab/shared/storages/topSitesStorage'

const refreshListeners = new Set<() => void>()
const topSitesReloadRefs = new Set<Ref<boolean>>()
let stopQuickLinkStorageWatch: (() => void) | null = null
let stopBlockedTopSitesWatch: (() => void) | null = null

function notifyQuickLinkConsumers() {
  refreshListeners.forEach((listener) => listener())
}

function ensureQuickLinkWatchers(store: ReturnType<typeof useQuickLinksStore>) {
  if (!stopQuickLinkStorageWatch) {
    stopQuickLinkStorageWatch = quickLinksStorage.watch(async (newValue) => {
      if (newValue) {
        store.replace(newValue)
      }
      notifyQuickLinkConsumers()
    })
  }

  if (!stopBlockedTopSitesWatch) {
    stopBlockedTopSitesWatch = blockedTopSitesStorage.watch(() => {
      topSitesReloadRefs.forEach((needsReload) => {
        needsReload.value = true
      })
      void import('../utils/topSites')
        .then(({ invalidateTopSitesCache }) => {
          invalidateTopSitesCache()
        })
        .finally(notifyQuickLinkConsumers)
    })
  }
}

function maybeStopQuickLinkWatchers() {
  if (refreshListeners.size > 0 || topSitesReloadRefs.size > 0) {
    return
  }

  stopQuickLinkStorageWatch?.()
  stopQuickLinkStorageWatch = null
  stopBlockedTopSitesWatch?.()
  stopBlockedTopSitesWatch = null
}

/**
 * 快速导航数据层：
 * - 维护 topSites / quickLinks / mounted / topSitesNeedsReload 状态
 * - 监听 storage 变化并自动调用外部传入的 refresh 回调
 * 注：allItems 合并逻辑由调用方自行定义（不同组件对数据的组织方式不同）
 */
export function useQuickLinksData(refreshDebounced: () => void) {
  const quickLinksStore = useQuickLinksStore()

  const topSites = shallowRef<TopSites.MostVisitedURL[]>([])
  const quickLinks = shallowRef<QuickLink[]>([])
  const mounted = ref(false)
  const topSitesNeedsReload = ref(true)

  refreshListeners.add(refreshDebounced)
  topSitesReloadRefs.add(topSitesNeedsReload)
  ensureQuickLinkWatchers(quickLinksStore)

  if (getCurrentScope()) {
    onScopeDispose(() => {
      refreshListeners.delete(refreshDebounced)
      topSitesReloadRefs.delete(topSitesNeedsReload)
      maybeStopQuickLinkWatchers()
    })
  }

  return {
    topSites,
    quickLinks,
    mounted,
    topSitesNeedsReload,
  }
}
