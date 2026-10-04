<script setup lang="ts">
import { onLongPress } from '@vueuse/core'

import { MAX_QUICK_LINK_GROUP_NAME_LENGTH } from '@/shared/quickLinks'

import { isTouchEvent } from '@newtab/shared/touch'

import {
  QUICK_LINK_DND_ACTIVATION_DELAY,
  QUICK_LINK_TOUCH_DRAG_MOVE_THRESHOLD,
} from '../composables/useQuickLinkDnd'

const props = defineProps<{
  name: string
  editable?: boolean
  active?: boolean
  plain?: boolean
  onContextMenu?: (event: MouseEvent | PointerEvent) => void
}>()

const emit = defineEmits<{
  rename: [name: string]
  select: []
}>()

const editing = ref(false)
const draft = ref('')
const isComposing = ref(false)
const inputRef = useTemplateRef<{ focus: () => void }>('inputRef')
const buttonRef = useTemplateRef<HTMLButtonElement>('buttonRef')
let longPressed = false

onLongPress(
  buttonRef,
  (event) => {
    if (!props.onContextMenu || !isTouchEvent(event)) return
    longPressed = true
    props.onContextMenu(event)
  },
  {
    delay: QUICK_LINK_DND_ACTIVATION_DELAY,
    distanceThreshold: QUICK_LINK_TOUCH_DRAG_MOVE_THRESHOLD,
  },
)

function handleContextMenu(event: MouseEvent) {
  if (!props.onContextMenu) return
  event.preventDefault()
  event.stopPropagation()
  props.onContextMenu(event)
}

function handleSelect() {
  if (longPressed) {
    longPressed = false
    return
  }
  emit('select')
}

function handleTouchEnd(event: TouchEvent) {
  if (longPressed) event.preventDefault()
}

function beginEdit() {
  if (!props.editable) return
  draft.value = props.name
  editing.value = true
  nextTick(() => inputRef.value?.focus())
}

function finishEdit() {
  if (!editing.value) return
  editing.value = false
  emit('rename', draft.value)
}

function handleCompositionStart() {
  isComposing.value = true
}

function handleCompositionEnd() {
  isComposing.value = false
}

function cancelEdit(event?: Event | KeyboardEvent) {
  if (isComposing.value || (event instanceof KeyboardEvent && event.isComposing)) {
    return
  }
  editing.value = false
  draft.value = props.name
}

defineExpose({ beginEdit })
</script>

<template>
  <el-input
    v-if="editing"
    ref="inputRef"
    v-model="draft"
    class="quick-links__category-input"
    :maxlength="MAX_QUICK_LINK_GROUP_NAME_LENGTH"
    size="small"
    @compositionstart="handleCompositionStart"
    @compositionend="handleCompositionEnd"
    @blur="finishEdit"
    @keyup.enter="finishEdit"
    @keydown.esc="cancelEdit"
    @click.stop
  />
  <button
    v-else
    ref="buttonRef"
    type="button"
    class="quick-links__category-item"
    :class="{
      'quick-links__category-item--active': active,
      'quick-links__category-item--plain': plain,
    }"
    :aria-current="active ? 'page' : undefined"
    @pointerdown="longPressed = false"
    @touchend="handleTouchEnd"
    @click="handleSelect"
    @contextmenu="handleContextMenu"
    @dblclick.stop="beginEdit"
  >
    {{ name }}
  </button>
</template>

<style scoped lang="scss">
.quick-links__category-item--plain {
  display: inline-flex;
  padding: 0;
  font-size: inherit;
  font-weight: inherit;
  color: var(--quick-links-group-title-color, inherit);
  background: transparent;
  border-radius: 0;

  &:hover,
  &:focus-visible {
    background: transparent;
  }
}
</style>
