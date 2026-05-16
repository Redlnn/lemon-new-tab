<script setup lang="ts">
import { useTimeoutFn } from '@vueuse/core'

import i18next from 'i18next'
import { useTranslation } from 'i18next-vue'
import CloudOffRound from '~icons/ic/round-cloud-off'
import ComputerRound from '~icons/ic/round-computer'
import DarkModeRound from '~icons/ic/round-dark-mode'
import LightModeRound from '~icons/ic/round-light-mode'

import { BgType } from '@/shared/enums'
import { defaultSettings, useSettingsStore } from '@/shared/settings'

import {
  PermissionContext,
  PermissionResult,
  usePermission,
} from '@newtab/composables/usePermission'
import { colorMode as mode, preferredDark } from '@newtab/shared/colorMode'

const { t } = useTranslation('settings')

const settings = useSettingsStore()

const predefineColorsMapClassic = [
  { value: '#3e3e3e', labelKey: 'theme.color.classic.ink' },
  { value: '#9c5333', labelKey: 'theme.color.classic.ochre' },
  { value: '#d75455', labelKey: 'theme.color.classic.crimson' },
  { value: '#ec6800', labelKey: 'theme.color.classic.orangeRed' },
  { value: defaultSettings.theme.primaryColor, labelKey: 'theme.color.classic.yamabuki' },
  { value: '#aacf53', labelKey: 'theme.color.classic.yellowGreen' },
  { value: '#008899', labelKey: 'theme.color.classic.teal' },
  { value: '#1677ff', labelKey: 'theme.color.classic.antBlue' }, // Ant Design Primary
  { value: '#1e50a2', labelKey: 'theme.color.classic.lapisBlue' },
  { value: '#4d5aaf', labelKey: 'theme.color.classic.bellflower' },
]

const predefineColorsMapAcgn = [
  { value: '#39c5bb', labelKey: 'theme.color.acgn.miku' },
  { value: '#66ccff', labelKey: 'theme.color.acgn.luo' },
  { value: '#3388bb', labelKey: 'theme.color.acgn.mygo' },
  { value: '#730f40', labelKey: 'theme.color.acgn.aveMujica' },
  { value: '#f7b3c2', labelKey: 'theme.color.acgn.bocchi' },
  { value: '#ff2291', labelKey: 'theme.color.acgn.kessoku' },
  { value: '#d90e2c', labelKey: 'theme.color.acgn.togeari' },
]

const predefineColorsMap = [
  { label: 'Classic', options: predefineColorsMapClassic },
  { label: 'ACGN', options: predefineColorsMapAcgn },
]

const predefineColors = predefineColorsMapClassic.concat(predefineColorsMapAcgn).map((i) => i.value)

const currentMode = ref(mode.store.value as 'auto' | 'dark' | 'light')

function changeByPreferred() {
  if (preferredDark.value) {
    document.documentElement.classList.add('dark')
    document.documentElement.classList.remove('light')
  } else {
    document.documentElement.classList.add('light')
    document.documentElement.classList.remove('dark')
  }
}

function setColorMode(newMode: 'auto' | 'dark' | 'light') {
  if (newMode === currentMode.value) return

  if (newMode === 'auto') {
    if ((currentMode.value === 'dark') !== preferredDark.value) {
      changeByPreferred()
      useTimeoutFn(() => {
        mode.store.value = 'auto'
      }, 300)
    } else {
      mode.store.value = 'auto'
    }
  } else if (newMode === 'dark') {
    document.documentElement.classList.add('dark')
    document.documentElement.classList.remove('light')
    useTimeoutFn(() => {
      mode.store.value = 'dark'
    }, 300)
  } else {
    document.documentElement.classList.add('light')
    document.documentElement.classList.remove('dark')
    useTimeoutFn(() => {
      mode.store.value = 'light'
    }, 300)
  }

  currentMode.value = newMode
}

const { checkAndRequestPermission } = usePermission()

const beforeMonetChange = async () => {
  // 已经开了就是想要关，所以允许关
  if (settings.theme.monetColor) return true
  // 无背景不允许开
  if (settings.background.bgType === BgType.None) return false
  // 必应随便开，本地壁纸必须是图片才能开
  if (settings.background.bgType === BgType.Bing) return true
  // 本地壁纸必须是图片才能开
  if (settings.background.bgType === BgType.Local) {
    if (
      settings.background.local.mediaType === 'image' ||
      settings.background.localDark.mediaType === 'image'
    )
      return true
    else return false
  }

  // 剩下在线壁纸

  // 没有在线壁纸url不给开
  if (!settings.background.online.url) return false
  // 开了缓存说明有权限不再申请
  if (settings.background.online.cache.enabled) return true

  try {
    await ElMessageBox.confirm(
      t('theme.monet.askEnableCache.message'),
      t('theme.monet.askEnableCache.title'),
      { type: 'warning' },
    )
  } catch {
    // 用户取消或关闭对话框：不允许开启
    return false
  }

  // 用户同意开启缓存
  const { hostname } = new URL(settings.background.online.url)
  const result = await checkAndRequestPermission(hostname, true, PermissionContext.MonetColor)
  const res = result === PermissionResult.GrantedAll

  if (res) settings.background.online.cache.enabled = true
  else ElMessage.warning(i18next.t('settings:background.warning.monetDisabled'))

  return res
}
</script>

