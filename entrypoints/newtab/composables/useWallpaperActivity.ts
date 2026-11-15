import { useDocumentVisibility, useEventListener } from '@vueuse/core'

import { browser } from '#imports'

import { useSettingsStore } from '@/shared/settings'

export function useWallpaperActivity() {
  const settings = useSettingsStore()
  const visibility = useDocumentVisibility()
  const windowFocused = ref(true)
  let windowId: number | undefined
  let disposed = false
  let requestId = 0
  let refreshTimer: ReturnType<typeof setTimeout> | undefined

  const refreshFocus = () => {
    const request = ++requestId
    void Promise.all([browser.windows.getCurrent(), browser.windows.getLastFocused()])
      .then(([currentWindow, focusedWindow]) => {
        if (disposed || request !== requestId || currentWindow.id === undefined) return
        windowId = currentWindow.id
        windowFocused.value = focusedWindow.focused && focusedWindow.id === windowId
      })
      .catch((error: unknown) => {
        console.warn('[background] Could not determine browser window focus:', error)
      })
  }

  const scheduleRefresh = () => {
    clearTimeout(refreshTimer)
    // The browser window can finish changing focus after the page's blur event.
    refreshTimer = setTimeout(refreshFocus, 100)
  }

  const onFocusChanged = (focusedWindowId: number) => {
    requestId++
    if (windowId !== undefined) windowFocused.value = focusedWindowId === windowId
    else scheduleRefresh()
  }

  onMounted(() => {
    browser.windows.onFocusChanged.addListener(onFocusChanged)
    refreshFocus()
  })

  useEventListener(window, 'focus', scheduleRefresh)
  useEventListener(window, 'blur', scheduleRefresh)
  useEventListener(document, 'visibilitychange', scheduleRefresh)

  onBeforeUnmount(() => {
    disposed = true
    clearTimeout(refreshTimer)
    browser.windows.onFocusChanged.removeListener(onFocusChanged)
  })

  return computed(
    () =>
      (visibility.value === 'visible' || !settings.background.pauseWhenHidden) &&
      (!settings.background.pauseWhenHidden ||
        visibility.value !== 'visible' ||
        !settings.background.pauseOnBlur ||
        windowFocused.value),
  )
}
