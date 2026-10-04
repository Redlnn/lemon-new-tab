<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'

import { useTranslation } from 'i18next-vue'
import RestoreRound from '~icons/ic/round-restore'

import { useSettingsStore } from '@/shared/settings'

import { blockedTopSitesStorage } from '@newtab/shared/storages/topSitesStorage'

import SyncAvailabilityIcon from '../components/SyncAvailabilityIcon.vue'
import { useQuickLinksGroupingChange } from '../composables/useQuickLinksGroupingChange'

import SettingsSection from './SettingsSection.vue'

const { t } = useTranslation('settings')
const isNarrowScreen = useMediaQuery('(width < 599px)')

const isChromium = import.meta.env.CHROME || import.meta.env.EDGE || import.meta.env.OPERA
const isChrome = import.meta.env.CHROME
const settings = useSettingsStore()
const { handleGroupingChange } = useQuickLinksGroupingChange()

async function restoreDefaultTopSites() {
  await blockedTopSitesStorage.setValue([])
  location.reload()
}

function handleUseScrollChange(enabled: boolean | string | number) {
  settings.quickLinks.useScroll = Boolean(enabled)
  settings.quickLinks.paging = !enabled
}

const alertType = computed(() => (settings.theme.colorfulMode ? 'primary' : 'info'))
</script>

