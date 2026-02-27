<script lang="ts" setup>
import { HeartFilled } from '@vicons/antd'
import {
  AccessTimeFilledRound,
  HelpFilled,
  InfoRound,
  SearchRound,
  SettingsRound,
  WallpaperRound
} from '@vicons/material'
import { useTranslation } from 'i18next-vue'

import { useSettingsStore } from '@/shared/settings'

import usePerfClasses from '@newtab/composables/usePerfClasses'

const emit = defineEmits<{
  (e: 'open-settings'): void
  (e: 'open-changelog'): void
  (e: 'open-about'): void
  (e: 'open-search-engine-preference'): void
  (e: 'open-faq'): void
  (e: 'open-background-switcher'): void
}>()

const { t } = useTranslation()
const settings = useSettingsStore()
const perf = usePerfClasses(() => ({
  transparentOff: settings.perf.disableSettingsBtnTransparent,
  blurOff: settings.perf.disableSettingsBtnBlur
}))
const popperPerfClass = perf('setting-btn__popper')

function sponsorMessage() {
  ElMessageBox.alert(t('sponsor'), t('newtab:menu.sponsor'), {
    closeOnPressEscape: true,
    closeOnClickModal: true
  })
}
</script>

<template>
  <el-dropdown
    style="display: block"
    :popper-class="popperPerfClass"
    :show-arrow="false"
    placement="top-end"
    trigger="click"
    @contextmenu.prevent.stop
  >
    <div role="button" tabindex="0" class="action-btn setting-btn">
      <el-badge is-dot :offset="[2, 1]" :hidden="settings.readChangeLog">
        <el-icon><settings-round /></el-icon>
      </el-badge>
    </div>
    <template #dropdown>
      <el-dropdown-menu class="noselect">
        <el-dropdown-item :icon="SettingsRound" @click="emit('open-settings')">
          <span>{{ t('settings:title') }}</span>
        </el-dropdown-item>
        <el-dropdown-item :icon="SearchRound" @click="emit('open-search-engine-preference')">
          <span>{{ t('menu.searchEnginePreference') }}</span>
        </el-dropdown-item>
        <el-dropdown-item :icon="WallpaperRound" @click="emit('open-background-switcher')">
          <span>{{ t('menu.backgroundPreference') }}</span>
        </el-dropdown-item>
        <el-badge is-dot :offset="[-3, 17]" :hidden="settings.readChangeLog" style="width: 100%">
          <el-dropdown-item :icon="AccessTimeFilledRound" divided @click="emit('open-changelog')">
            <span>{{ t('changelog.title') }}</span>
          </el-dropdown-item>
        </el-badge>
        <el-dropdown-item :icon="HelpFilled" @click="emit('open-faq')">
          <span>{{ t('menu.help') }}</span>
        </el-dropdown-item>
        <el-dropdown-item :icon="HeartFilled" @click="sponsorMessage">
          <span>{{ t('menu.sponsor') }}</span>
        </el-dropdown-item>
        <el-dropdown-item :icon="InfoRound" divided @click="emit('open-about')">
          <span>{{ t('menu.about') }}</span>
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>
