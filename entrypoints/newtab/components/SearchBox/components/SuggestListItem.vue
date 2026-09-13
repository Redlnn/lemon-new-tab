<script setup lang="ts">
import type { Component } from 'vue'

const props = defineProps<{
  id?: string
  text: string
  active: boolean
  icon?: Component
  prefix?: string
  actionLabel?: string
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
    :class="{
      'search-suggestion-area__item--active': active,
      'search-suggestion-area__item--action': prefix,
    }"
    role="option"
    :aria-selected="active"
    @click="emit('click')"
    @mouseover="emit('hover')"
    @mouseout="emit('leave')"
  >
    <el-icon v-if="icon" class="search-suggestion-area__item-icon">
      <component :is="icon" />
    </el-icon>
    <span v-if="prefix" class="search-suggestion-area__item-prefix">{{ prefix }}&nbsp;</span>
    <span class="search-suggestion-area__item-text">{{ props.text }}</span>
    <span v-if="actionLabel" class="search-suggestion-area__item-action">{{ actionLabel }}</span>
  </div>
</template>
