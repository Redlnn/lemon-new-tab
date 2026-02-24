<script setup lang="ts">
import './bg-switcher.scss'

import { storeToRefs } from 'pinia'
import { useDark, useElementSize } from '@vueuse/core'

import { Plus } from '@vicons/fa'
import {
  Brightness6Twotone,
  CloseRound,
  CloudQueueTwotone,
  DarkModeTwotone,
  DownloadRound,
  FolderCopyRound,
  HideImageTwotone,
  InsertLinkRound,
  LaunchRound,
  LightModeTwotone,
  TripOriginRound
} from '@vicons/material'
import type { UploadRequestOptions } from 'element-plus'
import { useTranslation } from 'i18next-vue'

import { BgType } from '@/shared/enums'
import { useSettingsStore } from '@/shared/settings'

import Bing from '@newtab/assets/bing_gray.svg'
import BaseDialog from '@newtab/components/BaseDialog.vue'
import { useDialog } from '@newtab/composables/useDialog'
import { bingWallpaperURLGetter, useWallpaperUrlStore } from '@newtab/shared/wallpaper'

import useBackgroundSwitcher from './useBackgroundSwitcher'

const { t } = useTranslation('settings')

const { opened, show, hide, toggle } = useDialog()
defineExpose({ show, hide, toggle })

const settings = useSettingsStore()
const wallpaperUrlStore = useWallpaperUrlStore()
const { lightUrl: localBgUrl, darkUrl: localDarkBgUrl } = storeToRefs(wallpaperUrlStore)

const isDark = useDark()
const customLocalContentRef = useTemplateRef('customLocalContentRef')

const { height: customLocalContentHeight } = useElementSize(customLocalContentRef)

function open(url: string) {
  if (url.length === 0) return
  window.open(url, '_blank')
}

const isLocalBg = computed(() => settings.background.bgType === BgType.Local)
const isOnlineBg = computed(() => settings.background.bgType === BgType.Online)
const isNoneBg = computed(() => settings.background.bgType === BgType.None)
const isVideoBg = computed(
  () =>
    isLocalBg.value &&
    (settings.background.local.mediaType === 'video' ||
      settings.background.localDark.mediaType === 'video')
)

const {
  isDarkBg,
  metaLight,
  metaDark,
  formatBytes,
  beforeBackgroundUpload,
  handleUpload,
  deleteLocalBg,
  tempOnlineUrl,
  changeOnlineBg,
  onlineImageWarn
} = useBackgroundSwitcher()

function handleNoneBg() {
  settings.background.bgType = BgType.None
  if (settings.theme.monetColor) {
    ElMessage.info(t('background.warning.monetColorDisabled'))
    settings.theme.monetColor = false
  }
}

const isShowDeleteIcon = computed(() =>
  Boolean(isDarkBg.value ? settings.background.localDark.id : settings.background.local.id)
)
const bingWallpaperSrc = bingWallpaperURLGetter.getBgUrl()
const bingWallpaperInfo = bingWallpaperURLGetter.getInfo()

function switchToBing() {
  bingWallpaperURLGetter.refresh(true)
  settings.background.bgType = BgType.Bing
}

function beforeLocalBgSwitch() {
  if (isDarkBg.value) return true
  return settings.background.local.id.length > 0
}
</script>

