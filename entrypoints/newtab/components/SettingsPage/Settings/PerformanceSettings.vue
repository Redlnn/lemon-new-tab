<script setup lang="ts">
import { useTranslation } from 'i18next-vue'

import { useSettingsStore } from '@/shared/settings'

const { t } = useTranslation('settings')

const settings = useSettingsStore()

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
  settings.background.parallax = enable
}
</script>

<template>
  <div class="settings__items-container">
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label" style="color: var(--el-color-danger-dark-2)">
        {{ t('perf.toggleAll.disable') }}
      </div>
      <span class="button-group">
        <el-button @click="toggleAnimationSettings(false)">
          {{ t('perf.toggleAll.animation') }}
        </el-button>
        <el-button @click="toggleTransparentSettings(false)">
          {{ t('perf.toggleAll.transparent') }}
        </el-button>
        <el-button @click="toggleBlurSettings(false)">
          {{ t('perf.toggleAll.blur') }}
        </el-button>
      </span>
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label" style="color: var(--el-color-success-dark-2)">
        {{ t('perf.toggleAll.enable') }}
      </div>
      <span class="button-group">
        <el-button @click="toggleAnimationSettings(true)">
          {{ t('perf.toggleAll.animation') }}
        </el-button>
        <el-button @click="toggleTransparentSettings(true)">
          {{ t('perf.toggleAll.transparent') }}
        </el-button>
        <el-button @click="toggleBlurSettings(true)">
          {{ t('perf.toggleAll.blur') }}
        </el-button>
      </span>
    </div>
    <el-divider></el-divider>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('background.pauseWhenBlur') }}</div>
      <el-switch v-model="settings.background.pauseOnBlur" />
    </div>
    <p class="settings__item--note">
      {{ t('background.video.blurTip') }}
    </p>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('clock.blink') }}</div>
      <el-switch v-model="settings.clock.style.blink" />
    </div>
    <p class="settings__item--note">
      {{ t('clock.blinkingTip') }}
    </p>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('perf.bgSwitchAnim') }}</div>
      <el-switch v-model="settings.perf.bgSwitchAnim" />
    </div>
    <p class="settings__item--note">
      {{ t('perf.bgSwitchAnimTip') }}
    </p>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('perf.bookmark.transparent') }}</div>
      <el-switch v-model="settings.perf.bookmark.transparent" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('perf.bookmark.blur') }}</div>
      <el-switch
        :disabled="!settings.perf.bookmark.transparent"
        v-model="settings.perf.bookmark.blur"
      />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('perf.dialog.transparent') }}</div>
      <el-switch v-model="settings.perf.dialog.transparent" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('perf.dialog.blur') }}</div>
      <el-switch
        :disabled="!settings.perf.dialog.transparent"
        v-model="settings.perf.dialog.blur"
      />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('perf.dialog.animation') }}</div>
      <el-switch v-model="settings.perf.dialog.animation" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('search.launchAnim') }}</div>
      <el-switch v-model="settings.perf.searchBar.launchAnim" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('perf.focus.scale') }}</div>
      <el-switch v-model="settings.perf.focus.scale" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('perf.focus.blur') }}</div>
      <el-switch v-model="settings.perf.focus.blur" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('perf.searchBar.transparent') }}</div>
      <el-switch v-model="settings.perf.searchBar.transparent" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('perf.searchBar.blur') }}</div>
      <el-switch
        :disabled="!settings.perf.searchBar.transparent"
        v-model="settings.perf.searchBar.blur"
      />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('perf.quickLinks.transparent') }}</div>
      <el-switch v-model="settings.perf.quickLinks.transparent" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('perf.quickLinks.blur') }}</div>
      <el-switch
        :disabled="!settings.perf.quickLinks.transparent"
        v-model="settings.perf.quickLinks.blur"
      />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('perf.yiyan.transparent') }}</div>
      <el-switch v-model="settings.perf.yiyan.transparent" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('perf.yiyan.blur') }}</div>
      <el-switch :disabled="!settings.perf.yiyan.transparent" v-model="settings.perf.yiyan.blur" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('perf.yiyan.ripple') }}</div>
      <el-switch v-model="settings.perf.yiyan.ripple" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('perf.actionBtns.transparent') }}</div>
      <el-switch v-model="settings.perf.actionBtns.transparent" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('perf.actionBtns.blur') }}</div>
      <el-switch
        :disabled="!settings.perf.actionBtns.transparent"
        v-model="settings.perf.actionBtns.blur"
      />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('perf.dock.scale') }}</div>
      <el-switch v-model="settings.perf.dockScale" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('background.parallax') }}</div>
      <el-switch v-model="settings.background.parallax" />
    </div>
  </div>
</template>
