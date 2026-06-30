<script lang="ts" setup>
import { useTranslation } from 'i18next-vue'
import RefreshRound from '~icons/ic/round-refresh'

const emit = defineEmits<{
  (e: 'refresh-background'): void
}>()

const { t } = useTranslation()
</script>

<template>
  <div
    role="button"
    tabindex="0"
    :aria-label="t('a11y.refreshBackground')"
    class="action-btn refresh-btn"
    @click="emit('refresh-background')"
    @keydown.enter="emit('refresh-background')"
    @keydown.space.prevent="emit('refresh-background')"
  >
    <el-icon><refresh-round /></el-icon>
  </div>
</template>
