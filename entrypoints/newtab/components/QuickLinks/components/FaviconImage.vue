<script setup lang="ts">
import type { Component } from 'vue'

import { getFaviconDisplay } from '@/shared/media'
import { useSettingsStore } from '@/shared/settings'

const props = defineProps<{
  url: string
  favicon?: string
  icon?: Component
  title?: string
  alt?: string
}>()

const settings = useSettingsStore()
// 用户保存的图标不需要解析；移除后再恢复对链接 favicon 的获取。
const displayUrl = computed(() => (props.favicon || props.icon ? null : props.url))
const faviconDisplay = getFaviconDisplay(
  displayUrl,
  computed(() => !settings.quickLinks.fallbackToTitleInitial),
)
const src = computed(() => props.favicon || faviconDisplay.value.src || undefined)
const pending = computed(
  () => !props.favicon && !props.icon && faviconDisplay.value.state === 'pending',
)
const fallbackInitial = computed(() => {
  const title = props.title?.trim()
  return title ? String.fromCodePoint(title.codePointAt(0)!) : ''
})
const showTitleInitialFallback = computed(
  () =>
    settings.quickLinks.fallbackToTitleInitial &&
    !props.favicon &&
    !props.icon &&
    faviconDisplay.value.state === 'fallback' &&
    Boolean(fallbackInitial.value),
)
</script>

<template>
  <component v-if="icon" :is="icon" class="favicon-image__component" aria-hidden="true" />
  <span v-else-if="showTitleInitialFallback" class="favicon-image__title-initial">
    {{ fallbackInitial }}
  </span>
  <img v-else :src="src" :class="{ 'favicon-image--pending': pending }" :alt="alt" />
</template>
