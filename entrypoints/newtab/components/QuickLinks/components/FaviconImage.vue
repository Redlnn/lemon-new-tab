<script setup lang="ts">
import { getFaviconDisplay } from '@/shared/media'

const props = defineProps<{
  url: string
  favicon?: string
  alt?: string
}>()

// 用户保存的图标不需要解析；移除后再恢复对链接 favicon 的获取。
const displayUrl = computed(() => (props.favicon ? null : props.url))
const faviconDisplay = getFaviconDisplay(displayUrl)
const src = computed(() => props.favicon || faviconDisplay.value.src || undefined)
const pending = computed(() => !props.favicon && faviconDisplay.value.state === 'pending')
</script>

<template>
  <img :src="src" :class="{ 'favicon-image--pending': pending }" :alt="alt" />
</template>
