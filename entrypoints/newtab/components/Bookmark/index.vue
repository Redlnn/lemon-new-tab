<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'

import { SearchRound } from '@vicons/material'
import { useTranslation } from 'i18next-vue'

import { SortMode } from '@/shared/enums'
import { useSettingsStore } from '@/shared/settings'

import { useDialog } from '@newtab/composables/useDialog'
import usePerfClasses from '@newtab/composables/usePerfClasses'
import {
  BOOKMARK_ACTIVE_MAP,
  BOOKMARK_OPENED_MENU_CLOSE_FN,
  OPEN_BOOKMARK_EDIT_DIALOG
} from '@newtab/shared/keys'

import { useBookmarkStore } from './bookmarks'
import BookmarkEditDialog from './components/BookmarkEditDialog.vue'
import BookmarkItem from './components/BookmarkItem.vue'

const { opened, show, hide, toggle } = useDialog()
defineExpose({ show, hide, toggle })

const { t } = useTranslation()
const settings = useSettingsStore()

const perf = usePerfClasses(() => ({
  transparentOff: settings.perf.disableBookmarkTransparent,
  blurOff: settings.perf.disableBookmarkBlur
}))

const bookmarkPerfClass = perf('bookmark')

const store = useBookmarkStore()
store._setSortMode(settings.bookmark.defaultSortMode)

const drawerWidth = ref(400)
const editDialogRef = ref<InstanceType<typeof BookmarkEditDialog>>()

provide(
  OPEN_BOOKMARK_EDIT_DIALOG,
  (node) => editDialogRef.value && editDialogRef.value.openEditDialog(node)
)

function onDrawerResize(evt: MouseEvent, size: number): void {
  drawerWidth.value = size
}

onMounted(() => {
  if (!store.loaded) {
    store.loadBookmarks()
  }
})

const isComposing = ref(false)
const searchQuery = ref('')

function handleCompositionStart() {
  isComposing.value = true
}

function handleCompositionEnd() {
  isComposing.value = false
  // 输入法上屏后,触发搜索建议
  handleInput()
}

const updateStoreDebounced = useDebounceFn(() => {
  // 搜索时关闭已打开的菜单
  if (openedMenuCloseFn.value) {
    openedMenuCloseFn.value()
    openedMenuCloseFn.value = null
  }
  store.searchQuery = searchQuery.value
  store.updateFilteredResult()
}, 200)

function handleInput() {
  if (isComposing.value) {
    return
  }
  updateStoreDebounced()
}

function getEnumKeyByValue<T extends Record<string, string>, V extends T[keyof T]>(
  enumObj: T,
  value: V
): keyof T | undefined {
  const key = (Object.keys(enumObj) as Array<keyof T>).find((key) => enumObj[key] === value)
  if (key === 'Original') return ''
  return key
}

const sortMode = ref(getEnumKeyByValue(SortMode, store.sortMode))
const sortOptions = [
  {
    value: '',
    labelKey: 'bookmark.sortMode.origin',
    click: () => store.setSortMode(SortMode.Original)
  },
  {
    value: 'NameAsc',
    labelKey: 'bookmark.sortMode.nameAsc',
    click: () => store.setSortMode(SortMode.NameAsc)
  },
  {
    value: 'NnameDesc',
    labelKey: 'bookmark.sortMode.nameDesc',
    click: () => store.setSortMode(SortMode.NameDesc)
  },
  {
    value: 'CreatedAsc',
    labelKey: 'bookmark.sortMode.createdAsc',
    click: () => store.setSortMode(SortMode.CreatedDesc)
  },
  {
    value: 'CreatedDesc',
    labelKey: 'bookmark.sortMode.createdDesc',
    click: () => store.setSortMode(SortMode.CreatedAsc)
  }
]

// 控制不同深度层级的激活值（按深度索引），避免父子 collapse 共享同一数组导致冲突
const activeMap = ref<Record<number, string[]>>({})
provide(BOOKMARK_ACTIVE_MAP, activeMap)

// 记录当前打开的右键菜单关闭函数，实现全局唯一
const openedMenuCloseFn = ref<(() => void) | null>(null)
provide(BOOKMARK_OPENED_MENU_CLOSE_FN, openedMenuCloseFn)

