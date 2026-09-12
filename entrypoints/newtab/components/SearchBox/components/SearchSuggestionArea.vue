<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import Globe from '~icons/fa6-solid/earth-americas'
import Search from '~icons/fa6-solid/magnifying-glass'
import TrashAlt from '~icons/fa6-solid/trash-can'

import { BgType } from '@/shared/enums'
import { useSettingsStore } from '@/shared/settings'

import { useFocusState } from '@newtab/composables/useFocus'
import usePerfClasses from '@newtab/composables/usePerfClasses'
import { useSearchHistoryCache } from '@newtab/composables/useSearchHistoryCache'
import { searchSuggestAPIs, searchSuggestCache } from '@newtab/shared/search'
import { parseNavigableUrl } from '@newtab/shared/search/url'

import SuggestListItem from './SuggestListItem.vue'

const { t } = useTranslation()

const focusStore = useFocusState()
const settings = useSettingsStore()
const {
  histories: cachedHistories,
  ensureLoaded: ensureHistoryLoaded,
  clearHistories: clearHistoryCache,
} = useSearchHistoryCache()

const isShowSearchHistories = ref(false)
const currentActiveSuggest = ref<null | number>(null)
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

type DisplayedSuggestion = { action: 'navigate' | 'search' | 'suggest'; text: string }

const navigableUrl = computed(() => parseNavigableUrl(props.searchText))
const displayedSuggestions = computed<DisplayedSuggestion[]>(() => {
  const suggestions = searchSuggestions.value.slice(0, navigableUrl.value ? 8 : 10).map((text) => ({
    action: 'suggest' as const,
    text,
  }))
  if (!navigableUrl.value) return suggestions
  return [
    { action: 'navigate', text: navigableUrl.value.text },
    { action: 'search', text: navigableUrl.value.text },
    ...suggestions,
  ]
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
    showSuggestionsDebounced(query)
  }
}

watch(
  () => props.searchText,
  (newText) => {
    handleInput(newText)
  },
)

watch(
  () => focusStore.isFocused,
  (isFocused) => {
    if (isFocused) {
      if (props.searchText.trim()) {
        showSuggestionsDebounced(props.searchText.trim())
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

watch(
  [() => settings.search.suggestionAPI, () => settings.search.suggestionsEnabled],
  () => {
    cancelSuggestionRequest()
    if (!props.searchText.trim()) return
    clearSearchSuggestions()
    if (focusStore.isFocused) showSuggestionsDebounced()
  },
)

onUnmounted(() => {
  cancelSuggestionRequest()
})

function clearActiveSuggest() {
  currentActiveSuggest.value = null
}

function activateSuggest(index: number): string | null {
  const nextItem = displayedSuggestions.value[index]
  if (!nextItem) {
    return null
  }

  currentActiveSuggest.value = index
  return nextItem.text
}

function submitActiveSuggest() {
  const index = currentActiveSuggest.value
  if (index === null) return false
  const item = displayedSuggestions.value[index]
  if (!item) return false
  if (item.action === 'navigate' && navigableUrl.value) emit('navigateToUrl', navigableUrl.value.url)
  else emit('doSearchWithText', item.text)
  return true
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

  clearActiveSuggest()

  if (previousIndex === null) {
    const nextIndex = direction > 0 ? direction - 1 : suggestionsLength + direction
    const nextText = activateSuggest(nextIndex)
    return nextText ? { searchText: nextText, originSearchText: nextOriginText } : null
  }

  const newIndex = previousIndex + direction
  if (newIndex < 0 || newIndex >= suggestionsLength) {
    return {
      searchText: nextOriginText || '',
      originSearchText: '',
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
      :text="
        item.action === 'navigate'
          ? t('newtab:search.navigateTo', { url: item.text })
          : item.action === 'search'
            ? t('newtab:search.searchFor', { text: item.text })
            : item.text
      "
      :icon="item.action === 'navigate' ? Globe : item.action === 'search' ? Search : undefined"
      :muted="item.action !== 'suggest'"
      :active="currentActiveSuggest === index"
      @click="
        item.action === 'navigate' && navigableUrl
          ? emit('navigateToUrl', navigableUrl.url)
          : emit('doSearchWithText', item.text)
      "
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
      <el-icon style="margin-right: 5px"><trash-alt /></el-icon>
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
    display: -webkit-box;
    align-items: center;
    height: 33px;
    padding: 0 30px;
    overflow: hidden;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    line-height: 33px;
    color: var(--el-text-color-primary);
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

    &--muted {
      color: var(--el-text-color-secondary);
    }

    &-icon {
      flex: none;
      margin-right: 8px;
    }

    &-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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
