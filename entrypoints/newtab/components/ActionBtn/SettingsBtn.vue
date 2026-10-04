<script lang="ts" setup>
import { useTranslation } from 'i18next-vue'
import HeartFilled from '~icons/ant-design/heart-filled'
import Apps24Regular from '~icons/fluent/apps-24-regular'
import AccessTimeFilledRound from '~icons/ic/round-access-time-filled'
import HelpFilled from '~icons/ic/round-help'
import InfoRound from '~icons/ic/round-info'
import SearchRound from '~icons/ic/round-search'
import SettingsRound from '~icons/ic/round-settings'
import WallpaperRound from '~icons/ic/round-wallpaper'

import { useSettingsStore } from '@/shared/settings'

import { useAppDialogs } from '@newtab/composables/appDialogs'
import usePerfClasses from '@newtab/composables/usePerfClasses'

const dialogs = useAppDialogs()

const { t } = useTranslation()
const settings = useSettingsStore()

const dropdownPlacement = computed(() => {
  const pos = settings.layout.actionBtnPosition
  const vertical = pos.startsWith('top') ? 'bottom' : 'top'
  const horizontal = pos.endsWith('left') ? 'start' : 'end'
  return `${vertical}-${horizontal}` as const
})

const perf = usePerfClasses(() => ({
  transparent: settings.perf.actionBtns.transparent,
  transparency: settings.perf.actionBtns.transparency,
  blur: settings.perf.actionBtns.blur,
}))
const popperPerfClass = perf('setting-btn__popper')

function clickCurrentTarget(event: KeyboardEvent) {
  ;(event.currentTarget as HTMLElement | null)?.click()
}

function sponsorMessage() {
  ElMessageBox.alert(t('sponsor'), t('newtab:menu.sponsor'), {
    closeOnPressEscape: true,
    closeOnClickModal: true,
  })
}
</script>

<template>
  <el-dropdown
    style="display: block"
    :popper-class="popperPerfClass"
    :show-arrow="false"
    :placement="dropdownPlacement"
    trigger="click"
    @contextmenu.prevent.stop
  >
    <div
      role="button"
      tabindex="0"
      class="action-btn setting-btn"
      :aria-label="t('a11y.openActionsMenu')"
      aria-haspopup="menu"
      @keydown.enter.prevent="clickCurrentTarget"
      @keydown.space.prevent="clickCurrentTarget"
    >
      <el-badge is-dot :offset="[2, 1]" :hidden="settings.readChangeLog">
        <el-icon><settings-round /></el-icon>
      </el-badge>
    </div>
    <template #dropdown>
      <el-dropdown-menu class="noselect">
        <el-dropdown-item :icon="SettingsRound" @click="dialogs.open('settings')">
          <span>{{ t('settings:title') }}</span>
        </el-dropdown-item>
        <el-dropdown-item :icon="SearchRound" @click="dialogs.open('searchEngines')">
          <span>{{ t('menu.searchEnginePreference') }}</span>
        </el-dropdown-item>
        <el-dropdown-item :icon="WallpaperRound" @click="dialogs.open('background')">
          <span>{{ t('menu.backgroundPreference') }}</span>
        </el-dropdown-item>
        <el-dropdown-item :icon="Apps24Regular" @click="dialogs.open('builtinApps')">
          <span>{{ t('builtinApps.title') }}</span>
        </el-dropdown-item>
        <el-badge is-dot :offset="[-3, 17]" :hidden="settings.readChangeLog" style="width: 100%">
          <el-dropdown-item
            :icon="AccessTimeFilledRound"
            divided
            @click="dialogs.open('changelog')"
          >
            <span>{{ t('changelog.title') }}</span>
          </el-dropdown-item>
        </el-badge>
        <el-dropdown-item :icon="HelpFilled" @click="dialogs.open('faq')">
          <span>{{ t('menu.help') }}</span>
        </el-dropdown-item>
        <el-dropdown-item :icon="HeartFilled" @click="sponsorMessage">
          <span>{{ t('menu.sponsor') }}</span>
        </el-dropdown-item>
        <el-dropdown-item :icon="InfoRound" divided @click="dialogs.open('about')">
          <span>{{ t('menu.about') }}</span>
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>
