<script setup lang="ts">
import { useTranslation } from 'i18next-vue'

import { useSettingsStore } from '@/shared/settings'

import { isOnlyTouchDevice } from '@newtab/shared/touch'

const { t } = useTranslation('settings')

const settings = useSettingsStore()
const MAX_TRANSPARENCY = 95

type EffectItem = {
  key: string
  title: string
  transparent: Ref<boolean>
  transparency: Ref<number>
  blur: Ref<boolean>
}

type SwitchItem = {
  key: string
  label: string
  model: Ref<boolean>
  disabled?: Ref<boolean>
}

function formatTransparency(value: number) {
  return `${value}%`
}

function toggleTransparentSettings(enable: boolean) {
  settings.perf.bookmark.transparent = enable
  settings.perf.dialog.transparent = enable
  settings.perf.searchBar.transparent = enable
  settings.perf.actionBtns.transparent = enable
  settings.perf.quickLinks.transparent = enable
  settings.perf.yiyan.transparent = enable
}

function toggleBlurSettings(enable: boolean) {
  settings.perf.bookmark.blur = enable
  settings.perf.dialog.blur = enable
  settings.perf.searchBar.blur = enable
  settings.perf.actionBtns.blur = enable
  settings.perf.quickLinks.blur = enable
  settings.perf.yiyan.blur = enable
  settings.perf.focus.blur = enable
}

function toggleAnimationSettings(enable: boolean) {
  settings.clock.style.blink = enable
  settings.perf.dialog.animation = enable
  settings.perf.focus.scale = enable
  settings.perf.focus.blur = enable
  settings.perf.searchBar.launchAnim = enable
  settings.perf.bgSwitchAnim = enable
  settings.perf.dockScale = enable
  settings.perf.yiyan.ripple = enable
  settings.background.parallax = enable && !isOnlyTouchDevice.value
}

const effectItems = computed<EffectItem[]>(() => [
  {
    key: 'searchBar',
    title: t('search.title'),
    transparent: toRef(settings.perf.searchBar, 'transparent'),
    transparency: toRef(settings.perf.searchBar, 'transparency'),
    blur: toRef(settings.perf.searchBar, 'blur'),
  },
  {
    key: 'quickLinks',
    title: `${t('quickLinks.title')} / Dock`,
    transparent: toRef(settings.perf.quickLinks, 'transparent'),
    transparency: toRef(settings.perf.quickLinks, 'transparency'),
    blur: toRef(settings.perf.quickLinks, 'blur'),
  },
  {
    key: 'yiyan',
    title: t('yiyan.title'),
    transparent: toRef(settings.perf.yiyan, 'transparent'),
    transparency: toRef(settings.perf.yiyan, 'transparency'),
    blur: toRef(settings.perf.yiyan, 'blur'),
  },
  {
    key: 'bookmark',
    title: t('bookmark.title'),
    transparent: toRef(settings.perf.bookmark, 'transparent'),
    transparency: toRef(settings.perf.bookmark, 'transparency'),
    blur: toRef(settings.perf.bookmark, 'blur'),
  },
  {
    key: 'dialog',
    title: t('perf.dialog.title'),
    transparent: toRef(settings.perf.dialog, 'transparent'),
    transparency: toRef(settings.perf.dialog, 'transparency'),
    blur: toRef(settings.perf.dialog, 'blur'),
  },
  {
    key: 'actionBtns',
    title: t('perf.actionBtns.transparent').replace(/透明$/, ''),
    transparent: toRef(settings.perf.actionBtns, 'transparent'),
    transparency: toRef(settings.perf.actionBtns, 'transparency'),
    blur: toRef(settings.perf.actionBtns, 'blur'),
  },
])

