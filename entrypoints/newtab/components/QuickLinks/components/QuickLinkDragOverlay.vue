<script setup lang="ts">
import { getFaviconURL } from '@/shared/media'

import type { QuickLinkDndData } from '../composables/useQuickLinkDnd'

const props = defineProps<{
  data?: QuickLinkDndData | null
}>()

const iconUrl = computed(() => {
  if (props.data?.kind !== 'quick-link') return ''
  return props.data.favicon || getFaviconURL(props.data.url).value
})
</script>

<template>
  <div
    v-if="data?.kind === 'quick-link'"
    class="quick-link-dnd-overlay"
    :class="`quick-link-dnd-overlay--${data.source}`"
  >
    <div class="quick-link-dnd-overlay__icon">
      <span :style="{ backgroundImage: `url(${iconUrl})` }"></span>
    </div>
    <div class="quick-link-dnd-overlay__title">{{ data.title }}</div>
  </div>
</template>
