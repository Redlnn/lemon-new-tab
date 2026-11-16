import { useEventListener } from '@vueuse/core'

import { useSettingsStore } from '@/shared/settings'

import { useWallpaperActivity } from '@newtab/composables/useWallpaperActivity'

import { useDynamicWallpaperNightTheme } from './useDynamicWallpaperTheme'

type DynamicRenderer = {
  resizeViewport: () => boolean
  resize: (bounds: DOMRect | null) => void
  dispose: () => void
}

export function useDynamicWallpaper<T extends DynamicRenderer>(options: {
  name: string
  create: () => T
  draw: (renderer: T, time: number, bounds: DOMRect | null) => void
  fps: () => number
  onError: () => void
}) {
  const settings = useSettingsStore()
  const running = useWallpaperActivity()
  const night = useDynamicWallpaperNightTheme()
  let renderer: T | undefined
  let raf = 0
  let frameTimer: ReturnType<typeof setTimeout> | undefined
  let layoutTimer: ReturnType<typeof setTimeout> | undefined
  let resizeTimer: ReturnType<typeof setTimeout> | undefined
  let resizeObserver: ResizeObserver | undefined
  let mutationObserver: MutationObserver | undefined
  let observed: Element | null = null
  let bounds: DOMRect | null = null
  let elapsed = 0
  let lastTick = 0
  let lastFrame = 0
  let viewportDirty = false
  let disposed = false
  let failed = false

  const cancelFrame = () => {
    clearTimeout(frameTimer)
    cancelAnimationFrame(raf)
  }
  const fail = () => {
    if (disposed || failed) return
    failed = true
    cancelFrame()
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
  const scheduleFrame = (immediate = false) => {
    if (!running.value || !renderer || failed) return
    const delay = immediate
      ? 0
      : Math.max(0, 1000 / options.fps() - (performance.now() - lastFrame) - 3)
    if (delay > 0) frameTimer = setTimeout(() => (raf = requestAnimationFrame(frame)), delay)
    else raf = requestAnimationFrame(frame)
  }
  const frame = (now: number) => {
    if (!running.value || !renderer || failed) return
    if (lastTick) elapsed += Math.min((now - lastTick) / 1000, 0.1)
    lastTick = now
    const interval = 1000 / options.fps()
    try {
      const viewportChanged = viewportDirty && renderer.resizeViewport()
      viewportDirty = false
      if (viewportChanged || !lastFrame || now - lastFrame >= interval - 1) {
        lastFrame =
          viewportChanged || !lastFrame ? now : Math.max(lastFrame + interval, now - interval)
        options.draw(renderer, elapsed, bounds)
      }
      scheduleFrame()
    } catch (error) {
      console.error(`[${options.name}] Could not render:`, error)
      fail()
    }
  }
  const resize = () => {
    clearTimeout(resizeTimer)
    if (!running.value || !renderer || failed) return
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
    cancelFrame()
    lastTick = 0
    lastFrame = 0
    if (running.value && renderer && !failed) {
      resize()
      scheduleFrame(true)
    }
  }
  const scheduleResize = () => {
    clearTimeout(resizeTimer)
    if (running.value && renderer && !failed) {
      // Resize the backing canvas before the next paint so the browser never
      // displays a stretched frame. Scene layout remains debounced separately.
      viewportDirty = true
      cancelFrame()
      scheduleFrame(true)
      resizeTimer = setTimeout(resize, 180)
    }
  }
  useEventListener(window, 'resize', scheduleResize)
  useEventListener(window, 'focus', scheduleResize)
  useEventListener(document, 'transitionend', (event: TransitionEvent) => {
    if (event.target instanceof Element && event.target.closest('.quick-links, .app'))
      scheduleLayout()
  })
  watch(running, updateRunning)
  watch(() => [settings.quickLinks, settings.layout, settings.dock], scheduleLayout, {
    deep: true,
    flush: 'post',
  })
  onMounted(() => {
    try {
      renderer = options.create()
      resizeObserver = new ResizeObserver(scheduleLayout)
      mutationObserver = new MutationObserver(() => {
        const current = document.querySelector('.quick-links__container--current')
        if (!settings.quickLinks.useScroll && current !== observed) scheduleLayout()
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
    cancelFrame()
    clearTimeout(layoutTimer)
    clearTimeout(resizeTimer)
    resizeObserver?.disconnect()
    mutationObserver?.disconnect()
    renderer?.dispose()
    renderer = undefined
  })
  return { running, night, fail, getRenderer: () => (failed ? undefined : renderer) }
}
