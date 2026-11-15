<script setup lang="ts">
import { useSettingsStore } from '@/shared/settings'

import { useDynamicWallpaper } from '@newtab/shared/wallpaper/dynamic/useDynamicWallpaper'
import { createMapScene } from '@newtab/shared/wallpaper/map/mapScene'

const emit = defineEmits<{ error: [] }>()
const canvas = useTemplateRef('canvas')
const background = useTemplateRef('background')
const coast = useTemplateRef('coast')
const details = useTemplateRef('details')
const settings = useSettingsStore()
const { running, getRenderer, fail } = useDynamicWallpaper({
  name: 'map',
  create: (): ReturnType<typeof createMapScene> => {
    if (!canvas.value || !background.value || !coast.value || !details.value)
      throw new Error('Missing canvas')
    return createMapScene(
      background.value,
      canvas.value,
      coast.value,
      details.value,
      () => settings.background.map,
      fail,
    )
  },
  draw: (renderer, time, bounds) => renderer.draw(time, bounds),
  fps: () => settings.background.map.fps,
  onError: () => emit('error'),
})
watch(
  () => [settings.layout, settings.clock, settings.search, settings.dock],
  () => getRenderer()?.invalidateLayout(running.value),
  { deep: true, flush: 'post' },
)
watch(
  () => settings.background.map.islands,
  () => getRenderer()?.invalidateLayout(running.value),
)
</script>

<template>
  <div class="map-background" aria-hidden="true">
    <canvas ref="background" class="map-background__canvas map-background__paper"></canvas>
    <canvas
      ref="coast"
      class="map-background__canvas map-background__coast"
      @webglcontextlost.prevent="getRenderer()?.loseCoastContext()"
    ></canvas>
    <canvas ref="details" class="map-background__canvas"></canvas>
    <canvas ref="canvas" class="map-background__canvas"></canvas>
  </div>
</template>

<style>
.map-background,
.map-background__canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.map-background {
  overflow: hidden;
  pointer-events: none;
  background: #efdcae;
}
</style>
