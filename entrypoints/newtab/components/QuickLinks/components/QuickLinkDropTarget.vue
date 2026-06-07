<script setup lang="ts">
import { useDroppable } from '@dnd-kit/vue'

import type { QuickLinkDndData } from '../composables/useQuickLinkDnd'

const props = withDefaults(
  defineProps<{
    id: string
    type?: string
    accept?: string | string[]
    disabled?: boolean
    data: QuickLinkDndData
  }>(),
  {
    type: 'quick-link-container',
    accept: 'quick-link',
  },
)

const elementRef = ref<HTMLElement | null>(null)

const { isDropTarget } = useDroppable({
  id: computed(() => props.id),
  element: elementRef,
  type: computed(() => props.type),
  accept: computed(() => props.accept),
  data: computed(() => props.data),
  disabled: computed(() => Boolean(props.disabled)),
})
</script>

<template>
  <div
    ref="elementRef"
    v-bind="$attrs"
    class="quick-link-dnd-drop-target"
    :class="{ 'quick-link-dnd-drop-target--active': isDropTarget }"
  >
    <slot :is-drop-target="isDropTarget" />
  </div>
</template>
