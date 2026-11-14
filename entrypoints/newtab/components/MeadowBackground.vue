<script setup lang="ts">
import { useSettingsStore } from '@/shared/settings'

import { useDynamicWallpaper } from '@newtab/shared/wallpaper/dynamic/useDynamicWallpaper'
import { createMeadowRenderer } from '@newtab/shared/wallpaper/meadow'

const emit = defineEmits<{ error: [] }>()
const settings = useSettingsStore()
const canvas = useTemplateRef('canvas')
const { running, fail, getRenderer } = useDynamicWallpaper({
  name: 'meadow',
  create: () => {
    if (!canvas.value) throw new Error('Missing canvas')
    return createMeadowRenderer(canvas.value)
  },
  draw: (renderer, time, bounds) =>
    renderer.draw(
      time,
      bounds,
      settings.background.meadow,
      settings.quickLinks.enabled && !settings.quickLinks.useScroll,
    ),
  fps: () => settings.background.meadow.fps,
  onError: () => emit('error'),
})
function moveBoy(x: number, y: number) {
  if (running.value && settings.background.meadow.clickToMove && settings.background.meadow.showBoy)
    getRenderer()?.moveBoy(x, y)
}
defineExpose({ moveBoy })
</script>

<template>
  <div class="meadow-background" aria-hidden="true">
    <canvas
      ref="canvas"
      class="meadow-background__canvas"
      @webglcontextlost.prevent="fail"
    ></canvas>
  </div>
</template>

<style>
.meadow-background,
.meadow-background__canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.meadow-background {
  overflow: hidden;
  pointer-events: none;
}
</style>
