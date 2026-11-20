<script setup lang="ts">
import { useDroppable } from '@dnd-kit/vue'

import type { QuickLinkDndData } from '../composables/useQuickLinkDnd'

const props = defineProps<{
  id: string
  disabled?: boolean
  data: QuickLinkDndData
}>()

const elementRef = ref<HTMLElement | null>(null)

useDroppable({
  id: computed(() => props.id),
  element: elementRef,
  type: 'quick-link-container',
  accept: 'quick-link',
  data: computed(() => props.data),
  disabled: computed(() => Boolean(props.disabled)),
})
</script>

<template>
  <div ref="elementRef" v-bind="$attrs" class="quick-link-dnd-drop-target">
    <slot />
  </div>
</template>
