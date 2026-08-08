<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    title: string
    summary?: string
    wide?: boolean
    mobileOpen?: boolean
    contentClass?: string
  }>(),
  {
    summary: '',
    wide: true,
    mobileOpen: false,
    contentClass: '',
  },
)

const isMobile = useMediaQuery('(max-width: 599px)')
const open = ref(true)

watch(
  isMobile,
  (mobile) => {
    open.value = mobile ? props.mobileOpen : true
  },
  { immediate: true },
)

function handleSummaryClick(event: MouseEvent) {
  if (!isMobile.value) event.preventDefault()
}

function handleToggle(event: Event) {
  open.value = (event.currentTarget as HTMLDetailsElement).open
}
</script>

<template>
  <details
    class="settings-section"
    :class="{ 'settings-section--wide': wide }"
    :name="isMobile ? 'settings-page-section' : undefined"
    :open="open"
    @toggle="handleToggle"
  >
    <summary @click="handleSummaryClick">
      <span>
        <strong>{{ title }}</strong>
        <small v-if="summary">{{ summary }}</small>
      </span>
      <i aria-hidden="true"></i>
    </summary>
    <div class="settings-section__content" :class="contentClass">
      <slot />
    </div>
  </details>
</template>
