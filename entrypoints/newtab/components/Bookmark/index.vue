<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'

import { DragDropProvider, type DragEndEvent } from '@dnd-kit/vue'
import { useTranslation } from 'i18next-vue'
import SearchRound from '~icons/ic/round-search'

import type { Browser } from 'wxt/browser'

import { SortMode } from '@/shared/enums'
import { useSettingsStore } from '@/shared/settings'

import { useCompositionInput } from '@newtab/composables/useCompositionInput'
import { useDialog } from '@newtab/composables/useDialog'
import { useImeAwareDialog } from '@newtab/composables/useImeAwareDialog'
import usePerfClasses from '@newtab/composables/usePerfClasses'
import {
  BOOKMARK_ACTIVE_MAP,
  BOOKMARK_OPENED_MENU_CLOSE_FN,
  OPEN_BOOKMARK_EDIT_DIALOG,
  OPEN_QUICK_LINK_GROUP_SELECT_DIALOG,
} from '@newtab/shared/keys'

import QuickLinkGroupSelectDialog from '../QuickLinks/components/QuickLinkGroupSelectDialog.vue'

import { useBookmarkStore } from './bookmarks'
import BookmarkEditDialog from './components/BookmarkEditDialog.vue'
import BookmarkItem from './components/BookmarkItem.vue'
import { provideBookmarkItemContext } from './composables/bookmarkItemContext'
import { getBookmarkDndData } from './composables/useBookmarkDnd'

type SortableLike = {
  initialGroup?: unknown
  group?: unknown
  initialIndex?: unknown
  index?: unknown
  sortable?: {
    initialGroup?: unknown
    group?: unknown
    initialIndex?: unknown
    index?: unknown
  }
}

function getSortableString(value: SortableLike | null, key: 'initialGroup' | 'group') {
  const direct = value?.[key]
  if (typeof direct === 'string') return direct
  const nested = value?.sortable?.[key]
  return typeof nested === 'string' ? nested : null
}

function getSortableNumber(value: SortableLike | null, key: 'initialIndex' | 'index') {
  const direct = value?.[key]
  if (typeof direct === 'number') return direct
  const nested = value?.sortable?.[key]
  return typeof nested === 'number' ? nested : null
}

function snapshotActiveMap(map: Record<number, string[]>) {
  return Object.fromEntries(
    Object.entries(toRaw(map)).map(([depth, ids]) => [depth, [...toRaw(ids)]]),
  ) as Record<number, string[]>
}

function findBookmarkNode(
  nodes: Browser.bookmarks.BookmarkTreeNode[],
  id: string,
): Browser.bookmarks.BookmarkTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const matched = node.children ? findBookmarkNode(node.children, id) : null
    if (matched) return matched
  }
  return null
}

function getBookmarkChildrenCount(parentId: string) {
  const parentNode = findBookmarkNode(store.tree, parentId)
  return parentNode?.children?.length ?? null
}

function isBookmarkSelfOrDescendant(id: string, maybeDescendantId: string) {
  if (id === maybeDescendantId) return true

  const node = findBookmarkNode(store.tree, id)
  if (!node?.children) return false

  return Boolean(findBookmarkNode(node.children, maybeDescendantId))
}

function clampBookmarkMoveIndex(index: number, parentId: string) {
  const childrenCount = getBookmarkChildrenCount(parentId)
  if (childrenCount === null) return Math.max(0, index)

  const maxIndex = Math.max(0, childrenCount)
  return Math.min(Math.max(0, index), maxIndex)
}

function resolveBookmarkMoveIndex(options: {
  fromParentId: string | undefined
  fromIndex: number
  nextParentId: string
  nextIndex: number
}) {
  const { fromParentId, fromIndex, nextParentId, nextIndex } = options
  if (fromParentId !== nextParentId || nextIndex <= fromIndex) {
    return clampBookmarkMoveIndex(nextIndex, nextParentId)
  }

  // dnd-kit 的同级排序 index 描述拖拽列表位置，bookmarks.move 接收的是移除源节点后的插入位置。
  const offset = nextIndex - fromIndex
  const browserMoveIndex = offset === 1 ? nextIndex - 1 : nextIndex + 1
  return clampBookmarkMoveIndex(browserMoveIndex, nextParentId)
}

