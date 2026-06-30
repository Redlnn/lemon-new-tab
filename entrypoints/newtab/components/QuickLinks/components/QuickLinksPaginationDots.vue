<script setup lang="ts">
import { useTranslation } from 'i18next-vue'

defineProps<{
  currentPage: number
  totalPages: number
}>()

const emit = defineEmits<{
  goto: [page: number]
}>()

const { t } = useTranslation()
</script>

<template>
  <div
    class="quick-links__pagination"
    :class="{ 'quick-links__pagination--hidden': totalPages <= 1 }"
    :aria-hidden="totalPages <= 1"
    role="navigation"
    :aria-label="t('newtab:a11y.quickLinksPagination')"
  >
    <button
      v-for="page in Math.max(totalPages, 1)"
      :key="page"
      class="quick-links__pagination-dot"
      :class="{ 'quick-links__pagination-dot--active': currentPage === page - 1 }"
      :aria-label="t('newtab:a11y.goToPage', { page })"
      :aria-current="currentPage === page - 1 ? 'page' : undefined"
      :tabindex="totalPages > 1 ? 0 : -1"
      @click="emit('goto', page - 1)"
    />
  </div>
</template>
