<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import BubbleChartRound from '~icons/ic/round-bubble-chart'
import RestoreRound from '~icons/ic/round-restore'

import { useSettingsStore } from '@/shared/settings'

import { OPEN_SEARCH_ENGINE_PREFERENCE } from '@newtab/shared/keys'
import { BUILT_IN_SEARCH_ENGINE_KEYS, searchSuggestAPIs } from '@newtab/shared/search'

import SyncAvailabilityIcon from '../components/SyncAvailabilityIcon.vue'

import SettingsSection from './SettingsSection.vue'

const { t } = useTranslation('settings')

const settings = useSettingsStore()

const openSearchEnginePreference = inject(OPEN_SEARCH_ENGINE_PREFERENCE)
const canRestoreBuiltInEngines = computed(
  () =>
    settings.search.hiddenBuiltInEngines.length > 0 ||
    BUILT_IN_SEARCH_ENGINE_KEYS.some(
      (key, index) => settings.search.builtInEngineOrder[index] !== key,
    ),
)

function restoreBuiltInSearchEngines() {
  settings.search.builtInEngineOrder = [...BUILT_IN_SEARCH_ENGINE_KEYS]
  settings.search.hiddenBuiltInEngines = []
}
</script>

<template>
  <div class="settings__items-container settings-page-grid">
    <SettingsSection
      :title="t('common.sections.general')"
      :summary="t('common.sections.summary.general')"
      mobile-open
    >
      <el-alert :title="t('search.tip')" type="info" show-icon :closable="false" />
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('newtab:common.enable') }}</div>
        <el-switch v-model="settings.search.enabled" />
      </div>
      <div v-if="settings.search.enabled" class="settings__item settings__item--horizontal">
        <div class="settings__label">
          {{ t('search.defaultSearchEngine') }}
        </div>
        <el-button
          :icon="BubbleChartRound"
          @click="openSearchEnginePreference && openSearchEnginePreference()"
        >
          {{ t('search.clickToChange') }}
        </el-button>
      </div>
    </SettingsSection>

    <template v-if="settings.search.enabled">
      <SettingsSection
        :title="t('common.sections.behavior')"
        :summary="t('common.sections.summary.behavior')"
        content-class="settings-control-grid"
      >
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">
            {{ t('search.recordSearchHistory') }}
            <SyncAvailabilityIcon catalog-key="searchHistory" />
          </div>
          <el-switch v-model="settings.search.recordHistory" />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('search.searchSuggestions') }}</div>
          <el-switch v-model="settings.search.suggestionsEnabled" />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('search.searchSuggestionProvider') }}</div>
          <el-select
            v-model="settings.search.suggestionAPI"
            :disabled="!settings.search.suggestionsEnabled"
            style="width: 100px"
            fit-input-width
            :show-arrow="false"
          >
            <el-option
              v-for="name in Object.keys(searchSuggestAPIs)"
              :key="name"
              :label="t(searchSuggestAPIs[name as keyof typeof searchSuggestAPIs].nameKey)"
              :value="name"
            />
          </el-select>
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('common.openInNewTab') }}</div>
          <el-switch v-model="settings.search.openInNewTab" />
        </div>
      </SettingsSection>

      <SettingsSection
        :title="t('common.sections.appearance')"
        :summary="t('common.sections.summary.appearance')"
        content-class="settings-control-grid"
      >
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('search.alwaysExpandSearchBar') }}</div>
          <el-switch
            v-model="settings.search.expandAlways"
            @change="!settings.search.expandAlways && (settings.search.showIconAlways = false)"
          />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('search.launchAnim') }}</div>
          <el-switch v-model="settings.perf.searchBar.launchAnim" />
        </div>
        <div class="settings__item settings__item--vertical">
          <div class="settings__label">{{ t('search.expandWidth') }}</div>
          <el-slider
            v-model="settings.search.expandWidth"
            :min="300"
            :max="900"
            :step="10"
            show-input
            :show-input-controls="false"
            :show-tooltip="false"
          />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('search.alwaysShowIcon') }}</div>
          <el-switch
            v-model="settings.search.showIconAlways"
            :disabled="!settings.search.expandAlways"
          />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('search.shadow') }}</div>
          <el-switch v-model="settings.search.style.shadow" />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('search.border') }}</div>
          <el-switch v-model="settings.search.style.border" />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('search.leftAlignInput') }}</div>
          <el-switch v-model="settings.search.leftAlignInput" />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('search.placeholder') }}</div>
          <el-input
            v-model="settings.search.placeholder"
            class="settings-control-field"
            :placeholder="t('newtab:search.placeholder')"
            style="width: 120px"
          />
        </div>
      </SettingsSection>

      <SettingsSection
        :title="t('common.sections.data')"
        :summary="t('common.sections.summary.data')"
      >
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('search.restoreHiddenEngines') }}</div>
          <el-popconfirm
            width="220"
            :confirm-button-text="t('newtab:common.confirm')"
            :cancel-button-text="t('newtab:common.no')"
            :icon="RestoreRound"
            icon-color="#626AEF"
            :title="t('search.restoreHiddenEnginesTitle')"
            @confirm="restoreBuiltInSearchEngines"
          >
            <template #reference>
              <el-button :disabled="!canRestoreBuiltInEngines" :icon="RestoreRound" circle />
            </template>
          </el-popconfirm>
        </div>
      </SettingsSection>
    </template>
  </div>
</template>
