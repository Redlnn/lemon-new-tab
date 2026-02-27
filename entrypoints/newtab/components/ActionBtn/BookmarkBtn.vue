<script lang="ts" setup>
import { BookmarkTwotone } from '@vicons/material'

const emit = defineEmits<{
  (e: 'open-bookmark-sidebar'): void
}>()
</script>

<template>
  <div
    role="button"
    tabindex="0"
    class="action-btn bookmark-btn"
    @click="emit('open-bookmark-sidebar')"
    @keydown.enter="emit('open-bookmark-sidebar')"
  >
    <el-icon><bookmark-twotone /></el-icon>
  </div>
</template>
