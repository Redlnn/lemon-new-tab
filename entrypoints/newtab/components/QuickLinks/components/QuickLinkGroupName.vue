<script setup lang="ts">
import { MAX_QUICK_LINK_GROUP_NAME_LENGTH } from '@/shared/quickLinks'

const props = defineProps<{
  name: string
  editable?: boolean
  active?: boolean
  plain?: boolean
}>()

const emit = defineEmits<{
  rename: [name: string]
  select: []
}>()

const editing = ref(false)
const draft = ref('')
const isComposing = ref(false)
const inputRef = useTemplateRef<{ focus: () => void }>('inputRef')

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
    type="button"
    class="quick-links__category-item"
    :class="{
      'quick-links__category-item--active': active,
      'quick-links__category-item--plain': plain,
    }"
    :aria-current="active ? 'page' : undefined"
    @click="emit('select')"
    @dblclick.stop="beginEdit"
  >
    {{ name }}
  </button>
</template>

<style scoped lang="scss">
.quick-links__category-item--plain {
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
