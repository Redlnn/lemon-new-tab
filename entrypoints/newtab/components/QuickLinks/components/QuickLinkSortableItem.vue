<script setup lang="ts">
import { useSortable } from '@dnd-kit/vue/sortable'

import {
  QUICK_LINK_DND_CLICK_SUPPRESS_DURATION,
  QUICK_LINK_TOUCH_CONTEXT_MENU_EVENT,
  type QuickLinkDndData,
} from '../composables/useQuickLinkDnd'

const props = withDefaults(
  defineProps<{
    id: string
    index: number
    group?: string
    type?: string
    accept?: string | string[]
    disabled?: boolean
    data: QuickLinkDndData
  }>(),
  {
    type: 'quick-link',
    accept: 'quick-link',
  },
)

const emit = defineEmits<{
  touchMenu: [event: PointerEvent, data: QuickLinkDndData]
}>()

const elementRef = ref<HTMLElement | null>(null)
let suppressClickUntil = 0

const { isDragging, isDropTarget } = useSortable({
  id: computed(() => props.id),
  index: computed(() => props.index),
  group: computed(() => props.group),
  element: elementRef,
  handle: elementRef,
  type: computed(() => props.type),
  accept: computed(() => props.accept),
  data: computed(() => props.data),
  disabled: computed(() => Boolean(props.disabled)),
  transition: {
    duration: 150,
    easing: 'ease',
  },
})

function handleTouchContextMenu(event: Event) {
  const nativeEvent = (event as CustomEvent<{ event?: PointerEvent }>).detail?.event
  if (nativeEvent) emit('touchMenu', nativeEvent, props.data)
}

watch(isDragging, (dragging, wasDragging) => {
  if (!dragging && wasDragging) {
    suppressClickUntil = Date.now() + QUICK_LINK_DND_CLICK_SUPPRESS_DURATION
  }
})

function handleClickCapture(event: MouseEvent) {
  if (isDragging.value || Date.now() < suppressClickUntil) {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
}
</script>

<template>
  <div
    ref="elementRef"
    v-bind="$attrs"
    class="quick-link-dnd-sortable"
    :class="{
      'quick-link-dnd-sortable--dragging': isDragging,
      'quick-link-dnd-sortable--drop-target': isDropTarget,
    }"
    @click.capture="handleClickCapture"
    @[QUICK_LINK_TOUCH_CONTEXT_MENU_EVENT].stop="handleTouchContextMenu"
  >
    <slot :is-dragging="isDragging" :is-drop-target="isDropTarget" />
  </div>
</template>
