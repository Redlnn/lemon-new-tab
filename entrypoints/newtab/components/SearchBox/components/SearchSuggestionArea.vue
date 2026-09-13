<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { useTranslation } from 'i18next-vue'
import type { Component } from 'vue'
import Calculation from '~icons/carbon/calculation'
import Link from '~icons/carbon/link'
import Search from '~icons/carbon/search'
import TrashCan from '~icons/carbon/trash-can'
import Open32Regular from '~icons/fluent/open-32-regular'

import { BgType } from '@/shared/enums'
import { useQuickLinksStore } from '@/shared/quickLinks'
import { useSettingsStore } from '@/shared/settings'

import { useFocusState } from '@newtab/composables/useFocus'
import usePerfClasses from '@newtab/composables/usePerfClasses'
import { useSearchHistoryCache } from '@newtab/composables/useSearchHistoryCache'
import { getTopSites, rawTopSites } from '@newtab/components/QuickLinks/utils/topSites'
import { searchSuggestAPIs, searchSuggestCache } from '@newtab/shared/search'
import { calculateExpression, hasCalculationOperator } from '@newtab/shared/search/calculator'
import { parseNavigableUrl } from '@newtab/shared/search/url'

import SuggestListItem from './SuggestListItem.vue'

const { t } = useTranslation()

const focusStore = useFocusState()
const settings = useSettingsStore()
const quickLinksStore = useQuickLinksStore()
const {
  histories: cachedHistories,
  ensureLoaded: ensureHistoryLoaded,
  clearHistories: clearHistoryCache,
} = useSearchHistoryCache()

const isShowSearchHistories = ref(false)
const currentActiveSuggest = ref<null | number>(null)
const navigationSourceText = ref<string | null>(null)
const searchSuggestions = shallowRef<string[]>([])
// 用于追踪当前展示的结果是否仍然有效，避免旧请求覆盖新结果
const latestLiveQuery = ref('')
let historyRequestVersion = 0
let suggestionRequestVersion = 0
let suggestionTimer: ReturnType<typeof setTimeout> | null = null
let suggestionController: AbortController | null = null

const props = defineProps<{
  searchText: string
  searchFormWidth: number
  listId: string
}>()

const emit = defineEmits<{
  doSearchWithText: [text: string]
  navigateToUrl: [url: string]
  activeOptionChange: [id: string | undefined]
  expandedChange: [expanded: boolean]
}>()

type SuggestionAction =
  | 'calculate'
  | 'copy-expression'
  | 'navigate'
  | 'quick-link'
  | 'search'
  | 'suggest'
  | 'top-site'
type CopyAction = Extract<SuggestionAction, 'calculate' | 'copy-expression'>

type DisplayedSuggestion = {
  action: SuggestionAction
  text: string
  url?: string
  inputText?: string
  prefixKey?: string
  actionLabelKey?: string
  icon?: Component
}

const suggestionPresentation: Partial<
  Record<SuggestionAction, Omit<DisplayedSuggestion, 'action' | 'text'>>
> = {
  calculate: {
    prefixKey: 'newtab:search.calculationResult',
    actionLabelKey: 'newtab:search.clickToCopy',
    icon: Calculation,
  },
  'copy-expression': {
    prefixKey: 'newtab:search.calculator',
    actionLabelKey: 'newtab:search.clickToCopy',
    icon: Calculation,
  },
  navigate: {
    prefixKey: 'newtab:search.navigateTo',
    icon: Link,
  },
  'quick-link': {
    prefixKey: 'newtab:search.open',
    actionLabelKey: 'newtab:search.savedWebsite',
    icon: Open32Regular,
  },
  search: {
    prefixKey: 'newtab:search.searchFor',
    icon: Search,
  },
  'top-site': {
    prefixKey: 'newtab:search.open',
    actionLabelKey: 'newtab:search.mostVisited',
    icon: Open32Regular,
  },
}

function createSuggestion(
  action: SuggestionAction,
  text: string,
  options?: Pick<DisplayedSuggestion, 'inputText' | 'url'>,
): DisplayedSuggestion {
  return { action, text, ...options, ...suggestionPresentation[action] }
}

