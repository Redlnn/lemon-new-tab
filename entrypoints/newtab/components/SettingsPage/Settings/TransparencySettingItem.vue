<script setup lang="ts">
defineProps<{
  label: string
  max: number
  formatTooltip: (value: number) => string
}>()

const value = defineModel<number>({ required: true })
</script>

<template>
  <div class="settings__item settings__item--horizontal">
    <div class="settings__label">{{ label }}</div>
    <div class="transparency-control">
      <el-slider
        v-model="value"
        :max="max"
        :step="1"
        :format-tooltip="formatTooltip"
      />
      <span>{{ formatTooltip(value) }}</span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.transparency-control {
  display: grid;
  grid-template-columns: minmax(110px, 180px) 3em;
  gap: 10px;
  align-items: center;
  width: min(240px, 55%);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
</style>
