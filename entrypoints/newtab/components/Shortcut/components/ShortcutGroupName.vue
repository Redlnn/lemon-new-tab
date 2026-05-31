<script setup lang="ts">
import { MAX_SHORTCUT_GROUP_NAME_LENGTH } from '@/shared/shortcut'

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

function cancelEdit() {
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
    class="shortcut__category-input"
    :maxlength="MAX_SHORTCUT_GROUP_NAME_LENGTH"
    size="small"
    @blur="finishEdit"
    @keyup.enter="finishEdit"
    @keyup.esc="cancelEdit"
    @click.stop
  />
  <button
    v-else
    type="button"
    class="shortcut__category-item"
    :class="{
      'shortcut__category-item--active': active,
      'shortcut__category-item--plain': plain,
    }"
    @click="emit('select')"
    @dblclick.stop="beginEdit"
  >
    {{ name }}
  </button>
</template>

<style scoped lang="scss">
.shortcut__category-item--plain {
  padding: 0;
  font-size: inherit;
  font-weight: inherit;
  color: var(--shortcut-group-title-color, inherit);
  background: transparent;
  border-radius: 0;

  &:hover,
  &:focus-visible {
    background: transparent;
  }
}
</style>
