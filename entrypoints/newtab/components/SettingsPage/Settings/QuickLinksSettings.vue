<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import RestoreRound from '~icons/ic/round-restore'

import { useSettingsStore } from '@/shared/settings'

import { blockedTopSitesStorage } from '@newtab/shared/storages/topSitesStorage'
import { isHasTouchDevice } from '@newtab/shared/touch'

import { useQuickLinksGroupingChange } from '../composables/useQuickLinksGroupingChange'

const { t } = useTranslation('settings')

const isChromium = import.meta.env.CHROME || import.meta.env.EDGE || import.meta.env.OPERA
const settings = useSettingsStore()
const { handleGroupingChange } = useQuickLinksGroupingChange()

async function restoreDefaultTopSites() {
  await blockedTopSitesStorage.setValue([])
  location.reload()
}

function handleUseScrollChange(enabled: boolean | string | number) {
  if (enabled) {
    settings.quickLinks.paging = false
  }
  settings.quickLinks.useScroll = Boolean(enabled)
}

function handlePagingChange(enabled: boolean | string | number) {
  if (enabled) {
    settings.quickLinks.useScroll = false
  }
  settings.quickLinks.paging = Boolean(enabled)
}
</script>

<template>
  <div class="settings__items-container">
    <p class="settings__item--note" style="margin-top: 1em; margin-bottom: 0.2em">
      {{ t('quickLinks.tip') }}
    </p>
    <p class="settings__item--note">
      {{ t('quickLinks.iconCacheTip') }}
    </p>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('newtab:common.enable') }}</div>
      <el-switch v-model="settings.quickLinks.enabled" />
    </div>
    <template v-if="settings.quickLinks.enabled">
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('quickLinks.showOnSearchFocus') }}</div>
        <el-switch v-model="settings.quickLinks.showOnSearchFocus" />
      </div>
      <div v-show="settings.quickLinks.enabled" style="margin-top: 8px">
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('quickLinks.topSites') }}</div>
          <el-switch v-model="settings.quickLinks.topSites" />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('quickLinks.grouping') }}</div>
          <el-switch :model-value="settings.quickLinks.grouping" @change="handleGroupingChange" />
        </div>
        <p v-if="settings.quickLinks.grouping" class="settings__item--note">
          {{ t('quickLinks.groupingTip') }}
        </p>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('quickLinks.shadow') }}</div>
          <el-switch v-model="settings.quickLinks.style.shadow" />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('quickLinks.border') }}</div>
          <el-switch v-model="settings.quickLinks.style.border" />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('quickLinks.pinnedIcon') }}</div>
          <el-switch
            :disabled="!settings.quickLinks.topSites"
            v-model="settings.quickLinks.pinnedIcon"
          />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('quickLinks.useScroll') }}</div>
          <el-switch
            :model-value="settings.quickLinks.useScroll"
            @change="handleUseScrollChange"
          />
        </div>
        <p v-if="isHasTouchDevice" class="settings__item--note">
          {{ t('quickLinks.useScrollTouchTip') }}
        </p>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('quickLinks.paging') }}</div>
          <el-switch :model-value="settings.quickLinks.paging" @change="handlePagingChange" />
        </div>
        <div v-if="settings.quickLinks.paging" class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('quickLinks.pagingLoop') }}</div>
          <el-switch v-model="settings.quickLinks.pagingLoop" />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('quickLinks.showTitle') }}</div>
          <el-switch v-model="settings.quickLinks.title.show" />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('common.openInNewTab') }}</div>
          <el-switch v-model="settings.quickLinks.openInNewTab" />
        </div>
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
        <p
          v-if="isChromium"
          style="
            margin-top: 0;
            font-size: var(--el-font-size-extra-small);
            line-height: 1.5em;
            color: var(--el-text-color-regular);
          "
        >
          {{ t('quickLinks.maxItemsTipForChrome') }}
        </p>
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
          <div class="settings__label">
            {{ t('quickLinks.spacing.itemGapX') }}
          </div>
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
          <div class="settings__label">
            {{ t('quickLinks.spacing.itemGapY') }}
          </div>
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
          <div class="settings__label">
            {{ t('quickLinks.marginTop') }}
          </div>
          <el-slider
            v-model="settings.quickLinks.marginTop"
            :min="10"
            :max="150"
            show-input
            :show-input-controls="false"
            :show-tooltip="false"
          />
        </div>
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
      </div>
    </template>
  </div>
</template>
