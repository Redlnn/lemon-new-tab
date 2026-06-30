<script lang="ts" setup>
import { useTranslation } from 'i18next-vue'
import BookmarkTwotone from '~icons/ic/twotone-bookmark'

const emit = defineEmits<{
  (e: 'open-bookmark-sidebar'): void
}>()

const { t } = useTranslation()
</script>

<template>
  <div
    role="button"
    tabindex="0"
    :aria-label="t('a11y.openBookmarks')"
    class="action-btn bookmark-btn"
    @click="emit('open-bookmark-sidebar')"
    @keydown.enter="emit('open-bookmark-sidebar')"
    @keydown.space.prevent="emit('open-bookmark-sidebar')"
  >
    <el-icon><bookmark-twotone /></el-icon>
  </div>
</template>
