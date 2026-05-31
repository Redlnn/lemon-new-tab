<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import RestoreRound from '~icons/ic/round-restore'

import { useSettingsStore } from '@/shared/settings'

import { blockedTopSitesStorage } from '@newtab/shared/storages/topSitesStorage'

import { useShortcutGroupingChange } from '../composables/useShortcutGroupingChange'

const { t } = useTranslation('settings')

const settings = useSettingsStore()
const { handleGroupingChange } = useShortcutGroupingChange()

async function restoreDefaultTopSites() {
  await blockedTopSitesStorage.setValue([])
  location.reload()
}
</script>

<template>
  <div class="settings__items-container">
    <p class="settings__item--note" style="margin-top: 1em">
      {{ t('shortcut.iconCacheTip') }}
    </p>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('newtab:common.enable') }}</div>
      <el-switch v-model="settings.dock.enabled" />
    </div>
    <p class="settings__item--note">{{ t('dock.actionBtnNote') }}</p>
    <template v-if="settings.dock.enabled">
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('shortcut.showOnSearchFocus') }}</div>
        <el-switch v-model="settings.dock.showOnSearchFocus" />
      </div>
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('dock.launchpad.show') }}</div>
        <el-switch v-model="settings.dock.launchpad.enabled" />
      </div>
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('shortcut.grouping') }}</div>
        <el-switch :model-value="settings.shortcut.grouping" @change="handleGroupingChange" />
      </div>
      <p v-if="settings.shortcut.grouping" class="settings__item--note">
        {{ t('shortcut.groupingTip') }}
      </p>
      <div
        class="settings__item settings__group"
        :class="{ active: settings.dock.launchpad.enabled }"
      >
        <el-collapse-transition>
          <section v-if="settings.dock.launchpad.enabled">
            <p class="settings__item--note" style="margin-top: 5px">
              {{ t('dock.launchpad.title') }}
            </p>
            <div class="settings__item settings__item--horizontal">
              <div class="settings__label">{{ t('shortcut.topSites') }}</div>
              <el-switch v-model="settings.dock.launchpad.topSites" />
            </div>
            <div class="settings__item settings__item--horizontal">
              <div class="settings__label">{{ t('common.openInNewTab') }}</div>
              <el-switch v-model="settings.dock.launchpad.openInNewTab" />
            </div>
          </section>
        </el-collapse-transition>
      </div>
      <div
        class="settings__item settings__group"
        :class="{ active: settings.dock.launchpad.enabled }"
      >
        <el-collapse-transition>
          <p
            v-if="settings.dock.launchpad.enabled"
            class="settings__item--note"
            style="margin-top: 5px"
          >
            {{ t('dock.title') }}
          </p>
        </el-collapse-transition>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('shortcut.topSites') }}</div>
          <el-switch v-model="settings.dock.topSites" />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('common.openInNewTab') }}</div>
          <el-switch v-model="settings.dock.openInNewTab" />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('dock.limitCount') }}</div>
          <el-switch v-model="settings.dock.limitCount" />
        </div>
        <div v-if="settings.dock.limitCount" class="settings__item settings__item--vertical">
          <div class="settings__label">{{ t('dock.maxCount') }}</div>
          <el-slider
            v-model="settings.dock.maxCount"
            :min="1"
            :max="20"
            show-input
            :show-input-controls="false"
            :show-tooltip="false"
          />
        </div>
        <div class="settings__item settings__item--vertical">
          <div class="settings__label">{{ t('shortcut.iconSize') }}</div>
          <el-slider
            v-model="settings.dock.iconSize"
            :min="30"
            :max="64"
            show-input
            :show-input-controls="false"
            :show-tooltip="false"
          />
        </div>
        <div class="settings__item settings__item--vertical">
          <div class="settings__label">{{ t('shortcut.iconRatio') }}</div>
          <el-slider
            v-model="settings.dock.iconRatio"
            :min="0.1"
            :max="1"
            :step="0.05"
            show-input
            :show-input-controls="false"
            :show-tooltip="false"
          />
        </div>
        <div class="settings__item settings__item--vertical">
          <div class="settings__label">
            {{ t('shortcut.spacing.itemGapX') }}
          </div>
          <el-slider
            v-model="settings.dock.gap"
            :min="3"
            :max="10"
            show-input
            :show-input-controls="false"
            :show-tooltip="false"
          />
        </div>
      </div>
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('shortcut.restoreDefault') }}</div>
        <el-popconfirm
          width="220"
          :confirm-button-text="t('newtab:common.confirm')"
          :cancel-button-text="t('newtab:common.no')"
          :icon="RestoreRound"
          icon-color="#626AEF"
          :title="t('shortcut.restoreDefaultTitle')"
          @confirm="restoreDefaultTopSites()"
        >
          <template #reference>
            <el-button :icon="RestoreRound" circle />
          </template>
        </el-popconfirm>
      </div>
    </template>
  </div>
</template>