// 顶层 collapse 对应深度为 1，暴露一个 computed 以绑定到 v-model
const topModel = computed({
  get: () => activeMap.value[1] ?? [],
  set: (v: string[]) => {
    activeMap.value[1] = v
  }
})

watch(
  () => store.firstMatchPath,
  (path) => {
    activeMap.value = {}
    if (path.length > 0) {
      for (let i = 0, len = path.length; i < len; i++) {
        // 深度索引从 1 开始
        activeMap.value[i + 1] = [path[i]!]
      }
    }
  },
  { immediate: true }
)
</script>

<template>
  <el-drawer
    v-model="opened"
    :direction="settings.bookmark.direction"
    :title="t('bookmark.title')"
    size="400"
    class="noselect"
    :class="bookmarkPerfClass"
    append-to-body
    resizable
    @resize="onDrawerResize"
    lock-scroll
    close-on-click-modal
    close-on-press-escape
    destroy-on-close
  >
    <Transition name="fade" mode="out-in">
      <section style="height: 100%" v-if="drawerWidth >= 360">
        <div class="bookmark-search">
          <el-input
            v-model="searchQuery"
            :prefix-icon="SearchRound"
            :empty-values="[null, undefined]"
            @compositionstart="handleCompositionStart"
            @compositionend="handleCompositionEnd"
            @input="handleInput"
          />
          <el-select v-model="sortMode" :placeholder="t('bookmark.sortBy')">
            <el-option
              v-for="(item, index) in sortOptions"
              :key="index"
              :label="t(item.labelKey)"
              :value="item.value"
              @click="item.click"
            />
          </el-select>
        </div>
        <template v-if="store.filteredResult.length > 0">
          <el-scrollbar style="height: calc(100% - 42px)">
            <el-collapse v-model="topModel" expand-icon-position="left">
              <bookmark-item
                v-for="item in store.filteredResult"
                :key="item.id"
                :node="item"
                :is-searching="searchQuery.trim() !== ''"
                :is-sorted-mode="store.sortMode !== SortMode.Original"
              />
            </el-collapse>
          </el-scrollbar>
          <bookmark-edit-dialog ref="editDialogRef" />
        </template>
        <template v-else>
          <div class="bookmark-404">
            <div class="bookmark-404--icon">🧐</div>
            <code class="bookmark-404--title">404</code>
            <div class="bookmark-404--desc">{{ t('bookmark.404') }}</div>
          </div>
        </template>
      </section>
      <section v-else class="bookmark-small">
        <div class="bookmark-small__icon">🙈</div>
        <div class="bookmark-small__title">
          {{ t('bookmark.tooSmall') }}
        </div>
        <div class="bookmark-small__desc">
          {{ t('bookmark.expandHint') }}
        </div>
      </section>
    </Transition>
  </el-drawer>
</template>

<style lang="scss">
@use '@newtab/styles/mixins/acrylic.scss' as acrylic;

.bookmark {
  max-width: calc(100% - 20px);
  margin: 10px;
  overflow: hidden;
  border-radius: 20px;

  &.el-drawer.ltr,
  &.el-drawer.rtl {
    height: calc(100% - 20px);

    .el-drawer__dragger {
      top: 20px;
      height: calc(100% - 40px);

      &::before {
        border-radius: 4px;
      }
    }
  }

  &.el-drawer.rtl .el-drawer__dragger {
    left: 2px;
  }

  &.el-drawer.ltr .el-drawer__dragger {
    right: 2px;
  }

  &--opacity.el-drawer {
    background-color: var(--le-bg-color-overlay-opacity-15);
  }

  html.colorful &:not(.bookmark--opacity) {
    background-color: var(--el-color-primary-light-9);
  }

  &--blur.el-drawer {
    @include acrylic.acrylic;
  }

  .el-drawer__body {
    padding: 0;
  }

  .el-drawer__title {
    font-weight: bold;
  }

  .el-scrollbar__view {
    padding-bottom: 20px;
  }

  .el-drawer__close-btn {
    .el-drawer__close {
      transition: transform var(--el-transition-duration-fast) ease;
    }

    &:hover,
    &:focus-visible {
      .el-drawer__close {
        transform: rotate(90deg);
      }
    }
  }
}

