<script setup lang="ts">
import { useSettingsStore } from '@/shared/settings'

import palm1 from '@newtab/assets/beach/palm-1.webp'
import palm2 from '@newtab/assets/beach/palm-2.webp'
import palm3 from '@newtab/assets/beach/palm-3.webp'
import { createBeachScene } from '@newtab/shared/wallpaper/beach/beachScene'
import { useDynamicWallpaper } from '@newtab/shared/wallpaper/dynamic/useDynamicWallpaper'

const emit = defineEmits<{ error: [] }>()
const settings = useSettingsStore()
const canvas = useTemplateRef('canvas')
const treeCanvas = useTemplateRef('trees')
const { fail } = useDynamicWallpaper({
  name: 'beach',
  create: () => {
    if (!canvas.value || !treeCanvas.value) throw new Error('Missing canvas')
    return createBeachScene(canvas.value, treeCanvas.value, [palm1, palm2, palm3])
  },
  draw: (renderer, time, bounds) => renderer.draw(time, bounds, settings.background.beach),
  fps: () => settings.background.beach.fps,
  onError: () => emit('error'),
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
