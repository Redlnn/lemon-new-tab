<script setup lang="ts">
import { useColorMode, usePreferredDark, useTimeoutFn } from '@vueuse/core'

import { CloudOffRound } from '@vicons/material'
import i18next from 'i18next'
import { useTranslation } from 'i18next-vue'

import { BgType } from '@/shared/enums'
import { defaultSettings, useSettingsStore } from '@/shared/settings'

import { PermissionResult, usePermission } from '@newtab/composables/usePermission'

const { t } = useTranslation('settings')

const settings = useSettingsStore()
const mode = useColorMode({
  modes: {
    dark: 'dark',
    light: 'light',
    auto: ''
  }
})

const predefineColorsMapClassic = [
  { value: '#3e3e3e', labelKey: 'theme.colorNames.classic.ink' },
  { value: '#9c5333', labelKey: 'theme.colorNames.classic.ochre' },
  { value: '#d75455', labelKey: 'theme.colorNames.classic.crimson' },
  { value: '#ec6800', labelKey: 'theme.colorNames.classic.orangeRed' },
  { value: defaultSettings.theme.primaryColor, labelKey: 'theme.colorNames.classic.yamabuki' },
  { value: '#aacf53', labelKey: 'theme.colorNames.classic.yellowGreen' },
  { value: '#008899', labelKey: 'theme.colorNames.classic.teal' },
  { value: '#1677ff', labelKey: 'theme.colorNames.classic.antBlue' }, // Ant Design Primary
  { value: '#1e50a2', labelKey: 'theme.colorNames.classic.lapisBlue' },
  { value: '#4d5aaf', labelKey: 'theme.colorNames.classic.bellflower' }
]

const predefineColorsMapAcgn = [
  { value: '#39c5bb', labelKey: 'theme.colorNames.acgn.miku' },
  { value: '#66ccff', labelKey: 'theme.colorNames.acgn.luo' },
  { value: '#3388bb', labelKey: 'theme.colorNames.acgn.mygo' },
  { value: '#730f40', labelKey: 'theme.colorNames.acgn.aveMujica' },
  { value: '#f7b3c2', labelKey: 'theme.colorNames.acgn.bocchi' },
  { value: '#ff2291', labelKey: 'theme.colorNames.acgn.kessoku' },
  { value: '#d90e2c', labelKey: 'theme.colorNames.acgn.togeari' }
]

const predefineColorsMap = [
  { label: 'Classic', options: predefineColorsMapClassic },
  { label: 'ACGN', options: predefineColorsMapAcgn }
]

const predefineColors = predefineColorsMapClassic.concat(predefineColorsMapAcgn).map((i) => i.value)

const isDarkUI = ref(mode.value === 'dark')
const preferredDark = usePreferredDark()

const isAuto = computed(() => mode.store.value === 'auto')
const isAutoUI = ref(isAuto.value)

watch(
  preferredDark,
  () => {
    if (mode.store.value === 'auto') {
      if (preferredDark.value) {
        isDarkUI.value = true
      } else {
        isDarkUI.value = false
      }
    }
  },
  { immediate: true }
)

function changeByPreferred() {
  if (preferredDark.value) {
    document.documentElement.classList.add('dark')
    document.documentElement.classList.remove('light')
    isDarkUI.value = true
  } else {
    document.documentElement.classList.add('light')
    document.documentElement.classList.remove('dark')
    isDarkUI.value = false
  }
}

function changeByUser() {
  if (isDarkUI.value) {
    document.documentElement.classList.add('dark')
    document.documentElement.classList.remove('light')
    isAutoUI.value = false
  } else {
    document.documentElement.classList.add('light')
    document.documentElement.classList.remove('dark')
    isAutoUI.value = false
  }
}

function toggleDark() {
  if (mode.value === 'dark') {
    // 先切换CSS，等待动画结束后，再切换mode
    changeByUser()
    useTimeoutFn(() => {
      mode.store.value = 'light'
    }, 300)
  } else {
    changeByUser()
    useTimeoutFn(() => {
      mode.store.value = 'dark'
    }, 300)
  }
}

function toggleAuto() {
  if (!isAutoUI.value) {
    mode.store.value = isDarkUI.value ? 'dark' : 'light'
    return
  }

  if (isDarkUI.value !== preferredDark.value) {
    // 先切换CSS，等待动画结束后，再切换store
    changeByPreferred()
    useTimeoutFn(() => {
      mode.store.value = 'auto'
    }, 300)
  } else {
    mode.store.value = 'auto'
  }
}

const { checkAndRequestPermission } = usePermission()

const beforeMonetChange = async () => {
  // 已经开了就是想要关，所以允许关
  if (settings.theme.monetColor) return true
  // 无背景不允许开
  if (settings.background.bgType === BgType.None) return false
  // 必应和本地壁纸随便开
  if (settings.background.bgType !== BgType.Online) return true
  if (settings.background.bgType === BgType.Online) {
    // 没有在线壁纸url不给开
    if (!settings.background.online.url) return false
    // 开了缓存说明有权限不再申请
    if (settings.background.online.cacheEnable) return true

    try {
      await ElMessageBox.confirm(
        t('theme.monet.askEnableCache.message'),
        t('theme.monet.askEnableCache.title'),
        { type: 'warning' }
      )
    } catch {
      // 用户取消或关闭对话框：不允许开启
      return false
    }
  }

  // 用户同意开启缓存
  const { hostname } = new URL(settings.background.online.url)
  const result = await checkAndRequestPermission(hostname, true)
  const res = result === PermissionResult.GrantedAll

  if (res) settings.background.online.cacheEnable = true
  else ElMessage.warning(i18next.t('settings:background.warning.monetDisabled'))

  return res
}
</script>

<template>
  <div class="settings__items-container">
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">
        {{ t('theme.darkMode') }}
        <cloud-off-round />
      </div>
      <el-switch v-model="isDarkUI" @change="toggleDark" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">
        {{ t('theme.systemMode') }}
        <cloud-off-round />
      </div>
      <el-switch v-model="isAutoUI" @change="toggleAuto" />
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
    <!-- TODO: i18n -->
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">不活动时淡出页面元素</div>
      <el-switch v-model="settings.theme.idleHide" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('clock.invertColorLight') }}</div>
      <el-switch v-model="settings.clock.invertColor.light" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('clock.invertColorDark') }}</div>
      <el-switch v-model="settings.clock.invertColor.night" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">
        {{ t('shortcut.whiteTextInLightMode') }}
      </div>
      <el-switch v-model="settings.shortcut.whiteTextInLightMode" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('yiyan.invertColorLight') }}</div>
      <el-switch v-model="settings.yiyan.invertColor.light" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('yiyan.invertColorDark') }}</div>
      <el-switch v-model="settings.yiyan.invertColor.night" />
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
</style>