@media (width <= 600px) {
  .bookmark {
    min-width: 100%;
    margin: 0;
    border-radius: 0;

    &.el-drawer.ltr,
    &.el-drawer.rtl {
      height: 100%;
    }

    .el-drawer__dragger {
      display: none;
    }
  }
}

.bookmark-search {
  display: flex;
  gap: 5px;
  padding: 0 20px 10px;

  .el-select {
    flex-shrink: 0;
    width: 150px;
  }
}

.bookmark-404 {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
  height: calc(100% - 42px);

  &--icon {
    font-size: 50px;
  }

  &--title {
    font-size: var(--el-font-size-large);
    font-weight: bold;
  }

  &--desc {
    padding-bottom: 116px;
    font-size: var(--el-font-size-small);
    color: var(--el-text-color-secondary);
  }
}

.bookmark-small {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
  height: 100%;

  &__icon {
    font-size: 50px;
  }

  &__title {
    font-size: var(--el-font-size-medium);
    font-weight: bold;
  }

  &__desc {
    padding-bottom: 74px;
    font-size: var(--el-font-size-small);
    color: var(--el-text-color-secondary);
  }
}

.bookmark .el-scrollbar__view > .el-collapse {
  &:not(:has(.sortable-chosen)) {
    .bookmark-link-item:hover,
    .el-collapse-item__header:hover {
      background-color: var(--el-color-primary-light-8);
    }

    .bookmark-link-item:focus-visible,
    .el-collapse-item__header:focus-visible {
      position: relative;
      outline: none;

      &::after {
        position: absolute;
        inset: 0;
        pointer-events: none;
        content: '';
        border: 2px solid var(--el-color-primary);
        border-radius: 10px;
      }
    }

    .bookmark-drag-handle:hover {
      background-color: var(--el-color-primary-light-9);
      opacity: 1;
    }
  }
}

.bookmark .el-collapse {
  --el-collapse-border-color: transparent;
  --el-collapse-header-bg-color: transparent;
  --el-collapse-content-bg-color: transparent;
  --el-collapse-header-height: 40px;

  .el-collapse-item__header {
    padding-right: 20px;
    padding-left: var(--depth);
  }

  .el-collapse-item__title {
    display: flex;
    align-items: center;

    .el-icon:not(.bookmark-drag-handle) {
      margin-right: 10px;
    }
  }

  .el-collapse-item__content {
    padding-bottom: 0;
  }
}

.bookmark-link-item {
  display: flex;
  align-items: center;
  height: var(--el-collapse-header-height);
  padding-right: 20px;
  padding-left: calc(var(--depth) + 40px);
  color: inherit;
  text-decoration: none;

  img {
    height: 1em;
    margin-right: 10px;
    border-radius: 3px;
  }

  .el-text {
    font-size: inherit;
    line-height: 1.2em;
    color: inherit;
    overflow-wrap: anywhere;
  }

  &.is-no-drag {
    .bookmark-drag-handle {
      display: none;
    }
  }
}

.bookmark__menu-popper.el-dropdown__popper.el-popper {
  border-radius: 15px;

  &.bookmark__menu-popper--opacity.bookmark__menu-popper--blur {
    background-color: var(--le-bg-color-overlay-opacity-30);
  }

  &.bookmark__menu-popper--blur {
    @include acrylic.acrylic;
  }

  .el-dropdown-menu {
    padding: 4px;
    background-color: initial;
  }

  .el-dropdown-menu__item {
    padding: 3px 30px 2px 10px;
    font-size: var(--el-font-size-extra-small);
    border-radius: 11px;
  }
}

// 拖动相关样式
.bookmark-drag-handle {
  width: 30px;
  height: 30px;
  margin-left: 10px;
  color: var(--el-text-color-regular);
  cursor: grab;
  border-radius: 50%;
  opacity: 0.3;
  transition:
    opacity var(--el-transition-duration-fast),
    background-color var(--el-transition-duration-fast);

  &:active {
    cursor: grabbing;
  }

  &-container {
    display: flex;
    flex-grow: 1;
    flex-shrink: 0;
    flex-direction: row-reverse;
    align-items: center;
    height: 100%;
  }
}
</style>
