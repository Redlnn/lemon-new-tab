<script setup lang="ts">
import { useDocumentVisibility, useEventListener, useWindowFocus } from '@vueuse/core'

import { useSettingsStore } from '@/shared/settings'

import palm1 from '@newtab/assets/beach/palm-1.webp'
import palm2 from '@newtab/assets/beach/palm-2.webp'
import palm3 from '@newtab/assets/beach/palm-3.webp'
import { createBeachScene } from '@newtab/shared/wallpaper/beachScene'

const emit = defineEmits<{ error: [] }>()
const settings = useSettingsStore()
const canvas = useTemplateRef('canvas')
const treeCanvas = useTemplateRef('trees')
const visibility = useDocumentVisibility()
const focused = useWindowFocus()
const running = computed(
  () => visibility.value === 'visible' && (!settings.background.pauseOnBlur || focused.value),
)
let renderer: ReturnType<typeof createBeachScene> | undefined
let raf = 0
let lastFrame = 0
let elapsed = 0
let lastTick = 0
let bounds: DOMRect | null = null
let observed: Element | null = null
let resizeObserver: ResizeObserver | undefined
let mutationObserver: MutationObserver | undefined
let layoutTimer: ReturnType<typeof setTimeout> | undefined
let resizeTimer: ReturnType<typeof setTimeout> | undefined
let viewportDirty = false
let disposed = false
let failed = false

function locate() {
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
function scheduleLayout() {
  clearTimeout(layoutTimer)
  layoutTimer = setTimeout(locate, 180)
}
function frame(now: number) {
  if (!running.value || !renderer) return
  raf = requestAnimationFrame(frame)
  if (lastTick) elapsed += Math.min((now - lastTick) / 1000, 0.1)
  lastTick = now
  const interval = 1000 / settings.background.beach.fps
  try {
    const viewportChanged = viewportDirty && renderer.resizeViewport()
    viewportDirty = false
    if (!viewportChanged && lastFrame && now - lastFrame < interval - 1) return
    lastFrame = lastFrame ? Math.max(lastFrame + interval, now - interval) : now
    renderer.draw(elapsed, bounds)
  } catch (error) {
    console.error('[beach] Could not render:', error)
    cancelAnimationFrame(raf)
    fail()
  }
}
function updateRunning() {
  cancelAnimationFrame(raf)
  lastTick = 0
  lastFrame = 0
  if (running.value && renderer && !failed) {
    resize()
    if (!failed) raf = requestAnimationFrame(frame)
  }
}
function resize() {
  clearTimeout(resizeTimer)
  if (!running.value || !renderer) return
  try {
    locate()
    renderer.resize(bounds)
    scheduleLayout()
    renderer.draw(elapsed, bounds)
  } catch (error) {
    console.error('[beach] Could not resize:', error)
    fail()
  }
}
function scheduleResize() {
  clearTimeout(resizeTimer)
  if (running.value && renderer) {
    viewportDirty = true
    resizeTimer = setTimeout(resize, 150)
  }
}
function fail() {
  if (disposed || failed) return
  failed = true
  emit('error')
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
    if (!canvas.value || !treeCanvas.value) throw new Error('Missing canvas')
    renderer = createBeachScene(canvas.value, treeCanvas.value, [palm1, palm2, palm3])
    resizeObserver = new ResizeObserver(scheduleLayout)
    mutationObserver = new MutationObserver(() => {
      const current = document.querySelector('.quick-links__container--current')
      if (!settings.quickLinks.useScroll && current !== observed) scheduleLayout()
    })
    mutationObserver.observe(document.body, { childList: true, subtree: true })
    locate()
    updateRunning()
  } catch (error) {
    console.error('[beach] Could not initialize renderer:', error)
    fail()
  }
})
onBeforeUnmount(() => {
  disposed = true
  cancelAnimationFrame(raf)
  clearTimeout(layoutTimer)
  clearTimeout(resizeTimer)
  resizeObserver?.disconnect()
  mutationObserver?.disconnect()
  renderer?.dispose()
  renderer = undefined
})
</script>

<template>
  <div class="beach-background" aria-hidden="true">
    <canvas ref="canvas" class="beach-background__canvas" @webglcontextlost.prevent="fail"></canvas>
    <canvas ref="trees" class="beach-background__canvas"></canvas>
  </div>
</template>

<style>
.beach-background,
.beach-background__canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.beach-background {
  overflow: hidden;
  pointer-events: none;
}
</style>