const { opened, show, hide, toggle } = useDialog()
const { isComposing: isImeComposing } = useImeAwareDialog()
defineExpose({ show, hide, toggle })

const { t } = useTranslation()
const settings = useSettingsStore()

const perf = usePerfClasses(() => ({
  transparent: settings.perf.bookmark.transparent,
  transparency: settings.perf.bookmark.transparency,
  blur: settings.perf.bookmark.blur,
}))

const bookmarkPerfClass = perf('bookmark')
const bookmarkMenuPopperClass = perf('bookmark__menu-popper')

provideBookmarkItemContext({
  popperClass: bookmarkMenuPopperClass,
  quickLinksGrouping: computed(() => settings.quickLinks.grouping),
})

const store = useBookmarkStore()
store._setSortMode(settings.bookmark.defaultSortMode)

const drawerWidth = ref(400)
const editDialogRef = ref<InstanceType<typeof BookmarkEditDialog>>()
const groupSelectDialogRef = ref<InstanceType<typeof QuickLinkGroupSelectDialog>>()
const dndRenderKey = ref(0)
const preserveActiveMapOnNextEmptyPath = ref(false)

provide(
  OPEN_BOOKMARK_EDIT_DIALOG,
  (node) => editDialogRef.value && editDialogRef.value.openEditDialog(node),
)
provide(
  OPEN_QUICK_LINK_GROUP_SELECT_DIALOG,
  (options) => groupSelectDialogRef.value?.open(options) ?? Promise.resolve(null),
)

function onDrawerResize(evt: MouseEvent, size: number): void {
  drawerWidth.value = size
}

onMounted(() => {
  if (!store.loaded) {
    store.loadBookmarks()
  }
})

const searchQuery = ref('')
const { isComposing, handleCompositionStart, handleCompositionEnd } =
  useCompositionInput(handleInput)

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
  value: V,
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
    click: () => store.setSortMode(SortMode.Original),
  },
  {
    value: 'NameAsc',
    labelKey: 'bookmark.sortMode.nameAsc',
    click: () => store.setSortMode(SortMode.NameAsc),
  },
  {
    value: 'NameDesc',
    labelKey: 'bookmark.sortMode.nameDesc',
    click: () => store.setSortMode(SortMode.NameDesc),
  },
  {
    value: 'CreatedAsc',
    labelKey: 'bookmark.sortMode.createdAsc',
    click: () => store.setSortMode(SortMode.CreatedAsc),
  },
  {
    value: 'CreatedDesc',
    labelKey: 'bookmark.sortMode.createdDesc',
    click: () => store.setSortMode(SortMode.CreatedDesc),
  },
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
  },
})

watch(
  () => store.firstMatchPath,
  (path) => {
    if (searchQuery.value.trim() === '' && path.length === 0) {
      if (preserveActiveMapOnNextEmptyPath.value) {
        preserveActiveMapOnNextEmptyPath.value = false
        return
      }
      activeMap.value = {}
      return
    }

    activeMap.value = {}
    if (path.length > 0) {
      for (let i = 0, len = path.length; i < len; i++) {
        // 深度索引从 1 开始
        activeMap.value[i + 1] = [path[i]!]
      }
    }
  },
  { immediate: true },
)

function handleBookmarkDragStart() {
  if (openedMenuCloseFn.value) {
    openedMenuCloseFn.value()
    openedMenuCloseFn.value = null
  }
}

