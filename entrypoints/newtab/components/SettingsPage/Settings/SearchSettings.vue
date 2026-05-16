<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import BubbleChartRound from '~icons/ic/round-bubble-chart'
import CloudOffRound from '~icons/ic/round-cloud-off'

import { useSettingsStore } from '@/shared/settings'

import { OPEN_SEARCH_ENGINE_PREFERENCE } from '@newtab/shared/keys'
import { searchSuggestAPIs } from '@newtab/shared/search'

const { t } = useTranslation('settings')

const settings = useSettingsStore()

const openSearchEnginePreference = inject(OPEN_SEARCH_ENGINE_PREFERENCE)
</script>

<template>
  <div class="settings__items-container">
    <p class="settings__item--note" style="margin-top: 1em">
      {{ t('search.tip') }}
    </p>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('newtab:common.enable') }}</div>
      <el-switch v-model="settings.search.enabled" />
    </div>
    <template v-if="settings.search.enabled">
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">
          {{ t('search.defaultSearchEngine') }}
          <cloud-off-round />
        </div>
        <el-button
          :icon="BubbleChartRound"
          @click="openSearchEnginePreference && openSearchEnginePreference()"
        >
          {{ t('search.clickToChange') }}
        </el-button>
      </div>
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">
          {{ t('search.searchSuggestionProvider') }}
        </div>
        <el-select
          v-model="settings.search.suggestionAPI"
          style="width: 150px"
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
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('search.alwaysExpandSearchBar') }}</div>
        <el-switch
          v-model="settings.search.expandAlways"
          @change="!settings.search.expandAlways && (settings.search.showIconAlways = false)"
        />
      </div>
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('search.alwaysShowIcon') }}</div>
        <el-switch
          :disabled="!settings.search.expandAlways"
          v-model="settings.search.showIconAlways"
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
        <div class="settings__label">{{ t('search.recordSearchHistory') }}</div>
        <el-switch v-model="settings.search.recordHistory" />
      </div>
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('search.placeholder') }}</div>
        <el-input
          v-model="settings.search.placeholder"
          :placeholder="t('newtab:search.placeholder')"
          style="width: 240px"
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
          :min="200"
          :max="900"
          :step="10"
          show-input
          :show-input-controls="false"
          :show-tooltip="false"
        />
      </div>
    </template>
  </div>
</template>
