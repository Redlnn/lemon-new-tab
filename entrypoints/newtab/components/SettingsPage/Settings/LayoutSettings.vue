<script setup lang="ts">
import { useTranslation } from 'i18next-vue'

import { useSettingsStore } from '@/shared/settings'
import type { ActionBtnPosition, MainPositionType } from '@/shared/settings/types'

import { isOnlyTouchDevice } from '@newtab/shared/touch'

const { t } = useTranslation('settings')

const settings = useSettingsStore()

const mainPositionOptions: { value: MainPositionType; label: string }[] = [
  { value: 'center', label: 'layout.mainPosition.center' },
  { value: 'dvh', label: 'layout.mainPosition.dvh' },
  { value: 'px', label: 'layout.mainPosition.px' },
]

type BtnCorner = { value: ActionBtnPosition; label: string; topOnly?: true }
const actionBtnOptions: BtnCorner[] = [
  { value: 'top-left', label: 'layout.actionBtn.topLeft', topOnly: true },
  { value: 'top-right', label: 'layout.actionBtn.topRight', topOnly: true },
  { value: 'bottom-left', label: 'layout.actionBtn.bottomLeft' },
  { value: 'bottom-right', label: 'layout.actionBtn.bottomRight' },
]

const dockEnabled = computed(() => settings.dock.enabled)
const quickLinksScrollEnabled = computed(
  () => settings.quickLinks.enabled && settings.quickLinks.useScroll,
)

function selectActionBtn(pos: ActionBtnPosition) {
  if (dockEnabled.value && !pos.startsWith('top')) return
  settings.layout.actionBtnPosition = pos
}
</script>

<template>
  <div class="settings__items-container">
    <!-- main 区域位置 -->
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('layout.mainPosition.label') }}</div>
      <el-select
        v-model="settings.layout.mainPosition.type"
        style="width: 150px"
        popper-class="settings-item-popper"
        :show-arrow="false"
        fit-input-width
      >
        <el-option
          v-for="opt in mainPositionOptions"
          :key="opt.value"
          :value="opt.value"
          :label="t(opt.label)"
          :disabled="quickLinksScrollEnabled && opt.value === 'center'"
        />
      </el-select>
    </div>
    <p v-if="quickLinksScrollEnabled" class="settings__item--note" style="margin-top: 8px">
      {{ t('layout.mainPosition.quickLinksScrollNote') }}
    </p>
    <div
      v-if="settings.layout.mainPosition.type !== 'center'"
      class="settings__item settings__item--vertical"
    >
      <div class="settings__label">
        {{
          settings.layout.mainPosition.type === 'dvh'
            ? t('layout.mainPosition.dvhValue')
            : t('layout.mainPosition.pxValue')
        }}
      </div>
      <el-slider
        v-model="settings.layout.mainPosition.value"
        :min="0"
        :max="settings.layout.mainPosition.type === 'dvh' ? 80 : 500"
        :step="settings.layout.mainPosition.type === 'dvh' ? 1 : 10"
        show-input
        :show-input-controls="false"
        :show-tooltip="false"
      />
    </div>

    <!-- 功能按钮位置 -->
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('layout.actionBtn.label') }}</div>
    </div>
    <div class="settings__item layout-corner-selector">
      <button
        v-for="opt in actionBtnOptions"
        :key="opt.value"
        class="layout-corner-btn"
        :class="{
          'layout-corner-btn--active': settings.layout.actionBtnPosition === opt.value,
          'layout-corner-btn--disabled': dockEnabled && !opt.topOnly,
        }"
        :disabled="dockEnabled && !opt.topOnly"
        @click="selectActionBtn(opt.value)"
      >
        {{ t(opt.label) }}
      </button>
    </div>
    <p v-if="dockEnabled" class="settings__item--note" style="margin-top: 8px">
      {{ t('layout.actionBtn.dockNote') }}
    </p>

    <!-- 不活动时淡出（UI 仅在此处，storage path 仍为 theme.idleHide） -->
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('theme.idleHide') }}</div>
      <el-switch v-model="settings.theme.idleHide" :disabled="isOnlyTouchDevice" />
    </div>
    <p v-if="isOnlyTouchDevice" class="settings__item--note">
      {{ t('common.touchDeviceDisabledNote') }}
    </p>
  </div>
</template>

<style lang="scss" scoped>
.layout-corner-selector {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 4px;
}

.layout-corner-btn {
  padding: 12px 8px;
  font-size: var(--el-font-size-extra-small);
  color: var(--el-text-color-regular);
  cursor: pointer;
  background-color: var(--settings-option-background);
  border: 1.5px solid var(--el-border-color);
  border-radius: 10px;
  transition:
    border-color var(--el-transition-duration-fast) ease,
    background-color var(--el-transition-duration-fast) ease,
    color var(--el-transition-duration-fast) ease;

  &:hover:not(:disabled) {
    color: var(--el-color-primary);
    border-color: var(--el-color-primary-light-3);
  }

  &--active {
    color: var(--el-color-primary);
    background-color: var(--settings-option-active-background);
    border-color: var(--el-color-primary);
  }

  &--disabled {
    color: var(--el-text-color-disabled);
    cursor: not-allowed;
    background-color: var(--el-bg-color-page);
    opacity: 0.6;
  }
}
</style>