const actionSourceText = computed(() => navigationSourceText.value ?? props.searchText)
const navigableUrl = computed(() => parseNavigableUrl(actionSourceText.value))
const calculationResult = computed(() =>
  hasCalculationOperator(actionSourceText.value)
    ? calculateExpression(actionSourceText.value)
    : null,
)
const calculationText = computed(() => {
  const expression = actionSourceText.value.trim().replace(/\s+/g, '').replace(/=$/, '')
  return `${expression}=${calculationResult.value}`
})
const searchableLinks = computed(() => {
  const query = actionSourceText.value.trim().toLocaleLowerCase()
  if (!query) return []

  const links: DisplayedSuggestion[] = []
  const seenUrls = new Set<string>()
  const addLink = (action: 'quick-link' | 'top-site', title: string, url: string) => {
    if (seenUrls.has(url)) return
    if (!`${title} ${url}`.toLocaleLowerCase().includes(query)) return
    seenUrls.add(url)
    links.push(createSuggestion(action, title || url, { url }))
  }

  for (const link of quickLinksStore.items) addLink('quick-link', link.title, link.url)
  for (const site of rawTopSites.value) addLink('top-site', site.title || '', site.url)
  return links
})
const shouldSuppressSearchSuggestions = computed(
  () => calculationResult.value !== null && actionSourceText.value.trim().endsWith('='),
)
const displayedSuggestions = computed<DisplayedSuggestion[]>(() => {
  let actionSuggestions: DisplayedSuggestion[] = []
  if (navigableUrl.value) {
    actionSuggestions = [
      createSuggestion('navigate', navigableUrl.value.text),
      createSuggestion('search', navigableUrl.value.text),
    ]
  } else if (calculationResult.value !== null) {
    actionSuggestions = [
      createSuggestion('copy-expression', calculationText.value),
      createSuggestion('calculate', String(calculationResult.value), {
        inputText: actionSourceText.value,
      }),
    ]
  }

  const remainingCount = Math.max(0, 10 - actionSuggestions.length)
  const suggestions = [
    ...searchableLinks.value,
    ...searchSuggestions.value.map((text) => createSuggestion('suggest', text)),
  ].slice(0, remainingCount)
  return [...actionSuggestions, ...suggestions]
})

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
  if (length === 0) {
    return '0'
  }
  if (length > 10) {
    return isShowSearchHistories.value ? '363px' : '330px'
  }
  return isShowSearchHistories.value ? `${(length + 1) * 33}px` : `${length * 33}px`
})

const activeOptionId = computed(() => {
  const index = currentActiveSuggest.value
  if (index === null || index >= displayedSuggestions.value.length) {
    return undefined
  }
  return `${props.listId}-option-${index}`
})
const isExpanded = computed(() => displayedSuggestions.value.length > 0)

function isLiveSuggestionResult(text: string) {
  return (
    settings.search.suggestionsEnabled &&
    text === latestLiveQuery.value &&
    text === props.searchText.trim() &&
    !isShowSearchHistories.value
  )
}

function applyHistorySuggestions(list: readonly string[]) {
  searchSuggestions.value = list.slice()
  if (list.length > 0) {
    isShowSearchHistories.value = true
  }
}

function cancelSuggestionRequest() {
  suggestionRequestVersion += 1
  if (suggestionTimer) clearTimeout(suggestionTimer)
  suggestionTimer = null
  suggestionController?.abort()
  suggestionController = null
}

function handleInput(text?: string) {
  const query = (text ?? props.searchText).trim()
  if (focusStore.isFocused && !query) {
    // 如果搜索词为空，则显示搜索历史
    cancelSuggestionRequest()
    latestLiveQuery.value = ''
    clearSearchSuggestions()
    void showSearchHistories()
  } else if (query) {
    hideSearchHistories()
    if (shouldSuppressSearchSuggestions.value) clearSearchSuggestions()
    else showSuggestionsDebounced(query)
  }
}

watch(
  () => focusStore.isFocused,
  (isFocused) => {
    if (isFocused) {
      if (props.searchText.trim()) {
        if (shouldSuppressSearchSuggestions.value) clearSearchSuggestions()
        else showSuggestionsDebounced(props.searchText.trim())
      } else {
        void showSearchHistories()
      }
    } else {
      cancelSuggestionRequest()
    }
  },
)

const canShowHistory = () => focusStore.isFocused && !props.searchText.trim()

async function showSearchHistories() {
  const requestVersion = ++historyRequestVersion
  if (!canShowHistory()) {
    return
  }

  if (searchSuggestions.value.length > 0 && !isShowSearchHistories.value) {
    return
  }

  await ensureHistoryLoaded()
  if (requestVersion !== historyRequestVersion || !canShowHistory()) {
    return
  }

  const searchHistories = cachedHistories.value
  if (searchHistories.length > 0) {
    applyHistorySuggestions(searchHistories)
  }
}

type SuggestParser = (text: string, signal?: AbortSignal) => Promise<string[]>

function waitForRetry(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, 100)
    signal.addEventListener('abort', finish, { once: true })
    if (signal.aborted) finish()
  })
}

async function fetchSuggestions(
  text: string,
  parser: SuggestParser,
  version: number,
  signal: AbortSignal,
  cacheKey: string,
) {
  try {
    let list: string[] = []
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      if (signal.aborted || version !== suggestionRequestVersion) return
      try {
        list = await parser(text, signal)
        break
      } catch (error) {
        if (signal.aborted || version !== suggestionRequestVersion) return
        if (attempt === 2) throw error
        await waitForRetry(signal)
      }
    }

    if (version !== suggestionRequestVersion || !isLiveSuggestionResult(text)) return
    searchSuggestions.value = list
    if (list.length > 0) searchSuggestCache.set(cacheKey, list)
  } catch (error) {
    if (signal.aborted || version !== suggestionRequestVersion) return
    console.error('Failed to fetch search suggestions:', error)
    if (isLiveSuggestionResult(text)) searchSuggestions.value = []
  }
}

