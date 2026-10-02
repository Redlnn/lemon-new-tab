<script setup lang="ts">
import type { Component } from 'vue'

import { ElMessage } from 'element-plus'
import { useTranslation } from 'i18next-vue'
import Calculation from '~icons/carbon/calculation'
import History from '~icons/carbon/history'
import Link from '~icons/carbon/link'
import RecentlyViewed from '~icons/carbon/recently-viewed'
import Search from '~icons/carbon/search'
import TrashCan from '~icons/carbon/trash-can'
import Open32Regular from '~icons/fluent/open-32-regular'

import { browser } from 'wxt/browser'

import { BgType } from '@/shared/enums'
import { useQuickLinksStore } from '@/shared/quickLinks'
import type { SearchSuggestionProviderId } from '@/shared/searchSuggestionProviders'
import { useSettingsStore } from '@/shared/settings'

import { getTopSites } from '@newtab/components/QuickLinks/utils/topSites'
import { useBrowserHistoryPermission } from '@newtab/composables/useBrowserHistoryPermission'
import { useFocusState } from '@newtab/composables/useFocus'
import usePerfClasses from '@newtab/composables/usePerfClasses'
import { useSearchHistoryCache } from '@newtab/composables/useSearchHistoryCache'
import { searchSuggestAPIs, searchSuggestCache } from '@newtab/shared/search'
import { calculateExpression, hasCalculationOperator } from '@newtab/shared/search/calculator'
import {
  browserHistorySuggestions,
  collectSuggestions,
  type SearchSuggestion,
} from '@newtab/shared/search/providers'
import { parseNavigableUrl } from '@newtab/shared/search/url'

import SuggestListItem from './SuggestListItem.vue'

const { t } = useTranslation()
const focusStore = useFocusState()
const settings = useSettingsStore()
const quickLinksStore = useQuickLinksStore()
const { granted: historyGranted } = useBrowserHistoryPermission()
const {
  histories: cachedHistories,
  ensureLoaded: ensureHistoryLoaded,
  clearHistories: clearHistoryCache,
} = useSearchHistoryCache()

const props = defineProps<{ searchText: string; searchFormWidth: number; listId: string }>()
const emit = defineEmits<{
  doSearchWithText: [text: string]
  navigateToUrl: [url: string]
  activeOptionChange: [id: string | undefined]
  expandedChange: [expanded: boolean]
}>()

const isShowSearchHistories = ref(false)
const currentActiveSuggest = ref<number | null>(null)
const navigationSourceText = ref<string | null>(null)
const searchSuggestions = shallowRef<SearchSuggestion[]>([])
let requestVersion = 0
let controller: AbortController | null = null

type Presentation = { prefixKey?: string; actionLabelKey?: string; icon?: Component }
const presentation: Partial<Record<SearchSuggestionProviderId, Presentation>> = {
  calculator: {
    prefixKey: 'newtab:search.calculator',
    actionLabelKey: 'newtab:search.clickToCopy',
    icon: Calculation,
  },
  url: { prefixKey: 'newtab:search.navigateTo', icon: Link },
  'quick-links': {
    actionLabelKey: 'newtab:search.savedWebsite',
    icon: Open32Regular,
  },
  'top-sites': {
    actionLabelKey: 'newtab:search.mostVisited',
    icon: Open32Regular,
  },
  'browser-history': {
    actionLabelKey: 'newtab:search.browserHistory',
    icon: History,
  },
  'search-history': {
    actionLabelKey: 'newtab:search.extensionSearchHistory',
    icon: RecentlyViewed,
  },
}
const displayedSuggestions = computed(() =>
  searchSuggestions.value.map((item) => ({
    ...item,
    ...presentation[item.provider],
    ...(item.provider === 'calculator' && item.inputText
      ? { prefixKey: 'newtab:search.calculationResult' }
      : {}),
    ...(item.provider === 'url' && item.action === 'search'
      ? { prefixKey: 'newtab:search.searchFor', icon: Search }
      : {}),
  })),
)
const perf = usePerfClasses(() => ({
  transparent: settings.perf.searchBar.transparent,
  transparency: settings.perf.searchBar.transparency,
  blur: settings.perf.searchBar.blur,
}))
const suggestionAreaPerfClass = computed(() => [
  {
    'search-suggestion-area--shadow': settings.search.style.shadow,
    'search-suggestion-area--dark':
      settings.background.bgType === BgType.None && displayedSuggestions.value.length > 0,
  },
  perf('search-suggestion-area').value,
])
const areaHeight = computed(() => {
  const length = displayedSuggestions.value.length
  return length ? `${(length + Number(isShowSearchHistories.value)) * 33}px` : '0'
})
const activeOptionId = computed(() => {
  const index = currentActiveSuggest.value
  return index !== null && displayedSuggestions.value[index]
    ? `${props.listId}-option-${index}`
    : undefined
})
const isExpanded = computed(() => displayedSuggestions.value.length > 0)

