<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import TrashAlt from '~icons/fa6-solid/trash-can'

import { BgType } from '@/shared/enums'
import { useSettingsStore } from '@/shared/settings'

import { useFocusState } from '@newtab/composables/useFocus'
import usePerfClasses from '@newtab/composables/usePerfClasses'
import { useSearchHistoryCache } from '@newtab/composables/useSearchHistoryCache'
import { createSuggestRunner, searchSuggestAPIs, searchSuggestCache } from '@newtab/shared/search'

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

const props = defineProps<{
  searchText: string
  searchFormWidth: number
}>()

const emit = defineEmits<{
  doSearchWithText: [text: string]
}>()

const perf = usePerfClasses(() => ({
  transparent: settings.perf.searchBar.transparent,
  blur: settings.perf.searchBar.blur,
}))

const suggestionAreaPerfClass = computed(() => [
  {
    'search-suggestion-area--shadow': settings.search.style.shadow,
    'search-suggestion-area--dark':
      settings.background.bgType === BgType.None && searchSuggestions.value.length > 0,
  },
  perf('search-suggestion-area').value,
])

const areaHeight = computed(() => {
  const length = searchSuggestions.value.length
  if (length === 0) {
    return '0'
  }
  if (length > 10) {
    return isShowSearchHistories.value ? '363px' : '330px'
  }
  return isShowSearchHistories.value ? `${(length + 1) * 33}px` : `${length * 33}px`
})

const displayedSuggestions = computed(() =>
  searchSuggestions.value.length > 10
    ? searchSuggestions.value.slice(0, 10)
    : searchSuggestions.value,
)

function handleInput() {
  if (focusStore.isFocused && !props.searchText) {
    // 如果搜索词为空，则显示搜索历史
    runner.cancel()
    latestLiveQuery.value = ''
    clearSearchSuggestions()
    showSearchHistories()
  } else {
    hideSearchHistories()
    showSuggestionsDebounced()
  }
}

const canShowHistory = () => focusStore.isFocused && !props.searchText

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
    searchSuggestions.value = searchHistories.slice()
    isShowSearchHistories.value = true
  }
}

// 统一“请求 + 取消 + 防抖 + 重试”（重试统一在运行器层）
const runner = createSuggestRunner({ debounceMs: 300, maxRetries: 2, retryDelay: 100 })
runner.onResult(({ text, list }) => {
  if (text !== latestLiveQuery.value || text !== props.searchText || isShowSearchHistories.value) {
    return
  }

  searchSuggestions.value = list
  // 缓存搜索建议结果
  if (list.length > 0) {
    searchSuggestCache.set(text, list)
  }
})
runner.onError((err, text) => {
  if (text !== latestLiveQuery.value || text !== props.searchText || isShowSearchHistories.value) {
    return
  }

  console.error('Failed to fetch search suggestions:', err)
  searchSuggestions.value = []
})

function showSuggestionsDebounced() {
  historyRequestVersion += 1
  latestLiveQuery.value = props.searchText
  // 至少2个字符才触发搜索建议
  if (props.searchText.length < 2) {
    runner.cancel()
    return
  }

  // 先检查缓存，命中则直接返回
  const cached = searchSuggestCache.get(props.searchText)
  if (cached) {
    searchSuggestions.value = cached
    return
  }

  const api = searchSuggestAPIs[settings.search.suggestionAPI]
  if (!api) {
    console.error('Selected search suggestion API not found')
    return
  }
  runner.run(latestLiveQuery.value, api.parser)
}

onUnmounted(() => {
  runner.cancel()
})

function clearActiveSuggest() {
  currentActiveSuggest.value = null
}

function activateSuggest(index: number): string | null {
  const nextText = searchSuggestions.value[index]
  if (!nextText) {
    return null
  }

  currentActiveSuggest.value = index
  return nextText
}

function hideSearchHistories() {
  historyRequestVersion += 1
  isShowSearchHistories.value = false
}

function clearSearchSuggestions() {
  runner.cancel()
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
  const suggestionsLength = searchSuggestions.value.length
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
      searchSuggestions.value = list.slice()
    }
  },
)

defineExpose({
  clearSearchSuggestions,
  hideSearchHistories,
  showSearchHistories,
  handleInput,
  navigateActiveSuggest,
})
</script>

<template>
  <div
    ref="searchSuggestionArea"
    class="search-suggestion-area"
    :class="suggestionAreaPerfClass"
    :style="{
      width: `${searchFormWidth}px`,
      height: areaHeight,
    }"
  >
    <suggest-list-item
      v-for="(item, index) in displayedSuggestions"
      :key="index"
      :text="item"
      :active="currentActiveSuggest === index"
      @click="emit('doSearchWithText', item)"
      @hover="currentActiveSuggest = index"
      @leave="currentActiveSuggest = currentActiveSuggest === index ? null : currentActiveSuggest"
    />
    <div
      v-show="isShowSearchHistories"
      class="search-suggestion-area__item search-suggestion-area__clear-history noselect"
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
  border-radius: 20px;
  transition:
    height 0.1s var(--cubic-bezier),
    background-color var(--el-transition-duration-fast) ease,
    border var(--el-transition-duration-fast) ease,
    box-shadow var(--el-transition-duration-fast) ease;

  &--shadow {
    box-shadow: var(--el-box-shadow);
  }

  &.search-suggestion-area--opacity {
    background-color: var(--le-bg-color-overlay-opacity-50);
  }

  &.search-suggestion-area--blur {
    @include acrylic.acrylic(30px);
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
      background-color: var(--le-bg-color-overlay-opacity-60);
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
      background-color: var(--le-bg-color-overlay-opacity-60);
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
