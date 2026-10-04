<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import BubbleChartRound from '~icons/ic/round-bubble-chart'
import RestoreRound from '~icons/ic/round-restore'

import {
  SEARCH_SUGGESTION_PROVIDER_IDS,
  normalizeSuggestionProviders,
  suggestionProviderNameKey,
  type SearchSuggestionProviderId,
} from '@/shared/searchSuggestionProviders'
import { useSettingsStore } from '@/shared/settings'

import { useAppDialogs } from '@newtab/composables/appDialogs'
import { useBrowserHistoryPermission } from '@newtab/composables/useBrowserHistoryPermission'
import { BUILT_IN_SEARCH_ENGINE_KEYS, searchSuggestAPIs } from '@newtab/shared/search'

import SyncAvailabilityIcon from '../components/SyncAvailabilityIcon.vue'

import SettingsSection from './SettingsSection.vue'

const { t } = useTranslation('settings')

const settings = useSettingsStore()
const { granted: historyGranted, request: requestHistory } = useBrowserHistoryPermission()
const historyPermissionPending = ref(false)
// 独立的勾选草稿使授权被拒绝时，Checkbox 的内部状态也能明确回退。
const providerSelection = reactive(
  Object.fromEntries(
    SEARCH_SUGGESTION_PROVIDER_IDS.map((id) => [
      id,
      settings.search.suggestionProviders.includes(id),
    ]),
  ),
) as Record<SearchSuggestionProviderId, boolean>
watch(
  () => settings.search.suggestionProviders,
  (selected) => {
    for (const id of SEARCH_SUGGESTION_PROVIDER_IDS) {
      if (id === 'browser-history' && historyPermissionPending.value) continue
      providerSelection[id] = selected.includes(id)
    }
  },
  { deep: true },
)

async function authorizeHistory() {
  historyPermissionPending.value = true
  try {
    const granted = await requestHistory()
    if (!granted) ElMessage.warning(t('search.historyPermissionDenied'))
    return granted
  } catch {
    ElMessage.warning(t('search.historyPermissionDenied'))
    return false
  } finally {
    historyPermissionPending.value = false
  }
}

async function changeProvider(id: SearchSuggestionProviderId, checked: boolean) {
  if (id === 'browser-history' && checked && !(await authorizeHistory())) {
    providerSelection[id] = settings.search.suggestionProviders.includes(id)
    return
  }
  settings.search.suggestionProviders = normalizeSuggestionProviders(
    checked
      ? [...settings.search.suggestionProviders, id]
      : settings.search.suggestionProviders.filter((item) => item !== id),
  )
}

const dialogs = useAppDialogs()
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
        <el-button :icon="BubbleChartRound" @click="dialogs.open('searchEngines')">
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
          <div class="settings__label">{{ t('common.openInNewTab') }}</div>
          <el-switch v-model="settings.search.openInNewTab" />
        </div>
        <div class="settings__item settings__item--horizontal settings-control-wide">
          <div class="settings__label">{{ t('search.searchSuggestions') }}</div>
          <el-switch v-model="settings.search.suggestionsEnabled" />
        </div>
        <div class="settings__item settings__item--vertical search-settings__provider-settings">
          <div
            class="search-settings__providers"
            role="group"
            :aria-label="t('search.suggestionProviders')"
          >
            <el-checkbox
              v-for="id in SEARCH_SUGGESTION_PROVIDER_IDS"
              :key="id"
              v-model="providerSelection[id]"
              :disabled="
                !settings.search.suggestionsEnabled ||
                (id === 'browser-history' && historyPermissionPending)
              "
              @change="changeProvider(id, $event === true)"
              >{{ t(suggestionProviderNameKey(id)) }}</el-checkbox
            >
          </div>
          <div class="search-settings__hint">{{ t('search.historyPermissionDescription') }}</div>
          <div
            v-if="
              settings.search.suggestionProviders.includes('browser-history') && !historyGranted
            "
            class="search-settings__permission"
          >
            <span>{{ t('search.historyPermissionPending') }}</span>
            <el-button
              :loading="historyPermissionPending"
              :disabled="!settings.search.suggestionsEnabled"
              @click="authorizeHistory"
              >{{ t('search.authorizeHistory') }}</el-button
            >
          </div>
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('search.browserHistoryLimit') }}</div>
          <el-input-number
            v-model="settings.search.browserHistoryLimit"
            :aria-label="t('search.browserHistoryLimit')"
            :min="1"
            :max="5"
            controls-position="right"
            style="width: 80px"
            :disabled="
              !settings.search.suggestionsEnabled ||
              !settings.search.suggestionProviders.includes('browser-history')
            "
          />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('search.searchSuggestionProvider') }}</div>
          <el-select
            v-model="settings.search.suggestionAPI"
            :disabled="
              !settings.search.suggestionsEnabled ||
              !settings.search.suggestionProviders.includes('remote')
            "
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

<style>
.search-settings__provider-settings {
  grid-column: 1 / -1;
}

.search-settings__hint {
  font-size: var(--el-font-size-small);
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}

.search-settings__providers {
  display: flex;
  flex-wrap: wrap;
  gap: 0 16px;
}

.search-settings__providers .el-checkbox {
  margin-right: 0;
}

.search-settings__permission {
  display: flex;
  gap: 12px;
  align-items: center;
}
</style>