async function handleBookmarkDragEnd(event: DragEndEvent) {
  const source = getBookmarkDndData(event.operation.source)
  const target = getBookmarkDndData(event.operation.target)
  if (event.canceled || source?.kind !== 'bookmark-item') return
  if (searchQuery.value.trim() !== '' || store.sortMode !== SortMode.Original) return

  const operationSource = event.operation.source as SortableLike | null
  const fromParentId = getSortableString(operationSource, 'initialGroup') ?? source.parentId
  const fromIndex = getSortableNumber(operationSource, 'initialIndex') ?? source.index

  const runtimeParentId = getSortableString(operationSource, 'group')
  const runtimeIndex = getSortableNumber(operationSource, 'index')
  const nextParentId =
    target?.kind === 'bookmark-container'
      ? target.parentId
      : (runtimeParentId ?? (target?.kind === 'bookmark-item' ? target.parentId : null))
  let nextIndex =
    target?.kind === 'bookmark-container'
      ? target.index
      : (runtimeIndex ?? (target?.kind === 'bookmark-item' ? target.index : null))
  if (!nextParentId || nextIndex === null || nextIndex === undefined || fromIndex === undefined) {
    return
  }

  nextIndex = resolveBookmarkMoveIndex({
    fromParentId,
    fromIndex,
    nextParentId,
    nextIndex,
  })

  if (fromParentId === nextParentId && fromIndex === nextIndex) return
  if (source.isFolder && isBookmarkSelfOrDescendant(source.id, nextParentId)) return

  try {
    const expandedSnapshot = snapshotActiveMap(activeMap.value)
    preserveActiveMapOnNextEmptyPath.value = true
    await store.moveBookmark(source.id, {
      parentId: nextParentId,
      index: nextIndex,
    })
    activeMap.value = expandedSnapshot
    dndRenderKey.value++
  } catch (error) {
    console.error(t('bookmark.moveError'), error)
    ElNotification.error({
      title: t('bookmark.moveError'),
      message: (error as Error).message || 'Unknown error.',
    })
    const expandedSnapshot = snapshotActiveMap(activeMap.value)
    preserveActiveMapOnNextEmptyPath.value = true
    await store.loadBookmarks()
    activeMap.value = expandedSnapshot
    dndRenderKey.value++
  }
}
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
    close-on-click-modal
    :close-on-press-escape="!isImeComposing"
    destroy-on-close
  >
    <Transition name="el-fade-in" mode="out-in">
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
            <DragDropProvider
              :key="dndRenderKey"
              @dragStart="handleBookmarkDragStart"
              @dragEnd="handleBookmarkDragEnd"
            >
              <el-collapse v-model="topModel" expand-icon-position="left">
                <bookmark-item
                  v-for="item in store.filteredResult"
                  :key="item.id"
                  :node="item"
                  :is-searching="searchQuery.trim() !== ''"
                  :is-sorted-mode="store.sortMode !== SortMode.Original"
                />
              </el-collapse>
            </DragDropProvider>
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
    <quick-link-group-select-dialog ref="groupSelectDialogRef" />
  </el-drawer>
</template>

<style lang="scss">
@use '@newtab/styles/mixins/acrylic.scss' as acrylic;

.bookmark {
  max-width: calc(100% - 20px);
  margin: 10px;
  overflow: hidden;
  background-color: var(--bookmark-background, var(--el-drawer-bg-color));
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
    background-color: var(--le-bg-color-overlay-bookmark);
  }

  &--blur.el-drawer {
    @include acrylic.acrylic(var(--le-bookmark-backdrop-blur, 10px));
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

html.colorful .bookmark {
  --bookmark-background: var(--el-color-primary-light-9);
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
  &:not(:has(.bookmark-dnd-item--dragging)) {
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

.bookmark-dnd-item {
  transition: opacity var(--el-transition-duration-fast);

  &--dragging {
    opacity: 0.35;
  }

  &--drop-target {
    > .bookmark-link-item,
    > .el-collapse-item > .el-collapse-item__header {
      background-color: var(--el-color-primary-light-8);
    }
  }
}

.bookmark-dnd-children {
  min-height: 6px;
  border-radius: 8px;

  &--drop-target {
    box-shadow: inset 0 0 0 1px var(--el-color-primary-light-5);
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

    span {
      width: stretch;
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
    width: stretch;
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
    background-color: var(--le-bg-color-overlay-bookmark-menu);
  }

  &.bookmark__menu-popper--blur {
    @include acrylic.acrylic(var(--le-bookmark-menu-backdrop-blur, 10px));
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
    flex-shrink: 0;
    flex-direction: row-reverse;
    align-items: center;
    height: 100%;
    margin-left: 10px;
  }
}
</style>
