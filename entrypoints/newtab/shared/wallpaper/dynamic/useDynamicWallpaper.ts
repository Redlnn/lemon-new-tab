import { useEventListener, useRafFn } from '@vueuse/core'

import { useSettingsStore } from '@/shared/settings'

import { useWallpaperActivity } from '@newtab/composables/useWallpaperActivity'

import { useDynamicWallpaperNightTheme } from './useDynamicWallpaperTheme'

type DynamicRenderer = {
  resizeViewport: () => boolean
  resize: (bounds: DOMRect | null) => void
  dispose: (contextLost?: boolean) => void
}

export function useDynamicWallpaper<T extends DynamicRenderer>(options: {
  name: string
  create: () => T
  draw: (renderer: T, time: number, bounds: DOMRect | null) => void
  ready?: () => boolean
  fps: () => number
  onError: () => void
}) {
  const settings = useSettingsStore()
  const running = useWallpaperActivity()
  const contextLost = ref(false)
  const canDraw = computed(() => !contextLost.value && running.value && (options.ready?.() ?? true))
  const night = useDynamicWallpaperNightTheme()
  let renderer: T | undefined
  let layoutTimer: ReturnType<typeof setTimeout> | undefined
  let resizeTimer: ReturnType<typeof setTimeout> | undefined
  let resizeObserver: ResizeObserver | undefined
  let mutationObserver: MutationObserver | undefined
  let observed: Element | null = null
  let bounds: DOMRect | null = null
  let elapsed = 0
  let lastTick = 0
  let nextFrame = 0
  let viewportDirty = false
  let disposed = false
  let failed = false

  const fail = () => {
    if (disposed || failed) return
    failed = true
    pauseFrames()
    options.onError()
  }
  const locate = () => {
    if (disposed) return
    const target =
      settings.quickLinks.enabled && !settings.quickLinks.useScroll
        ? document.querySelector('.quick-links__container--current')
        : null
    if (target !== observed) {
      if (observed) resizeObserver?.unobserve(observed)
      observed = target
      if (observed) resizeObserver?.observe(observed)
    }
    const rect = target?.getBoundingClientRect()
    bounds = rect && rect.width > 0 && rect.height > 0 ? rect : null
  }
  const scheduleLayout = () => {
    clearTimeout(layoutTimer)
    layoutTimer = setTimeout(locate, 180)
  }
  const { pause: pauseFrames, resume: resumeFrames } = useRafFn(
    ({ timestamp: now }) => {
      if (!canDraw.value || !renderer || failed) return
      const interval = 1000 / options.fps()
      const due = now + 0.1 >= nextFrame
      try {
        const resized = viewportDirty && renderer.resizeViewport()
        viewportDirty = false
        if (!due && !resized) return
        if (due) {
          // Keep the fractional deadline across display refreshes and drop missed frames.
          const deadline = nextFrame || now
          nextFrame =
            deadline + Math.max(1, Math.floor((now + 0.1 - deadline) / interval) + 1) * interval
        }
        if (lastTick) elapsed += Math.min((now - lastTick) / 1000, 0.1)
        lastTick = now
        options.draw(renderer, elapsed, bounds)
      } catch (error) {
        console.error(`[${options.name}] Could not render:`, error)
        fail()
      }
    },
    { immediate: false },
  )
  const resize = () => {
    clearTimeout(resizeTimer)
    if (!canDraw.value || !renderer || failed) return
    try {
      viewportDirty = false
      locate()
      renderer.resize(bounds)
      scheduleLayout()
      options.draw(renderer, elapsed, bounds)
    } catch (error) {
      console.error(`[${options.name}] Could not resize:`, error)
      fail()
    }
  }
  const updateRunning = () => {
    pauseFrames()
    lastTick = 0
    nextFrame = 0
    if (canDraw.value && renderer && !failed) {
      resize()
      resumeFrames()
    }
  }
  const scheduleResize = () => {
    clearTimeout(resizeTimer)
    if (canDraw.value && renderer && !failed) {
      // Resize the backing canvas before the next paint so the browser never
      // displays a stretched frame. Scene layout remains debounced separately.
      viewportDirty = true
      resizeTimer = setTimeout(resize, 180)
    }
  }
  useEventListener(window, 'resize', scheduleResize)
  useEventListener(window, 'focus', scheduleResize)
  useEventListener(document, 'transitionend', (event: TransitionEvent) => {
    if (event.target instanceof Element && event.target.closest('.quick-links, .app'))
      scheduleLayout()
  })
  watch(canDraw, updateRunning, { flush: 'post' })
  watch(options.fps, () => (nextFrame = 0))
  watch(() => [settings.quickLinks, settings.layout, settings.dock], scheduleLayout, {
    deep: true,
    flush: 'post',
  })
  onMounted(() => {
    try {
      renderer = options.create()
      resizeObserver = new ResizeObserver(scheduleLayout)
      mutationObserver = new MutationObserver(() => {
        if (!settings.quickLinks.enabled || settings.quickLinks.useScroll) return
        const current = document.querySelector('.quick-links__container--current')
        if (current !== observed) scheduleLayout()
      })
      mutationObserver.observe(document.body, { childList: true, subtree: true })
      locate()
      updateRunning()
    } catch (error) {
      console.error(`[${options.name}] Could not initialize renderer:`, error)
      fail()
    }
  })
  onBeforeUnmount(() => {
    disposed = true
    pauseFrames()
    clearTimeout(layoutTimer)
    clearTimeout(resizeTimer)
    resizeObserver?.disconnect()
    mutationObserver?.disconnect()
    renderer?.dispose()
    renderer = undefined
  })
  return {
    running: canDraw,
    night,
    fail,
    loseContext() {
      if (disposed || failed || contextLost.value) return
      contextLost.value = true
      pauseFrames()
      renderer?.dispose(true)
      renderer = undefined
    },
    restoreContext() {
      if (disposed || failed || !contextLost.value) return
      try {
        renderer = options.create()
        contextLost.value = false
      } catch (error) {
        console.error(`[${options.name}] Could not restore renderer:`, error)
        fail()
      }
    },
    getRenderer: () => (failed ? undefined : renderer),
  }
}
