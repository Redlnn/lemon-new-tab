import { useQuickLinksStore } from '@/shared/quickLinks'
import { useSettingsStore } from '@/shared/settings'

import { getTopSites } from '../components/QuickLinks/utils/topSites'

export function useQuickLinksBootstrap() {
  const settings = useSettingsStore()
  const quickLinksStore = useQuickLinksStore()
  const quickLinksReady = ref(false)
  let initTask: Promise<void> | null = null

  const shouldLoadTopSites = () =>
    (settings.quickLinks.enabled && settings.quickLinks.topSites) ||
    (settings.dock.enabled && settings.dock.topSites)

  const loadTopSites = (force = false) => {
    if (!shouldLoadTopSites()) return
    void getTopSites(force).catch((error) => {
      console.warn('[quick-links] Failed to load top sites:', error)
    })
  }

  const initialize = async () => {
    if (quickLinksReady.value) return
    if (initTask) return await initTask

    initTask = (async () => {
      await quickLinksStore.init()
      if (settings.quickLinks.grouping) {
        await quickLinksStore.enableGroupingFromItems()
      }
      quickLinksReady.value = true
      loadTopSites()
    })()

    try {
      await initTask
    } finally {
      initTask = null
    }
  }

  watch(
    () => settings.quickLinks.enabled || settings.dock.enabled,
    (enabled) => {
      if (!enabled) return
      void initialize().catch((error) => {
        console.error('[quick-links] Failed to initialize:', error)
      })
    },
    { immediate: true },
  )

  watch(shouldLoadTopSites, (enabled, wasEnabled) => {
    if (quickLinksReady.value && enabled && !wasEnabled) {
      loadTopSites(true)
    }
  })

  return { quickLinksReady: readonly(quickLinksReady) }
}