<template>
  <div class="settings__items-container settings-page-grid">
    <SettingsSection
      :title="t('common.sections.general')"
      :summary="t('common.sections.summary.general')"
      content-class="settings-control-grid"
      mobile-open
    >
      <div class="settings__item settings__item--horizontal settings-control-wide">
        <div class="settings__label">{{ t('newtab:common.enable') }}</div>
        <el-switch
          v-model="settings.quickLinks.enabled"
          :disabled="settings.dock.replaceQuickLinks"
        />
      </div>
      <div
        class="settings__item settings__item--horizontal settings__item--with-note settings-control-wide"
      >
        <div class="settings__label">{{ t('dock.replaceQuickLinks') }}</div>
        <el-switch
          :model-value="settings.dock.replaceQuickLinks"
          @change="settings.setDockReplaceQuickLinks(Boolean($event))"
        />
        <p v-if="settings.dock.replaceQuickLinks" class="settings__item-note">
          <template v-if="!settings.search.expandAlways">
            {{ t('dock.replaceQuickLinksTip', { option: t('search.alwaysExpandSearchBar') }) }}
          </template>
          {{ t('dock.replaceQuickLinksLayoutTip') }}
        </p>
      </div>
      <template v-if="settings.quickLinks.enabled">
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('quickLinks.showOnSearchFocus') }}</div>
          <el-switch v-model="settings.quickLinks.showOnSearchFocus" />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('quickLinks.topSites') }}</div>
          <el-switch v-model="settings.quickLinks.topSites" />
        </div>
        <div class="settings__item settings__item--horizontal settings__item--with-note">
          <div class="settings__label">{{ t('quickLinks.grouping') }}</div>
          <el-switch :model-value="settings.quickLinks.grouping" @change="handleGroupingChange" />
          <p v-if="settings.quickLinks.grouping" class="settings__item-note">
            {{ t('quickLinks.groupingTip') }}
          </p>
        </div>
      </template>
      <el-alert v-if="settings.quickLinks.enabled" :type="alertType" show-icon :closable="false">
        <p style="margin: 0.5em 0">1. {{ t('quickLinks.tip') }}</p>
        <p style="margin: 0.5em 0">
          2. {{ t('quickLinks.iconCacheTip') }}
          <SyncAvailabilityIcon catalog-key="userIcons" />
        </p>
      </el-alert>
    </SettingsSection>

    <SettingsSection
      v-if="settings.quickLinks.enabled"
      :title="t('common.sections.behavior')"
      :summary="t('common.sections.summary.behavior')"
      content-class="settings-control-grid"
    >
      <div
        class="settings__item settings__item--horizontal settings__item--with-note settings-control-wide"
      >
        <div class="settings__label">{{ t('quickLinks.navigationMode') }}</div>
        <el-switch
          :model-value="settings.quickLinks.useScroll"
          :active-text="t('quickLinks.scrollMode')"
          :inactive-text="t('quickLinks.pagingMode')"
          @change="handleUseScrollChange"
        />
        <p class="settings__item-note">
          {{ t(isNarrowScreen ? 'quickLinks.scrollModeTip' : 'quickLinks.pagingModeTip') }}
        </p>
      </div>
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('quickLinks.pinnedIcon') }}</div>
        <el-switch
          v-model="settings.quickLinks.pinnedIcon"
          :disabled="!settings.quickLinks.topSites"
        />
      </div>
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('common.openInNewTab') }}</div>
        <el-switch v-model="settings.quickLinks.openInNewTab" />
      </div>
      <div v-if="!settings.quickLinks.useScroll" class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('quickLinks.pagingLoop') }}</div>
        <el-switch v-model="settings.quickLinks.pagingLoop" />
      </div>
    </SettingsSection>

    <SettingsSection
      v-if="settings.quickLinks.enabled"
      :title="t('common.sections.appearance')"
      :summary="t('common.sections.summary.appearance')"
      content-class="settings-control-grid"
    >
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('quickLinks.shadow') }}</div>
        <el-switch v-model="settings.quickLinks.style.shadow" />
      </div>
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('quickLinks.border') }}</div>
        <el-switch v-model="settings.quickLinks.style.border" />
      </div>
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('quickLinks.showTitle') }}</div>
        <el-switch v-model="settings.quickLinks.title.show" />
      </div>
      <div class="settings__item settings__item--horizontal settings__item--with-note">
        <div class="settings__label">{{ t('quickLinks.fallbackToTitleInitial') }}</div>
        <el-switch v-model="settings.quickLinks.fallbackToTitleInitial" />
        <p v-if="isChrome" class="settings__item-note">
          {{ t('quickLinks.fallbackToTitleInitialChromeTip') }}
        </p>
      </div>
    </SettingsSection>

    <SettingsSection
      v-if="settings.quickLinks.enabled"
      :title="t('common.sections.layout')"
      :summary="t('common.sections.summary.layout')"
      content-class="settings-control-grid"
    >
      <div class="settings__item settings__item--vertical">
        <div class="settings__label">{{ t('quickLinks.maxRows') }}</div>
        <el-slider
          v-model="settings.quickLinks.layout.rows"
          :step="1"
          :min="1"
          :max="5"
          show-stops
          :show-tooltip="false"
          style="margin-bottom: 20px"
          :marks="{ 1: '1', 2: '2', 3: '3', 4: '4', 5: '5' }"
          :disabled="settings.quickLinks.useScroll"
        />
      </div>
      <div class="settings__item settings__item--vertical">
        <div class="settings__label">{{ t('quickLinks.maxColumns') }}</div>
        <el-slider
          v-model="settings.quickLinks.layout.columns"
          :step="1"
          :min="1"
          :max="10"
          show-stops
          :show-tooltip="false"
          style="margin-bottom: 20px"
          :marks="{ 1: '1', 10: '10' }"
        />
      </div>
      <el-alert
        v-if="isChromium"
        :title="t('quickLinks.maxItemsTipForChrome')"
        :type="alertType"
        show-icon
        :closable="false"
      />
      <div class="settings__item settings__item--vertical">
        <div class="settings__label">{{ t('quickLinks.iconSize') }}</div>
        <el-slider
          v-model="settings.quickLinks.iconSize"
          :min="30"
          :max="200"
          show-input
          :show-input-controls="false"
          :show-tooltip="false"
        />
      </div>
      <div class="settings__item settings__item--vertical">
        <div class="settings__label">{{ t('quickLinks.iconRatio') }}</div>
        <el-slider
          v-model="settings.quickLinks.iconRatio"
          :min="0.1"
          :max="1"
          :step="0.1"
          show-input
          :show-input-controls="false"
          :show-tooltip="false"
        />
      </div>
      <div class="settings__item settings__item--vertical">
        <div class="settings__label">{{ t('quickLinks.spacing.iconTitleGap') }}</div>
        <el-slider
          v-model="settings.quickLinks.spacing.iconTitleGap"
          :min="0"
          :max="50"
          :step="1"
          show-input
          :show-input-controls="false"
          :show-tooltip="false"
        />
      </div>
      <div class="settings__item settings__item--vertical">
        <div class="settings__label">{{ t('quickLinks.titleExtraWidth') }}</div>
        <el-slider
          v-model="settings.quickLinks.title.extraWidth"
          :min="0"
          :max="100"
          :step="0.5"
          show-input
          :show-input-controls="false"
          :show-tooltip="false"
        />
      </div>
      <div class="settings__item settings__item--vertical">
        <div class="settings__label">{{ t('quickLinks.spacing.itemGapX') }}</div>
        <el-slider
          v-model="settings.quickLinks.spacing.itemGapX"
          :min="0"
          :max="50"
          show-input
          :show-input-controls="false"
          :show-tooltip="false"
        />
      </div>
      <div class="settings__item settings__item--vertical">
        <div class="settings__label">{{ t('quickLinks.spacing.itemGapY') }}</div>
        <el-slider
          v-model="settings.quickLinks.spacing.itemGapY"
          :min="0"
          :max="30"
          show-input
          :show-input-controls="false"
          :show-tooltip="false"
        />
      </div>
      <div class="settings__item settings__item--vertical">
        <div class="settings__label">{{ t('quickLinks.marginTop') }}</div>
        <el-slider
          v-model="settings.quickLinks.marginTop"
          :min="10"
          :max="150"
          show-input
          :show-input-controls="false"
          :show-tooltip="false"
        />
      </div>
    </SettingsSection>

    <SettingsSection
      v-if="settings.quickLinks.enabled"
      :title="t('common.sections.data')"
      :summary="t('common.sections.summary.data')"
    >
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">
          {{ t('quickLinks.restoreDefault') }}
          <SyncAvailabilityIcon catalog-key="blockedTopSites" />
        </div>
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