function showSuggestionsDebounced(queryText?: string) {
  historyRequestVersion += 1
  const query = (queryText ?? props.searchText).trim()
  latestLiveQuery.value = query
  cancelSuggestionRequest()
  if (!settings.search.suggestionsEnabled) {
    searchSuggestions.value = []
    clearActiveSuggest()
    return
  }
  if (!query) {
    return
  }

  // 先检查缓存，命中则直接返回
  const cacheKey = `${settings.search.suggestionAPI}:${query}`
  const cached = searchSuggestCache.get(cacheKey)
  if (cached) {
    searchSuggestions.value = cached
    return
  }

  const api = searchSuggestAPIs[settings.search.suggestionAPI] ?? searchSuggestAPIs.bing

  const version = ++suggestionRequestVersion
  const controller = new AbortController()
  suggestionController = controller
  suggestionTimer = setTimeout(() => {
    suggestionTimer = null
    void fetchSuggestions(query, api.parser, version, controller.signal, cacheKey)
  }, 250)
}

watch([() => settings.search.suggestionAPI, () => settings.search.suggestionsEnabled], () => {
  cancelSuggestionRequest()
  if (!props.searchText.trim()) return
  clearSearchSuggestions()
  if (focusStore.isFocused && !shouldSuppressSearchSuggestions.value) showSuggestionsDebounced()
})

onMounted(() => {
  void quickLinksStore.init()
  if (settings.quickLinks.topSites || settings.dock.topSites) {
    void getTopSites().catch((error) => {
      console.warn('[search] Failed to load top sites:', error)
    })
  }
})

onUnmounted(() => {
  cancelSuggestionRequest()
})

function clearActiveSuggest(resetNavigationSource = true) {
  currentActiveSuggest.value = null
  if (resetNavigationSource) navigationSourceText.value = null
}

function activateSuggest(index: number): string | null {
  const nextItem = displayedSuggestions.value[index]
  if (!nextItem) {
    return null
  }

  currentActiveSuggest.value = index
  return nextItem.inputText ?? nextItem.text
}

function submitActiveSuggest() {
  const index = currentActiveSuggest.value
  if (index === null) return false
  const item = displayedSuggestions.value[index]
  if (!item) return false
  return activateSuggestion(item)
}

function isCopyAction(action: SuggestionAction): action is CopyAction {
  return action === 'calculate' || action === 'copy-expression'
}

function activateSuggestion(item: DisplayedSuggestion) {
  if (item.url) {
    emit('navigateToUrl', item.url)
  } else if (isCopyAction(item.action)) {
    void copyCalculation(item.action)
  } else if (item.action === 'navigate' && navigableUrl.value) {
    emit('navigateToUrl', navigableUrl.value.url)
  } else {
    emit('doSearchWithText', item.text)
  }
  return true
}

async function copyCalculation(action: 'calculate' | 'copy-expression') {
  try {
    await navigator.clipboard.writeText(
      action === 'calculate' ? String(calculationResult.value) : calculationText.value,
    )
    ElMessage.success(t('newtab:yiyan.copied'))
  } catch {
    // 剪贴板不可用时不打断搜索框操作。
  }
}

function hideSearchHistories() {
  historyRequestVersion += 1
  isShowSearchHistories.value = false
}

function clearSearchSuggestions() {
  cancelSuggestionRequest()
  latestLiveQuery.value = ''
  hideSearchHistories()
  currentActiveSuggest.value = null
  navigationSourceText.value = null
  searchSuggestions.value = []
}

async function clearSearchHistories() {
  await clearHistoryCache()
  clearSearchSuggestions()
}

function navigateActiveSuggest(direction: number, currentText: string, originText: string | null) {
  const suggestionsLength = displayedSuggestions.value.length
  if (suggestionsLength <= 0) {
    return null
  }

  const previousIndex = currentActiveSuggest.value
  const nextOriginText = originText === null ? currentText : originText

  if (previousIndex === null) navigationSourceText.value = nextOriginText
  clearActiveSuggest(false)

  if (previousIndex === null) {
    const nextIndex = direction > 0 ? direction - 1 : suggestionsLength + direction
    const nextText = activateSuggest(nextIndex)
    return nextText ? { searchText: nextText, originSearchText: nextOriginText } : null
  }

  const newIndex = previousIndex + direction
  if (newIndex < 0 || newIndex >= suggestionsLength) {
    navigationSourceText.value = null
    return {
      searchText: nextOriginText || '',
      originSearchText: null,
    }
  }

  const nextText = activateSuggest(newIndex)
  return nextText ? { searchText: nextText, originSearchText: nextOriginText } : null
}

watch(
  () => cachedHistories.value,
  (list) => {
    if (isShowSearchHistories.value && canShowHistory()) {
      applyHistorySuggestions(list)
    }
  },
)

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

html:not(.colorful) .search-suggestion-area {
  &--dark {
    background-color: var(--el-fill-color-blank);
    border: solid 1px var(--el-border-color-light);
  }
}
</style>