<template>
  <base-dialog v-model="opened" :title="t('background.preferenceTitle')" acrylic opacity>
    <!-- Bing 每日壁纸 -->
    <div class="bg-switcher-title" style="margin-top: 20px">{{ t('background.today') }}</div>
    <div class="bg-switcher-container">
      <div class="bg-switcher-preview" style="cursor: pointer" @click="switchToBing">
        <el-image :src="bingWallpaperSrc">
          <template #error>
            <div class="bg-switcher-preview__error">
              <el-icon><hide-image-twotone /></el-icon>
            </div>
          </template>
        </el-image>
      </div>
      <div class="bg-switcher-content-wrapper">
        <div class="bg-switcher-content">
          <div class="bg-switcher-content-title">{{ bingWallpaperInfo.title }}</div>
          <el-text line-clamp="2" class="bg-switcher-content-description">
            {{ bingWallpaperInfo.copyright }}
          </el-text>
          <el-space class="bg-switcher-content-actions">
            <el-button
              bg
              text
              :icon="DownloadRound"
              @click="open(bingWallpaperURLGetter.uhdUrl.value)"
            ></el-button>
            <el-button
              bg
              text
              :icon="LaunchRound"
              @click="open(bingWallpaperInfo.copyrightlink)"
            ></el-button>
            <div class="bg-switcher-bing">{{ t('background.bingFrom') }}</div>
          </el-space>
        </div>
      </div>
    </div>
    <!-- 自定义壁纸 -->
    <div class="bg-switcher-title">{{ t('background.custom') }}</div>
    <div class="bg-switcher-container bg-switcher-container--custom">
      <div class="bg-switcher--local-previews" v-if="isNoneBg">
        <el-icon class="bg-switcher-preview__placeholder"><brightness6-twotone /></el-icon>
      </div>
      <div
        v-else-if="isLocalBg"
        class="bg-switcher--local-previews"
        :style="{ height: `${customLocalContentHeight}px` }"
      >
        <el-upload
          v-show="!isDarkBg"
          class="bg-switcher-uploader"
          :show-file-list="false"
          :http-request="(option: UploadRequestOptions) => handleUpload(option)"
          :before-upload="beforeBackgroundUpload"
          accept="image/*,video/*"
        >
          <template v-if="settings.background.local.id">
            <div class="bg-switcher-preview">
              <video
                v-if="settings.background.local.mediaType === 'video'"
                :src="localBgUrl"
                muted
                playsinline
              ></video>
              <img v-else :src="localBgUrl" />
            </div>
          </template>
          <el-icon v-else class="bg-switcher-preview__placeholder"><plus /></el-icon>
        </el-upload>
        <el-upload
          v-if="isDarkBg && settings.background.local.id"
          class="bg-switcher-uploader"
          :show-file-list="false"
          :http-request="(option: UploadRequestOptions) => handleUpload(option)"
          :before-upload="beforeBackgroundUpload"
          accept="image/*,video/*"
        >
          <template v-if="settings.background.localDark.id">
            <div class="bg-switcher-preview">
              <video
                v-if="settings.background.localDark.mediaType === 'video'"
                :src="localDarkBgUrl"
                muted
                playsinline
              ></video>
              <img v-else :src="localDarkBgUrl" />
            </div>
          </template>
          <el-icon v-else class="bg-switcher-preview__placeholder"><plus /></el-icon>
        </el-upload>
        <div v-if="isShowDeleteIcon" class="bg-switcher-uploader-delete" @click="deleteLocalBg">
          <el-icon><close-round /></el-icon>
        </div>
        <div v-if="metaLight && !isDarkBg" class="bg-switcher-uploader-meta">
          <div>
            {{ metaLight.size ? formatBytes(metaLight.size) : '' }}
            {{ metaLight.width ? `${metaLight.width}×${metaLight.height}` : '' }}
            {{ metaLight.duration ? `${metaLight.duration.toFixed(1)}s` : '' }}
          </div>
        </div>
        <div v-if="metaDark && isDarkBg" class="bg-switcher-uploader-meta">
          <div>
            {{ metaDark.size ? formatBytes(metaDark.size) : '' }}
            {{ metaDark.width ? `${metaDark.width}×${metaDark.height}` : '' }}
            {{ metaDark.duration ? `${metaDark.duration.toFixed(1)}s` : '' }}
          </div>
        </div>
        <div class="bg-switcher-theme-switch">
          <el-switch
            v-model="isDarkBg"
            :active-icon="DarkModeTwotone"
            :inactive-icon="LightModeTwotone"
            :before-change="beforeLocalBgSwitch"
          />
        </div>
      </div>
      <div class="bg-switcher--local-previews" v-else-if="isOnlineBg">
        <el-icon class="bg-switcher-preview__placeholder"><cloud-queue-twotone /></el-icon>
      </div>
      <div
        class="bg-switcher--local-previews"
        v-else-if="settings.background.bgType === BgType.Bing"
      >
        <el-icon class="bg-switcher-preview__placeholder"><bing /></el-icon>
      </div>
      <div class="bg-switcher-content-wrapper">
        <div class="bg-switcher-content" ref="customLocalContentRef">
          <div class="bg-switcher-content-title">{{ t('background.chooseImageOrVideo') }}</div>
          <el-text v-if="isNoneBg" line-clamp="2" class="bg-switcher-content-description">
            {{ t('background.sunMoonSaying') }}
          </el-text>
          <el-text v-else-if="isLocalBg" line-clamp="2" class="bg-switcher-content-description">
            {{ t('background.myZoneMyRule') }}
          </el-text>
          <el-text v-else-if="isOnlineBg" line-clamp="2" class="bg-switcher-content-description">
            {{ t('background.alwaysFresh') }}
          </el-text>
          <el-text v-else line-clamp="2" class="bg-switcher-content-description">
            {{ t('background.youLikeFine') }}
          </el-text>
          <el-space wrap class="bg-switcher-content-actions">
            <el-button
              bg
              text
              :icon="TripOriginRound"
              :class="{ active: isNoneBg }"
              @click="handleNoneBg"
            >
              {{ isDark ? t('background.button.bathe.moon') : t('background.button.bathe.sun') }}
            </el-button>
            <el-button
              bg
              text
              :icon="FolderCopyRound"
              :class="{ active: isLocalBg }"
              @click="settings.background.bgType = BgType.Local"
            >
              {{ t('background.type.local') }}
            </el-button>
            <el-button
              bg
              text
              :icon="InsertLinkRound"
              :class="{ active: isOnlineBg }"
              @click="onlineImageWarn"
            >
              {{ t('background.type.online') }}
            </el-button>
          </el-space>
        </div>
      </div>
      <div class="bg-switcher-extra">
        <el-input
          v-if="isOnlineBg"
          v-model="tempOnlineUrl"
          @blur="changeOnlineBg"
          @keydown.enter="changeOnlineBg"
          placeholder="https://example.com/image.jpg"
        >
          <template #prepend>URL</template>
        </el-input>
        <ul class="bg-switcher-warning">
          <li v-if="isLocalBg">
            {{ t('background.tip') }}
          </li>
          <li v-if="isVideoBg">
            {{ t('background.videoWarning') }}
          </li>
          <template v-if="isOnlineBg">
            <li>{{ t('background.onlineTips.a') }}</li>
            <li>{{ t('background.onlineTips.b') }}</li>
            <li>{{ t('background.onlineTips.c') }}</li>
            <li>{{ t('background.onlineTips.d') }}</li>
          </template>
        </ul>
      </div>
    </div>
  </base-dialog>
</template>
