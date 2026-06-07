<script setup lang="ts">
import i18next from 'i18next'
import { useTranslation } from 'i18next-vue'
import BubbleChartRound from '~icons/ic/round-bubble-chart'
import CloudOffRound from '~icons/ic/round-cloud-off'

import { BgType } from '@/shared/enums'
import { useSettingsStore } from '@/shared/settings'

import {
  PermissionContext,
  PermissionResult,
  usePermission,
} from '@newtab/composables/usePermission'
import { OPEN_BACKGROUND_PREFERENCE } from '@newtab/shared/keys'
import { isOnlyTouchDevice } from '@newtab/shared/touch'

const { t } = useTranslation('settings')

const settings = useSettingsStore()

const predefineMaskColor = ['#f2f3f5', '#000']

const openBackgroundPreference = inject(OPEN_BACKGROUND_PREFERENCE)

const { checkAndRequestPermission } = usePermission()

const beforeCacheChange = async () => {
  // 已经开了就是想要关，所以允许关
  if (settings.background.online.cache.enabled) return true
  // 不是在线壁纸不允许开
  if (settings.background.bgType !== BgType.Online) return false
  // 没有在线壁纸url不给开
  if (!settings.background.online.url) return false

  const { hostname } = new URL(settings.background.online.url)
  const result = await checkAndRequestPermission(hostname, true, PermissionContext.WallpaperCache)
  const res = result === PermissionResult.GrantedAll
  if (res) ElMessage.success(i18next.t('settings:background.cache.nextStartup'))
  else ElMessage.warning(i18next.t('settings:background.warning.cacheDisabled'))
  return res
}
</script>

<template>
  <div class="settings__items-container">
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">
        {{ t('background.change') }}
        <cloud-off-round />
      </div>
      <el-button
        :icon="BubbleChartRound"
        @click="openBackgroundPreference && openBackgroundPreference()"
      >
        {{ t('search.clickToChange') }}
      </el-button>
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('background.pauseWhenBlur') }}</div>
      <el-switch v-model="settings.background.pauseOnBlur" />
    </div>
    <p class="settings__item--note">
      {{ t('background.video.blurTip') }}
    </p>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('background.fasterBgAnim') }}</div>
      <el-switch v-model="settings.background.fastAnimation" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('background.vignette') }}</div>
      <el-switch v-model="settings.background.vignette" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('background.parallax') }}</div>
      <el-switch v-model="settings.background.parallax" :disabled="isOnlyTouchDevice" />
    </div>
    <p v-if="isOnlyTouchDevice" class="settings__item--note">
      {{ t('common.touchDeviceDisabledNote') }}
    </p>
    <div
      v-if="settings.background.bgType !== BgType.None"
      class="settings__item settings__item--vertical"
    >
      <div class="settings__label">{{ t('background.blur') }}</div>
      <el-slider v-model="settings.background.blur" :show-tooltip="false" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">
        {{ t('background.mask.enable') }}
      </div>
      <el-switch v-model="settings.background.mask.enabled" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('background.mask.color') }}</div>
      <span>
        <span>{{ t('theme.mode.light') }}:&ensp;</span>
        <el-color-picker
          v-model="settings.background.mask.light"
          :predefine="predefineMaskColor"
          show-alpha
          @change="
            () => {
              if (settings.background.mask.light === null) {
                settings.background.mask.light = '#f2f3f5'
              }
            }
          "
        />
        <span style="margin-left: 1em">{{ t('theme.mode.dark') }}:&ensp;</span>
        <el-color-picker
          v-model="settings.background.mask.night"
          :predefine="predefineMaskColor"
          show-alpha
          @change="
            () => {
              if (settings.background.mask.night === null) {
                settings.background.mask.night = '#000'
              }
            }
          "
        />
      </span>
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">
        {{ t('background.cache.label') }}
        <cloud-off-round />
      </div>
      <el-tooltip
        :content="t('background.cache.disabledTip')"
        :disabled="settings.background.bgType === BgType.Online"
        placement="top"
      >
        <el-switch
          v-model="settings.background.online.cache.enabled"
          :disabled="settings.background.bgType !== BgType.Online"
          :before-change="beforeCacheChange"
        />
      </el-tooltip>
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('background.cache.noExpires') }}</div>
      <el-switch
        v-model="settings.background.online.cache.noExpires"
        :disabled="!settings.background.online.cache.enabled"
      />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('background.cache.duration') }}</div>
      <el-input-number
        v-model="settings.background.online.cache.duration"
        :disabled="
          settings.background.bgType !== BgType.Online ||
          !settings.background.online.cache.enabled ||
          settings.background.online.cache.noExpires
        "
        :step="0.1"
        :min="0.1"
        style="width: 150px"
      >
        <template #suffix>
          <span>{{ t('common.hour') }}</span>
        </template>
      </el-input-number>
    </div>
  </div>
</template>