const wallpaperAnimationItems = computed<SwitchItem[]>(() => [
  {
    key: 'pauseOnBlur',
    label: t('background.pauseWhenBlur'),
    model: toRef(settings.background, 'pauseOnBlur'),
  },
  {
    key: 'bgSwitchAnim',
    label: t('perf.bgSwitchAnim'),
    model: toRef(settings.perf, 'bgSwitchAnim'),
  },
  {
    key: 'focusScale',
    label: t('perf.focus.scale'),
    model: toRef(settings.perf.focus, 'scale'),
  },
  {
    key: 'focusBlur',
    label: t('perf.focus.blur'),
    model: toRef(settings.perf.focus, 'blur'),
  },
  {
    key: 'parallax',
    label: t('background.parallax'),
    model: toRef(settings.background, 'parallax'),
    disabled: isOnlyTouchDevice,
  },
])

const interfaceAnimationItems = computed<SwitchItem[]>(() => [
  {
    key: 'clockBlink',
    label: t('clock.blink'),
    model: toRef(settings.clock.style, 'blink'),
  },
  {
    key: 'launchAnim',
    label: t('search.launchAnim'),
    model: toRef(settings.perf.searchBar, 'launchAnim'),
  },
  {
    key: 'dockScale',
    label: t('perf.dock.scale'),
    model: toRef(settings.perf, 'dockScale'),
  },
  {
    key: 'ripple',
    label: t('perf.yiyan.ripple'),
    model: toRef(settings.perf.yiyan, 'ripple'),
  },
  {
    key: 'dialogAnimation',
    label: t('perf.dialog.animation'),
    model: toRef(settings.perf.dialog, 'animation'),
  },
])
</script>

<template>
  <div class="performance-preview">
    <section class="perf-panel perf-panel--compact">
      <div class="perf-section-title">{{ t('perf.toggleAll.disable') }}</div>
      <el-space class="perf-action-grid">
        <el-button @click="toggleAnimationSettings(false)">
          {{ t('perf.toggleAll.animation') }}
        </el-button>
        <el-button @click="toggleTransparentSettings(false)">
          {{ t('perf.toggleAll.transparent') }}
        </el-button>
        <el-button @click="toggleBlurSettings(false)">
          {{ t('perf.toggleAll.blur') }}
        </el-button>
      </el-space>
      <div class="perf-section-title perf-section-title--success">
        {{ t('perf.toggleAll.enable') }}
      </div>
      <el-space class="perf-action-grid">
        <el-button @click="toggleAnimationSettings(true)">
          {{ t('perf.toggleAll.animation') }}
        </el-button>
        <el-button @click="toggleTransparentSettings(true)">
          {{ t('perf.toggleAll.transparent') }}
        </el-button>
        <el-button @click="toggleBlurSettings(true)">
          {{ t('perf.toggleAll.blur') }}
        </el-button>
      </el-space>
    </section>

    <section class="perf-panel">
      <h3 class="perf-panel-title">{{ t('perf.effectsTitle') }}</h3>
      <p class="settings__item--note perf-panel-note">
        {{ t('perf.transparencyTip') }}
      </p>

      <div class="perf-effect-list">
        <article v-for="item in effectItems" :key="item.key" class="perf-effect-item">
          <div class="perf-effect-header">{{ item.title }}</div>

          <div class="perf-effect-row">
            <span>{{ t('perf.toggleAll.transparent') }}</span>
            <el-switch v-model="item.transparent.value" />
          </div>

          <div class="perf-slider-row" :class="{ 'is-disabled': !item.transparent.value }">
            <span>{{ t('perf.transparency') }}</span>
            <el-slider
              v-model="item.transparency.value"
              :disabled="!item.transparent.value"
              :max="MAX_TRANSPARENCY"
              :step="1"
              :format-tooltip="formatTransparency"
            />
            <span>{{ formatTransparency(item.transparency.value) }}</span>
          </div>

          <div class="perf-effect-row">
            <span>{{ t('perf.toggleAll.blur') }}</span>
            <el-switch
              v-model="item.blur.value"
              :disabled="!item.transparent.value || item.transparency.value === 0"
            />
          </div>
        </article>
      </div>
    </section>

    <section class="perf-panel">
      <h3 class="perf-panel-title">{{ t('perf.toggleAll.animation') }}</h3>
      <div class="perf-animation-list">
        <article class="perf-animation-card">
          <h4>{{ t('perf.wallpaper') }}</h4>
          <div class="perf-behavior-list">
            <div v-for="item in wallpaperAnimationItems" :key="item.key" class="perf-behavior-row">
              <span>{{ item.label }}</span>
              <el-switch v-model="item.model.value" :disabled="item.disabled?.value" />
            </div>
          </div>
          <p v-if="isOnlyTouchDevice" class="perf-touch-note">
            {{ t('common.touchDeviceDisabledNote') }}
          </p>
        </article>

        <article class="perf-animation-card">
          <h4>{{ t('other.title') }}</h4>
          <div class="perf-behavior-list">
            <div v-for="item in interfaceAnimationItems" :key="item.key" class="perf-behavior-row">
              <span>{{ item.label }}</span>
              <el-switch v-model="item.model.value" />
            </div>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.performance-preview {
  display: grid;
  gap: 14px;
  margin-bottom: 10px;

  .is-mobile & {
    margin-bottom: 25px;
  }
}

