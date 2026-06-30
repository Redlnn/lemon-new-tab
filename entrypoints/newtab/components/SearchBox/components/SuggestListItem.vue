<script setup lang="ts">
const props = defineProps<{
  id?: string
  text: string
  active: boolean
}>()

const emit = defineEmits<{
  click: []
  hover: []
  leave: []
}>()
</script>

<template>
  <div
    :id="id"
    class="search-suggestion-area__item noselect"
    :class="{ 'search-suggestion-area__item--active': active }"
    role="option"
    :aria-selected="active"
    @click="emit('click')"
    @mouseover="emit('hover')"
    @mouseout="emit('leave')"
  >
    {{ props.text }}
  </div>
</template>
