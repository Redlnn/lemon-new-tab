<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import RestoreRound from '~icons/ic/round-restore'

import { useSettingsStore } from '@/shared/settings'

import { blockedTopSitesStorage } from '@newtab/shared/storages/topSitesStorage'

import { useQuickLinksGroupingChange } from '../composables/useQuickLinksGroupingChange'

import SettingsSection from './SettingsSection.vue'

const { t } = useTranslation('settings')

const settings = useSettingsStore()
const { handleGroupingChange } = useQuickLinksGroupingChange()

async function restoreDefaultTopSites() {
  await blockedTopSitesStorage.setValue([])
  location.reload()
}
</script>

<template>
  <div class="settings__items-container settings-page-grid">
    <SettingsSection
      :title="t('common.sections.general')"
      :summary="t('common.sections.summary.general')"
      content-class="settings-control-grid"
      mobile-open
    >
      <el-alert :title="t('quickLinks.iconCacheTip')" type="info" show-icon :closable="false" />
      <div
        class="settings__item settings__item--horizontal settings__item--with-note settings-control-wide"
      >
        <div class="settings__label">{{ t('newtab:common.enable') }}</div>
        <el-switch v-model="settings.dock.enabled" />
        <p class="settings__item-note">{{ t('dock.actionBtnNote') }}</p>
      </div>
      <template v-if="settings.dock.enabled">
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('quickLinks.showOnSearchFocus') }}</div>
          <el-switch v-model="settings.dock.showOnSearchFocus" />
        </div>
        <div class="settings__item settings__item--horizontal settings__item--with-note">
          <div class="settings__label">{{ t('quickLinks.grouping') }}</div>
          <el-switch :model-value="settings.quickLinks.grouping" @change="handleGroupingChange" />
          <p v-if="settings.quickLinks.grouping" class="settings__item-note">
            {{ t('quickLinks.groupingTip') }}
          </p>
        </div>
      </template>
    </SettingsSection>

    <SettingsSection
      v-if="settings.dock.enabled"
      :title="t('dock.launchpad.title')"
      :summary="t('common.sections.summary.display')"
      content-class="settings-control-grid"
    >
      <div class="settings__item settings__item--horizontal settings-control-wide">
        <div class="settings__label">{{ t('dock.launchpad.show') }}</div>
        <el-switch v-model="settings.dock.launchpad.enabled" />
      </div>
      <template v-if="settings.dock.launchpad.enabled">
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('quickLinks.topSites') }}</div>
          <el-switch v-model="settings.dock.launchpad.topSites" />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('common.openInNewTab') }}</div>
          <el-switch v-model="settings.dock.launchpad.openInNewTab" />
        </div>
        <div class="settings__item settings__item--horizontal settings__item--with-note">
          <div class="settings__label">{{ t('dock.launchpad.rightClickToOpen') }}</div>
          <el-switch
            v-model="settings.dock.launchpad.rightClickToOpen"
            :disabled="settings.bookmark.rightClickToOpen"
          />
          <p v-if="settings.bookmark.rightClickToOpen" class="settings__item-note">
            {{ t('dock.launchpad.rightClickDisabledNote') }}
          </p>
        </div>
      </template>
    </SettingsSection>

    <SettingsSection
      v-if="settings.dock.enabled"
      :title="t('common.sections.layout')"
      :summary="t('common.sections.summary.layout')"
      content-class="settings-control-grid"
    >
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('quickLinks.topSites') }}</div>
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
        <div class="settings__label">{{ t('quickLinks.iconSize') }}</div>
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
        <div class="settings__label">{{ t('quickLinks.iconRatio') }}</div>
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
        <div class="settings__label">{{ t('quickLinks.spacing.itemGapX') }}</div>
        <el-slider
          v-model="settings.dock.gap"
          :min="3"
          :max="10"
          show-input
          :show-input-controls="false"
          :show-tooltip="false"
        />
      </div>
    </SettingsSection>

    <SettingsSection
      v-if="settings.dock.enabled"
      :title="t('common.sections.data')"
      :summary="t('common.sections.summary.data')"
    >
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('quickLinks.restoreDefault') }}</div>
        <el-popconfirm
          width="220"
          :confirm-button-text="t('newtab:common.confirm')"
          :cancel-button-text="t('newtab:common.no')"
          :icon="RestoreRound"
          icon-color="#626AEF"
          :title="t('quickLinks.restoreDefaultTitle')"
          @confirm="restoreDefaultTopSites()"
        >
          <template #reference>
            <el-button :icon="RestoreRound" circle />
          </template>
        </el-popconfirm>
      </div>
    </SettingsSection>
  </div>
</template>
