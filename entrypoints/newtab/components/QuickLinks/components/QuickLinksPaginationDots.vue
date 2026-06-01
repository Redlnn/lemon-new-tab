<script setup lang="ts">
defineProps<{
  currentPage: number
  totalPages: number
}>()

const emit = defineEmits<{
  goto: [page: number]
}>()
</script>

<template>
  <div
    class="quick-links__pagination"
    :class="{ 'quick-links__pagination--hidden': totalPages <= 1 }"
    :aria-hidden="totalPages <= 1"
  >
    <button
      v-for="page in Math.max(totalPages, 1)"
      :key="page"
      class="quick-links__pagination-dot"
      :class="{ 'quick-links__pagination-dot--active': currentPage === page - 1 }"
      :aria-label="`Go to page ${page}`"
      :tabindex="totalPages > 1 ? 0 : -1"
      @click="emit('goto', page - 1)"
    />
  </div>
</template>