function cancelSuggestionRequest() {
  requestVersion++
  controller?.abort()
  controller = null
}
function clearActiveSuggest(resetNavigationSource = true) {
  currentActiveSuggest.value = null
  if (resetNavigationSource) navigationSourceText.value = null
}
function clearSearchSuggestions() {
  cancelSuggestionRequest()
  clearActiveSuggest()
  isShowSearchHistories.value = false
  searchSuggestions.value = []
}
function hideSearchHistories() {
  isShowSearchHistories.value = false
}

/** 中止时也结束等待，让已失效的提供器链及时退出。 */
function waitForDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
    if (signal.aborted) finish()
  })
}
async function remoteSuggestions(query: string, signal: AbortSignal): Promise<SearchSuggestion[]> {
  const apiId = settings.search.suggestionAPI
  const cacheKey = `${apiId}:${query}`
  let list = searchSuggestCache.get(cacheKey)
  if (!list) {
    const api = searchSuggestAPIs[apiId] ?? searchSuggestAPIs.bing
    for (let attempt = 0; attempt <= 2; attempt++) {
      if (signal.aborted) return []
      try {
        list = await api.parser(query, signal)
        break
      } catch (error) {
        if (signal.aborted) return []
        if (attempt === 2) throw error
        await waitForDelay(100, signal)
      }
    }
    if (!signal.aborted && list?.length) searchSuggestCache.set(cacheKey, list)
  }
  return (list ?? []).map((text) => ({ provider: 'remote', action: 'search', text }))
}
function websiteSuggestions(
  provider: 'quick-links' | 'top-sites',
  items: readonly { title?: string; url: string }[],
  query: string,
): SearchSuggestion[] {
  return items
    .filter((item) =>
      `${item.title ?? ''} ${item.url}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    )
    .map((item) => ({ provider, action: 'navigate', text: item.title || item.url, url: item.url }))
}
async function refreshSuggestions(text = props.searchText) {
  const sourceText = navigationSourceText.value
  clearSearchSuggestions()
  // 设置或权限变化只刷新原始查询；真实输入会先通过 clearActiveSuggest 重置它。
  navigationSourceText.value = sourceText
  if (!focusStore.isFocused || !settings.search.suggestionsEnabled) return
  const query = text.trim()
  const enabled = settings.search.suggestionProviders
  const current = requestVersion
  const activeController = new AbortController()
  controller = activeController
  const { signal } = activeController
  // 本地提供器立即执行；浏览器历史和远端请求共用本次输入的防抖期限。
  const startedAt = Date.now()
  const debounce = async () => {
    await waitForDelay(Math.max(0, 250 - (Date.now() - startedAt)), signal)
  }
  const result =
    enabled.includes('calculator') && hasCalculationOperator(query)
      ? calculateExpression(query)
      : null
  const expression = query.replace(/\s+/g, '').replace(/=$/, '')
  const calculationText = `${expression}=${result}`
  const calculatorOnly = enabled.includes('calculator') && result !== null && query.endsWith('=')
  isShowSearchHistories.value = !query && enabled.includes('search-history')
  await collectSuggestions({
    enabled: !query
      ? enabled.filter((id) => id === 'search-history')
      : calculatorOnly
        ? ['calculator']
        : enabled,
    signal,
    browserHistoryLimit: settings.search.browserHistoryLimit,
    providers: {
      calculator: () =>
        result === null
          ? []
          : [
              {
                provider: 'calculator',
                action: 'copy',
                text: calculationText,
                copyText: calculationText,
              },
              {
                provider: 'calculator',
                action: 'copy',
                text: String(result),
                copyText: String(result),
                inputText: query,
              },
            ],
      url: () => {
        const parsed = parseNavigableUrl(query)
        return parsed
          ? [
              { provider: 'url', action: 'navigate', text: parsed.text, url: parsed.url },
              { provider: 'url', action: 'search', text: parsed.text },
            ]
          : []
      },
      'quick-links': async () => {
        await quickLinksStore.init()
        if (signal.aborted) return []
        return websiteSuggestions('quick-links', quickLinksStore.items, query)
      },
      'top-sites': async () => {
        const sites = await getTopSites()
        if (signal.aborted) return []
        return websiteSuggestions('top-sites', sites, query)
      },
      'browser-history': async () => {
        if (!historyGranted.value) return []
        await debounce()
        if (signal.aborted || !historyGranted.value) return []
        return browserHistorySuggestions(
          await browser.history.search({ text: query, startTime: 0, maxResults: 20 }),
        )
      },
      'search-history': async () => {
        await ensureHistoryLoaded()
        if (signal.aborted) return []
        return cachedHistories.value
          .filter((item) => item.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
          .map((item) => ({ provider: 'search-history', action: 'search', text: item }))
      },
      remote: async () => {
        await debounce()
        return signal.aborted ? [] : remoteSuggestions(query, signal)
      },
    },
    onUpdate: (items) => {
      if (current === requestVersion && !signal.aborted) searchSuggestions.value = items
    },
    onError: (provider, error) => console.warn(`[search] ${provider} suggestions failed:`, error),
  })
}
function handleInput(text = props.searchText) {
  void refreshSuggestions(text)
}
async function showSearchHistories() {
  if (props.searchText.trim()) return
  await refreshSuggestions()
}
watch(
  () => focusStore.isFocused,
  (focused) => {
    if (focused) handleInput()
    else clearSearchSuggestions()
  },
)
watch(
  [
    () => settings.search.suggestionsEnabled,
    () => settings.search.suggestionAPI,
    () => settings.search.suggestionProviders,
    () => settings.search.browserHistoryLimit,
    historyGranted,
  ],
  () => {
    // 使用键盘导航的原始查询刷新，不能把历史标题或 URL 送入远端接口。
    void refreshSuggestions(navigationSourceText.value ?? props.searchText)
  },
  { deep: true },
)
watch(cachedHistories, () => {
  if (isShowSearchHistories.value && navigationSourceText.value === null) void showSearchHistories()
})
onUnmounted(cancelSuggestionRequest)

function activateSuggestion(item: SearchSuggestion) {
  if (item.action === 'navigate' && item.url) emit('navigateToUrl', item.url)
  else if (item.action === 'copy') {
    void navigator.clipboard
      .writeText(item.copyText ?? item.text)
      .then(() => ElMessage.success(t('newtab:yiyan.copied')))
      .catch(() => {})
  } else emit('doSearchWithText', item.text)
  return true
}
function submitActiveSuggest() {
  const index = currentActiveSuggest.value
  const item = index === null ? undefined : searchSuggestions.value[index]
  return item ? activateSuggestion(item) : false
}
function activateSuggest(index: number) {
  const item = searchSuggestions.value[index]
  if (!item) return null
  currentActiveSuggest.value = index
  return item.inputText ?? item.text
}
function navigateActiveSuggest(direction: number, currentText: string, originText: string | null) {
  const length = searchSuggestions.value.length
  if (!length) return null
  const previous = currentActiveSuggest.value
  const origin = originText ?? currentText
  cancelSuggestionRequest()
  navigationSourceText.value = origin
  clearActiveSuggest(false)
  const next = previous === null ? (direction > 0 ? 0 : length - 1) : previous + direction
  if (next < 0 || next >= length) {
    navigationSourceText.value = null
    return { searchText: origin, originSearchText: null }
  }
  const text = activateSuggest(next)
  return text === null ? null : { searchText: text, originSearchText: origin }
}
async function clearSearchHistories() {
  await clearHistoryCache()
  clearSearchSuggestions()
}
watch(activeOptionId, (id) => emit('activeOptionChange', id), { immediate: true })
watch(isExpanded, (expanded) => emit('expandedChange', expanded), { immediate: true })
defineExpose({
  clearActiveSuggest,
  clearSearchSuggestions,
  hideSearchHistories,
  showSearchHistories,
  handleInput,
  navigateActiveSuggest,
  submitActiveSuggest,
})
</script>

<template>
  <div
    ref="searchSuggestionArea"
    :id="listId"
    class="search-suggestion-area"
    role="listbox"
    :aria-label="t('newtab:a11y.searchSuggestions')"
    :class="suggestionAreaPerfClass"
    :style="{
      width: `${searchFormWidth}px`,
      height: areaHeight,
    }"
  >
    <suggest-list-item
      v-for="(item, index) in displayedSuggestions"
      :key="index"
      :id="`${listId}-option-${index}`"
      :text="item.text"
      :description="item.provider === 'browser-history' ? item.url : undefined"
      :prefix="item.prefixKey ? t(item.prefixKey) : undefined"
      :icon="item.icon"
      :active="currentActiveSuggest === index"
      :action-label="item.actionLabelKey ? t(item.actionLabelKey) : undefined"
      @click="activateSuggestion(item)"
      @hover="currentActiveSuggest = index"
      @leave="currentActiveSuggest = currentActiveSuggest === index ? null : currentActiveSuggest"
    />
    <div
      v-show="isShowSearchHistories"
      class="search-suggestion-area__item search-suggestion-area__clear-history noselect"
      role="button"
      :aria-label="t('newtab:search.purgeSearchHistory')"
      style="display: none"
      @click="clearSearchHistories()"
    >
      <el-icon style="margin-right: 5px"><trash-can /></el-icon>
      <span>{{ t('newtab:search.purgeSearchHistory') }}</span>
    </div>
  </div>
</template>

<style lang="scss">
@use '@newtab/styles/mixins/acrylic.scss' as acrylic;

.search-suggestion-area {
  --cubic-bezier: cubic-bezier(0.65, 0.05, 0.1, 1);
  --search-suggestion-background: var(--el-fill-color-darker);

  position: absolute;
  top: 60px;
  z-index: 1;
  overflow: hidden;
  font-size: var(--el-font-size-small);
  background-color: var(--search-suggestion-background);
  border-radius: var(--search-border-radius, 20px);
  transition:
    height 0.1s var(--cubic-bezier),
    background-color var(--el-transition-duration-fast) ease,
    border var(--el-transition-duration-fast) ease,
    border-radius var(--el-transition-duration-fast) ease,
    box-shadow var(--el-transition-duration-fast) ease;

  &--shadow {
    box-shadow: var(--el-box-shadow);
  }

  &.search-suggestion-area--opacity {
    background-color: var(--le-bg-color-overlay-search);
  }

  &.search-suggestion-area--blur {
    @include acrylic.acrylic(var(--le-search-suggestion-backdrop-blur, 30px));
  }

  &__item {
    display: flex;
    align-items: center;
    height: 33px;
    padding: 0 30px;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 33px;
    color: var(--el-text-color-primary);
    white-space: nowrap;
    cursor: pointer;
    background-color: transparent;
    transition:
      padding var(--el-transition-duration-fast) var(--cubic-bezier),
      padding-left var(--el-transition-duration-fast) var(--cubic-bezier),
      color var(--el-transition-duration-fast) ease;

    &--active {
      padding-left: 40px;
      background-color: var(--le-bg-color-overlay-search-subtle);
    }

    &--action {
      .search-suggestion-area__item-icon,
      .search-suggestion-area__item-prefix {
        color: var(--el-text-color-regular);
      }
    }

    &-icon {
      flex: none;
      margin-right: 8px;
    }

    &-prefix {
      flex: none;
    }

    &-text {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &-description {
      min-width: 0;
      max-width: 40%;
      margin-left: 8px;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--el-text-color-secondary);
    }

    &-action {
      flex: none;
      margin-left: 12px;
      color: var(--el-text-color-regular);
    }
  }

  &__clear-history {
    display: flex;
    align-items: center;
    font-size: var(--el-font-size-extra-small);
    color: var(--el-text-color-regular);
    background-color: transparent;
    transition:
      padding var(--el-transition-duration-fast) var(--cubic-bezier),
      padding-left var(--el-transition-duration-fast) var(--cubic-bezier),
      color var(--el-transition-duration-fast) ease;

    &:hover {
      padding-left: 30px;
      background-color: var(--le-bg-color-overlay-search-subtle);
    }
  }
}

html.colorful .search-suggestion-area {
  --search-suggestion-background: var(--el-color-primary-light-9);
}

@media (width <= 600px) {
  .search-suggestion-area__item-action,
  .search-suggestion-area__item-description {
    display: none;
  }
}

html:not(.colorful) .search-suggestion-area {
  &--dark {
    background-color: var(--el-fill-color-blank);
    border: solid 1px var(--el-border-color-light);
  }
}
</style>
