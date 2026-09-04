<script setup lang="ts">
import { useDebounceFn, useElementSize } from '@vueuse/core'

import {
  DragDropProvider,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/vue'
import type { ScrollbarInstance } from 'element-plus'
import { useTranslation } from 'i18next-vue'
import SearchRound from '~icons/ic/round-search'

import { SortMode } from '@/shared/enums'
import { useSettingsStore } from '@/shared/settings'

import { useCompositionInput } from '@newtab/composables/useCompositionInput'
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
import {
  createBookmarkDropPreview,
  getBookmarkDndData,
  resolveBookmarkMoveDestination,
  type BookmarkDropPreview,
} from './composables/useBookmarkDnd'
import {
  BOOKMARK_ROW_HEIGHT,
  flattenVisibleBookmarkTree,
  getBookmarkVirtualRange,
} from './virtualTree'

function snapshotActiveMap(map: Record<number, string[]>) {
  return Object.fromEntries(
    Object.entries(toRaw(map)).map(([depth, ids]) => [depth, [...toRaw(ids)]]),
  ) as Record<number, string[]>
}

const opened = defineModel<boolean>({ required: true })
const { isComposing: isImeComposing } = useImeAwareDialog()

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

const drawerWidth = ref(settings.bookmark.drawerWidth)
const editDialogRef = ref<InstanceType<typeof BookmarkEditDialog>>()
const groupSelectDialogRef = ref<InstanceType<typeof QuickLinkGroupSelectDialog>>()
const animateTreeChanges = ref(false)
let treeAnimationTimer: ReturnType<typeof setTimeout> | null = null
const draggedNodeId = ref<string | null>(null)
const dropPreview = ref<BookmarkDropPreview | null>(null)
// 本地拖拽会异步刷新 worker 结果；等刷新结果抵达后再恢复，避免被默认展开路径覆盖。
const activeMapSnapshotForNextRefresh = ref<Record<number, string[]> | null>(null)

provide(
  OPEN_BOOKMARK_EDIT_DIALOG,
  (node) => editDialogRef.value && editDialogRef.value.openEditDialog(node),
)
provide(
  OPEN_QUICK_LINK_GROUP_SELECT_DIALOG,
  (options) => groupSelectDialogRef.value?.open(options) ?? Promise.resolve(null),
)

function onDrawerResize(_e: MouseEvent, size: number): void {
  drawerWidth.value = size
}

function onDrawerResizeEnd(_e: MouseEvent, size: number): void {
  drawerWidth.value = size
  settings.bookmark.drawerWidth = size
}

watch(
  opened,
  (isOpen) => {
    if (isOpen && !store.loaded) void store.loadBookmarks()
  },
  { immediate: true },
)

function handleDrawerClosed() {
  if (opened.value) return

  activeMap.value = {}
  activeMapSnapshotForNextRefresh.value = null
  draggedNodeId.value = null
  dropPreview.value = null
  searchQuery.value = ''
  resetVirtualScroll()
  store.dispose()
}

onUnmounted(() => {
  if (treeAnimationTimer) clearTimeout(treeAnimationTimer)
  store.dispose()
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

watch(
  activeMap,
  () => {
    animateTreeChanges.value = true
    if (treeAnimationTimer) clearTimeout(treeAnimationTimer)
    treeAnimationTimer = setTimeout(() => {
      animateTreeChanges.value = false
      treeAnimationTimer = null
    }, 200)
  },
  { deep: true },
)

const virtualScrollbarRef = ref<ScrollbarInstance>()
const virtualViewportRef = computed(() => virtualScrollbarRef.value?.wrapRef)
const virtualScrollTop = ref(0)
const { height: virtualViewportHeight } = useElementSize(virtualViewportRef, {
  width: 0,
  height: 600,
})
const virtualRows = computed(() =>
  flattenVisibleBookmarkTree(store.filteredResult, activeMap.value),
)
const virtualRange = computed(() =>
  getBookmarkVirtualRange(
    virtualRows.value.length,
    virtualScrollTop.value,
    virtualViewportHeight.value,
  ),
)
const renderedRows = computed(() => {
  const rows = virtualRows.value.slice(virtualRange.value.start, virtualRange.value.end)
  const draggedId = draggedNodeId.value
  if (!draggedId || rows.some((row) => row.node.id === draggedId)) return rows

  const draggedRow = virtualRows.value.find((row) => row.node.id === draggedId)
  return draggedRow ? [...rows, draggedRow].sort((a, b) => a.index - b.index) : rows
})

watch(
  () => virtualRows.value.length,
  () => {
    nextTick(() => {
      const viewport = virtualViewportRef.value
      if (!viewport) return
      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      if (viewport.scrollTop <= maxScrollTop) return
      virtualScrollbarRef.value?.setScrollTop(maxScrollTop)
      virtualScrollTop.value = maxScrollTop
      virtualScrollbarRef.value?.update()
    })
  },
)

function handleVirtualScroll({ scrollTop }: { scrollTop: number }) {
  virtualScrollTop.value = scrollTop
}

function resetVirtualScroll() {
  virtualScrollTop.value = 0
  virtualScrollbarRef.value?.setScrollTop(0)
}

// 记录当前打开的右键菜单关闭函数，实现全局唯一
const openedMenuCloseFn = ref<(() => void) | null>(null)
provide(BOOKMARK_OPENED_MENU_CLOSE_FN, openedMenuCloseFn)

watch(
  () => store.firstMatchPath,
  (path) => {
    const activeMapSnapshot = activeMapSnapshotForNextRefresh.value
    if (activeMapSnapshot) {
      activeMap.value = activeMapSnapshot
      activeMapSnapshotForNextRefresh.value = null
      return
    }

    resetVirtualScroll()
    if (searchQuery.value.trim() === '' && path.length === 0) {
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

function handleBookmarkDragStart(event: DragStartEvent) {
  const source = getBookmarkDndData(event.operation.source)
  draggedNodeId.value = source?.kind === 'bookmark-item' ? source.id : null
  dropPreview.value = null
  if (openedMenuCloseFn.value) {
    openedMenuCloseFn.value()
    openedMenuCloseFn.value = null
  }
}

function handleBookmarkDragMove(event: DragMoveEvent) {
  const source = getBookmarkDndData(event.operation.source)
  const target = getBookmarkDndData(event.operation.target)
  const preview = createBookmarkDropPreview(
    source,
    target,
    event.to?.y ?? event.operation.position.current.y,
    event.operation.target?.shape?.center.y,
  )

  dropPreview.value =
    preview &&
    source?.kind === 'bookmark-item' &&
    source.isFolder &&
    store.isBookmarkSelfOrDescendant(source.id, preview.parentId)
      ? null
      : preview
}

async function handleBookmarkDragEnd(event: DragEndEvent) {
  const preview = dropPreview.value
  dropPreview.value = null
  const source = getBookmarkDndData(event.operation.source)
  if (event.canceled || source?.kind !== 'bookmark-item' || !preview) {
    draggedNodeId.value = null
    return
  }
  if (searchQuery.value.trim() !== '' || store.sortMode !== SortMode.Original) {
    draggedNodeId.value = null
    return
  }
  if (source.index === undefined) {
    draggedNodeId.value = null
    return
  }

  const destination = resolveBookmarkMoveDestination({
    fromParentId: source.parentId,
    fromIndex: source.index,
    preview,
    getChildrenCount: store.getBookmarkChildrenCount,
  })
  if (source.parentId === destination.parentId && source.index === destination.index) {
    draggedNodeId.value = null
    return
  }

  const drop = event.suspend()
  const expandedSnapshot = snapshotActiveMap(activeMap.value)
  activeMapSnapshotForNextRefresh.value = expandedSnapshot
  try {
    await store.moveBookmark(source.id, destination)
  } catch (error) {
    console.error(t('bookmark.moveError'), error)
    ElNotification.error({
      title: t('bookmark.moveError'),
      message: (error as Error).message || 'Unknown error.',
    })
    activeMapSnapshotForNextRefresh.value = expandedSnapshot
    await store.loadBookmarks(true)
  } finally {
    await nextTick()
    drop.abort()
    draggedNodeId.value = null
  }
}
</script>

<template>
  <el-drawer
    v-model="opened"
    :direction="settings.bookmark.direction"
    :title="t('bookmark.title')"
    :size="settings.bookmark.drawerWidth"
    class="noselect"
    :class="bookmarkPerfClass"
    append-to-body
    resizable
    @resize="onDrawerResize"
    @resize-end="onDrawerResizeEnd"
    @closed="handleDrawerClosed"
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
          <el-scrollbar
            ref="virtualScrollbarRef"
            class="bookmark-virtual-list"
            @scroll="handleVirtualScroll"
          >
            <div
              class="bookmark-virtual-list__spacer"
              :style="{ height: `${virtualRange.totalHeight}px` }"
            >
              <DragDropProvider
                @dragStart="handleBookmarkDragStart"
                @dragMove="handleBookmarkDragMove"
                @dragEnd="handleBookmarkDragEnd"
              >
                <TransitionGroup :name="animateTreeChanges ? 'bookmark-tree' : undefined">
                  <bookmark-item
                    v-for="row in renderedRows"
                    :key="row.node.id"
                    :node="row.node"
                    :depth="row.depth"
                    :is-searching="searchQuery.trim() !== ''"
                    :is-sorted-mode="store.sortMode !== SortMode.Original"
                    :drop-preview-placement="
                      dropPreview?.nodeId === row.node.id ? dropPreview.placement : null
                    "
                    :style="{ top: `${row.index * BOOKMARK_ROW_HEIGHT}px` }"
                  />
                </TransitionGroup>
              </DragDropProvider>
            </div>
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
  border-radius: var(--le-radius-base, 20px);

  &.el-drawer.ltr,
  &.el-drawer.rtl {
    height: calc(100% - 20px);

    .el-drawer__dragger {
      top: 20px;
      height: calc(100% - 40px);

      &::before {
        border-radius: var(--le-radius-tiny, 5px);
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

.bookmark-virtual-list {
  position: relative;
  height: calc(100% - 42px);
  contain: strict;

  &__spacer {
    position: relative;
    width: 100%;
  }

  &:not(:has(.bookmark-dnd-item--dragging)) {
    .bookmark-link-item:hover,
    .bookmark-folder-item:hover {
      background-color: var(--el-color-primary-light-8);
    }

    .bookmark-link-item:focus-visible,
    .bookmark-folder-item:focus-visible {
      position: relative;
      outline: none;

      &::after {
        position: absolute;
        inset: 0;
        pointer-events: none;
        content: '';
        border: 2px solid var(--el-color-primary);
        border-radius: var(--le-radius-inner, 10px);
      }
    }

    .bookmark-drag-handle:hover {
      background-color: var(--el-color-primary-light-9);
      opacity: 1;
    }
  }
}

.bookmark-dnd-item {
  position: absolute;
  right: 0;
  left: 0;
  display: grid;
  height: 40px;
  transition: opacity var(--el-transition-duration-fast);

  &--drop-before::before,
  &--drop-after::after {
    position: absolute;
    right: 16px;
    left: calc(var(--depth) + 20px);
    z-index: 2;
    height: 3px;
    pointer-events: none;
    content: '';
    background: var(--el-color-primary);
    border-radius: 999px;
    box-shadow: 0 0 0 1px var(--el-bg-color);
  }

  &--drop-before::before {
    top: -1px;
  }

  &--drop-after::after {
    bottom: -1px;
  }

  &--dragging {
    opacity: 0.35;
  }

  &--drop-target {
    > .bookmark-link-item,
    > .bookmark-folder-item {
      background-color: var(--el-color-primary-light-8);
    }
  }

  &--drop-inside > .bookmark-folder-item {
    background-color: var(--el-color-primary-light-8);
    box-shadow: inset 0 0 0 2px var(--el-color-primary);
  }
}

.bookmark-tree-enter-active,
.bookmark-tree-leave-active {
  transition: opacity var(--el-transition-duration-fast);
}

.bookmark-tree-move {
  transition: transform var(--el-transition-duration) ease;
}

.bookmark-tree-enter-from,
.bookmark-tree-leave-to {
  opacity: 0;
}

.bookmark-dnd-children {
  &--drop-target {
    box-shadow: inset 0 0 0 1px var(--el-color-primary-light-5);
  }
}

.bookmark-folder-item {
  display: flex;
  align-items: center;
  width: 100%;
  height: 40px;
  padding-right: 20px;
  padding-left: var(--depth);
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;

  &__arrow {
    display: flex;
    flex: 0 0 20px;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    transition: transform var(--el-transition-duration-fast) ease;

    &.is-expanded {
      transform: rotate(90deg);
    }
  }

  &__content {
    display: flex;
    flex: 1;
    gap: 10px;
    align-items: center;
    min-width: 0;
  }

  .el-text {
    flex: 1;
    min-width: 0;
    color: inherit;
  }
}

.bookmark-link-item {
  display: flex;
  align-items: center;
  height: 40px;
  padding-right: 20px;
  padding-left: calc(var(--depth) + 20px);
  color: inherit;
  text-decoration: none;

  img {
    height: 1em;
    margin-right: 10px;
    border-radius: var(--le-radius-micro, 3px);
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
  --le-radius-popper: var(--le-radius-surface, 15px);
  --le-menu-padding: 4px;
  --el-popper-border-radius: var(--le-radius-popper);

  border-radius: var(--le-radius-popper);

  &.bookmark__menu-popper--opacity.bookmark__menu-popper--blur {
    background-color: var(--le-bg-color-overlay-bookmark-menu);
  }

  &.bookmark__menu-popper--blur {
    @include acrylic.acrylic(var(--le-bookmark-menu-backdrop-blur, 10px));
  }

  .el-dropdown-menu {
    padding: var(--le-menu-padding);
    background-color: initial;
  }

  .el-dropdown-menu__item {
    padding: 3px 30px 2px 10px;
    font-size: var(--el-font-size-extra-small);
    border-radius: var(--le-radius-menu-item);
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
