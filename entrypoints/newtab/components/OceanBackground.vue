<script setup lang="ts">
import { useSettingsStore } from '@/shared/settings'

import { useDynamicWallpaper } from '@newtab/shared/wallpaper/dynamic/useDynamicWallpaper'
import { createOceanRenderer } from '@newtab/shared/wallpaper/ocean'

const emit = defineEmits<{ error: [] }>()
const settings = useSettingsStore()
const canvas = useTemplateRef('canvas')
const { running, night, fail, getRenderer } = useDynamicWallpaper({
  name: 'ocean',
  create: () => {
    if (!canvas.value) throw new Error('Missing canvas')
    return createOceanRenderer(canvas.value)
  },
  draw: (renderer, time, bounds) =>
    renderer.draw(
      time,
      bounds,
      {
        ...settings.background.ocean,
        navigationCloudSize: settings.background.dynamic.navigationCloudSize,
        night: night.value,
        showBoy: false,
        showCat: false,
      },
      settings.quickLinks.enabled && !settings.quickLinks.useScroll,
    ),
  fps: () => settings.background.dynamic.fps,
  onError: () => emit('error'),
})
function ripple(x: number, y: number) {
  if (running.value) getRenderer()?.ripple(x, y)
}
defineExpose({ ripple })
</script>

<template>
  <div class="ocean-background" aria-hidden="true">
    <canvas ref="canvas" class="ocean-background__canvas" @webglcontextlost.prevent="fail"></canvas>
  </div>
</template>

<style>
.ocean-background,
.ocean-background__canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.ocean-background {
  overflow: hidden;
  pointer-events: none;
}
</style>