.perf-panel {
  padding: 18px 25px;
  background-color: var(--settings-items-background);
  border-radius: 15px;
  transition: background-color var(--el-transition-duration-fast) ease;
}

.perf-panel--compact {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px 14px;
  align-items: center;
}

.perf-section-title {
  font-size: var(--el-font-size-small);
  font-weight: 600;
  color: var(--el-color-danger-dark-2);
  white-space: nowrap;
}

.perf-section-title--success {
  color: var(--el-color-success-dark-2);
}

.perf-action-grid {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.perf-panel-title {
  margin: 0 0 8px;
  font-size: var(--el-font-size-base);
  line-height: 1.4;
}

.perf-panel-note {
  margin-bottom: 12px;
}

.perf-effect-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.perf-effect-item {
  display: grid;
  gap: 5px;
  align-content: start;
  min-width: 0;
  padding: 15px;
  background-color: var(--settings-group-active-background);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}

.perf-effect-header,
.perf-effect-row,
.perf-behavior-row {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
}

.perf-effect-header {
  height: 24px;
  font-size: var(--el-font-size-small);
  font-weight: bold;
  color: var(--el-text-color-primary);
}

.perf-effect-row,
.perf-behavior-row,
.perf-slider-row {
  font-size: var(--el-font-size-small);
  color: var(--el-text-color-regular);
}

.perf-slider-row {
  display: grid;
  grid-template-columns: auto minmax(96px, 1fr) min-content;
  gap: 10px;
  align-items: center;
  font-variant-numeric: tabular-nums;
  transition: opacity var(--el-transition-duration-fast) ease;

  &.is-disabled {
    opacity: 0.45;
  }
}

.perf-animation-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.perf-animation-card {
  display: grid;
  gap: 8px;
  align-content: start;
  min-width: 0;
  padding: 15px;
  background-color: var(--settings-group-active-background);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;

  h4 {
    margin: 0 0 2px;
    font-size: var(--el-font-size-small);
    line-height: 1.4;
    color: var(--el-text-color-primary);
  }
}

.perf-behavior-list {
  display: grid;
  gap: 8px;
}

.perf-touch-note {
  padding: 8px 10px;
  margin: 2px 0 0;
  font-size: var(--el-font-size-extra-small);
  line-height: 1.5;
  color: var(--el-text-color-secondary);
  background-color: var(--settings-items-background);
  border-radius: 8px;
}

@media (width <= 720px) {
  .perf-effect-list,
  .perf-animation-list {
    grid-template-columns: 1fr;
  }
}

@media (width <= 520px) {
  .perf-panel--compact {
    grid-template-columns: 1fr;
  }

  .perf-action-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .perf-action-grid .el-button {
    min-width: 0;
    padding-inline: 8px;
    margin: 0;
  }

  .perf-slider-row {
    grid-template-columns: 1fr 3em;

    .el-slider {
      grid-row: 2;
      grid-column: 1 / -1;
    }
  }
}
</style>