<template>
  <div class="settings__items-container">
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">
        {{ t('theme.mode.dark') }}
        <cloud-off-round />
      </div>
    </div>
    <div class="settings__item theme-mode-selector">
      <button
        class="theme-mode-card"
        :class="{ 'theme-mode-card--active': currentMode === 'auto' }"
        @click="setColorMode('auto')"
      >
        <computer-round class="theme-mode-card__icon" />
        <span>{{ t('theme.mode.system') }}</span>
      </button>
      <button
        class="theme-mode-card"
        :class="{ 'theme-mode-card--active': currentMode === 'dark' }"
        @click="setColorMode('dark')"
      >
        <dark-mode-round class="theme-mode-card__icon" />
        <span>{{ t('theme.mode.alwaysOn') }}</span>
      </button>
      <button
        class="theme-mode-card"
        :class="{ 'theme-mode-card--active': currentMode === 'light' }"
        @click="setColorMode('light')"
      >
        <light-mode-round class="theme-mode-card__icon" />
        <span>{{ t('theme.mode.alwaysOff') }}</span>
      </button>
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">
        {{ t('theme.monet.label') }}
        <cloud-off-round />
      </div>
      <el-switch
        v-model="settings.theme.monetColor"
        :disabled="settings.background.bgType === BgType.None"
        :before-change="beforeMonetChange"
      />
    </div>
    <p class="settings__item--note">{{ t('theme.monet.desc') }}</p>
    <div class="settings__item settings__item--horizontal">
      <div
        class="settings__label"
        :style="{ color: settings.theme.monetColor ? 'var(--el-text-color-disabled)' : undefined }"
      >
        {{ t('theme.primaryColor') }}
      </div>
      <div class="settings__theme">
        <el-select
          v-model="settings.theme.primaryColor"
          style="width: 183px"
          popper-class="settings-item-popper"
          :show-arrow="false"
          :disabled="settings.theme.monetColor"
        >
          <el-option-group
            v-for="group in predefineColorsMap"
            :key="group.label"
            :label="group.label"
          >
            <el-option
              v-for="item in group.options"
              :key="item.value"
              :label="t(item.labelKey)"
              :value="item.value"
            >
              <div class="settings__theme-item">
                <el-tag :color="item.value" style="margin-right: 8px" size="small" />
                <span :style="{ color: item.value }">{{ t(item.labelKey) }}</span>
              </div>
            </el-option>
          </el-option-group>
        </el-select>
        <el-color-picker
          v-model="settings.theme.primaryColor"
          :predefine="predefineColors"
          :disabled="settings.theme.monetColor"
        />
      </div>
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">
        {{ t('theme.colorful.label') }}
      </div>
      <el-switch v-model="settings.theme.colorfulMode" />
    </div>
    <p class="settings__item--note">{{ t('theme.colorful.desc') }}</p>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('clock.colorful') }}</div>
      <el-switch v-model="settings.clock.colorfulNum" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('clock.invertColor.light') }}</div>
      <el-switch v-model="settings.clock.style.invertColor.light" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('clock.invertColor.dark') }}</div>
      <el-switch v-model="settings.clock.style.invertColor.night" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">
        {{ t('shortcut.titleWhiteInLight') }}
      </div>
      <el-switch v-model="settings.shortcut.title.whiteInLightMode" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('yiyan.invertColor.light') }}</div>
      <el-switch v-model="settings.yiyan.style.invertColor.light" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('yiyan.invertColor.dark') }}</div>
      <el-switch v-model="settings.yiyan.style.invertColor.night" />
    </div>
  </div>
</template>

<style lang="scss">
.settings__theme {
  display: flex;
  column-gap: 8px;
  align-items: center;
}

.settings__theme-item {
  .el-tag {
    aspect-ratio: 1;
    border: none;
  }
}

.theme-mode-selector {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.theme-mode-card {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  align-items: center;
  justify-content: center;
  padding: 12px 8px;
  font-size: var(--el-font-size-extra-small);
  color: var(--el-text-color-regular);
  cursor: pointer;
  background-color: var(--el-bg-color-page);
  border: 1.5px solid var(--el-border-color);
  border-radius: 10px;
  transition:
    border-color var(--el-transition-duration-fast) ease,
    background-color var(--el-transition-duration-fast) ease,
    color var(--el-transition-duration-fast) ease;

  html.colorful & {
    background-color: var(--el-color-primary-light-9);
  }

  &:hover {
    color: var(--el-color-primary);
    border-color: var(--el-color-primary-light-3);
  }

  &--active {
    color: var(--el-color-primary);
    background-color: var(--el-color-primary-light-9);
    border-color: var(--el-color-primary);

    html.colorful & {
      background-color: var(--el-color-primary-light-8);
    }
  }

  &__icon {
    width: 22px;
    height: 22px;
  }
}
</style>
