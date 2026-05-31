<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import RestoreRound from '~icons/ic/round-restore'

import { useSettingsStore } from '@/shared/settings'

import { blockedTopSitesStorage } from '@newtab/shared/storages/topSitesStorage'

import { useShortcutGroupingChange } from '../composables/useShortcutGroupingChange'

const { t } = useTranslation('settings')

const isChromium = import.meta.env.CHROME || import.meta.env.EDGE || import.meta.env.OPERA
const settings = useSettingsStore()
const { handleGroupingChange } = useShortcutGroupingChange()

async function restoreDefaultTopSites() {
  await blockedTopSitesStorage.setValue([])
  location.reload()
}
</script>

<template>
  <div class="settings__items-container">
    <p class="settings__item--note" style="margin-top: 1em; margin-bottom: 0.2em">
      {{ t('shortcut.tip') }}
    </p>
    <p class="settings__item--note">
      {{ t('shortcut.iconCacheTip') }}
    </p>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('newtab:common.enable') }}</div>
      <el-switch v-model="settings.shortcut.enabled" />
    </div>
    <template v-if="settings.shortcut.enabled">
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('shortcut.showOnSearchFocus') }}</div>
        <el-switch v-model="settings.shortcut.showOnSearchFocus" />
      </div>
      <div v-show="settings.shortcut.enabled" style="margin-top: 8px">
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('shortcut.topSites') }}</div>
          <el-switch v-model="settings.shortcut.topSites" />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('shortcut.grouping') }}</div>
          <el-switch :model-value="settings.shortcut.grouping" @change="handleGroupingChange" />
        </div>
        <p v-if="settings.shortcut.grouping" class="settings__item--note">
          {{ t('shortcut.groupingTip') }}
        </p>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('shortcut.shadow') }}</div>
          <el-switch v-model="settings.shortcut.style.shadow" />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('shortcut.border') }}</div>
          <el-switch v-model="settings.shortcut.style.border" />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('shortcut.pinnedIcon') }}</div>
          <el-switch
            :disabled="!settings.shortcut.topSites"
            v-model="settings.shortcut.pinnedIcon"
          />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('shortcut.paging') }}</div>
          <el-switch v-model="settings.shortcut.paging" />
        </div>
        <div v-if="settings.shortcut.paging" class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('shortcut.pagingLoop') }}</div>
          <el-switch v-model="settings.shortcut.pagingLoop" />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('shortcut.showTitle') }}</div>
          <el-switch v-model="settings.shortcut.title.show" />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('common.openInNewTab') }}</div>
          <el-switch v-model="settings.shortcut.openInNewTab" />
        </div>
        <div class="settings__item settings__item--vertical">
          <div class="settings__label">{{ t('shortcut.maxRows') }}</div>
          <el-slider
            v-model="settings.shortcut.layout.rows"
            :step="1"
            :min="1"
            :max="5"
            show-stops
            :show-tooltip="false"
            style="margin-bottom: 20px"
            :marks="{ 1: '1', 2: '2', 3: '3', 4: '4', 5: '5' }"
          />
        </div>
        <div class="settings__item settings__item--vertical">
          <div class="settings__label">{{ t('shortcut.maxColumns') }}</div>
          <el-slider
            v-model="settings.shortcut.layout.columns"
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
          {{ t('shortcut.maxItemsTipForChrome') }}
        </p>
        <div class="settings__item settings__item--vertical">
          <div class="settings__label">{{ t('shortcut.iconSize') }}</div>
          <el-slider
            v-model="settings.shortcut.iconSize"
            :min="30"
            :max="200"
            show-input
            :show-input-controls="false"
            :show-tooltip="false"
          />
        </div>
        <div class="settings__item settings__item--vertical">
          <div class="settings__label">{{ t('shortcut.iconRatio') }}</div>
          <el-slider
            v-model="settings.shortcut.iconRatio"
            :min="0.1"
            :max="1"
            :step="0.1"
            show-input
            :show-input-controls="false"
            :show-tooltip="false"
          />
        </div>
        <div class="settings__item settings__item--vertical">
          <div class="settings__label">{{ t('shortcut.spacing.iconTitleGap') }}</div>
          <el-slider
            v-model="settings.shortcut.spacing.iconTitleGap"
            :min="0"
            :max="50"
            :step="1"
            show-input
            :show-input-controls="false"
            :show-tooltip="false"
          />
        </div>
        <div class="settings__item settings__item--vertical">
          <div class="settings__label">{{ t('shortcut.titleExtraWidth') }}</div>
          <el-slider
            v-model="settings.shortcut.title.extraWidth"
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
            {{ t('shortcut.spacing.itemGapX') }}
          </div>
          <el-slider
            v-model="settings.shortcut.spacing.itemGapX"
            :min="0"
            :max="50"
            show-input
            :show-input-controls="false"
            :show-tooltip="false"
          />
        </div>
        <div class="settings__item settings__item--vertical">
          <div class="settings__label">
            {{ t('shortcut.spacing.itemGapY') }}
          </div>
          <el-slider
            v-model="settings.shortcut.spacing.itemGapY"
            :min="0"
            :max="30"
            show-input
            :show-input-controls="false"
            :show-tooltip="false"
          />
        </div>
        <div class="settings__item settings__item--vertical">
          <div class="settings__label">
            {{ t('shortcut.marginTop') }}
          </div>
          <el-slider
            v-model="settings.shortcut.marginTop"
            :min="10"
            :max="150"
            show-input
            :show-input-controls="false"
            :show-tooltip="false"
          />
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
      </div>
    </template>
  </div>
</template>
