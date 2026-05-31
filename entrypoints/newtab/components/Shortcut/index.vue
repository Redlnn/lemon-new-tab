<script setup lang="ts">
import { useDebounceFn, useEventListener, useResizeObserver, useWindowSize } from '@vueuse/core'

import i18next from 'i18next'
import { VueDraggable, useDraggable } from 'vue-draggable-plus'
import PlusIcon from '~icons/fa6-solid/plus'
import ChevronLeft20Filled from '~icons/fluent/chevron-left-20-filled'
import ChevronRight20Filled from '~icons/fluent/chevron-right-20-filled'

import { useSettingsStore } from '@/shared/settings'
import {
  DEFAULT_SHORTCUT_GROUP_ID,
  useShortcutStore,
  type Shortcut,
  type ShortcutGroup,
  type ShortcutTarget,
} from '@/shared/shortcut'

import { useFocusState } from '@newtab/composables/useFocus'
import usePerfClasses from '@newtab/composables/usePerfClasses'
import { SHORTCUT_OPENED_MENU_CLOSE_FN } from '@newtab/shared/keys'
import { isOnlyTouchDevice } from '@newtab/shared/touch'

import AddShortcut from './components/AddShortcut.vue'
import ShortcutContextMenu from './components/ShortcutContextMenu.vue'
import ShortcutGroupName from './components/ShortcutGroupName.vue'
import ShortcutGroupSelectDialog from './components/ShortcutGroupSelectDialog.vue'
import ShortcutItem from './components/ShortcutItem.vue'
import ShortcutPaginationDots from './components/ShortcutPaginationDots.vue'
import { buildShortcutDisplayItems } from './composables/shortcutDisplayItems'
import { useGroupNameRefs } from './composables/useGroupNameRefs'
import { useShortcutData } from './composables/useShortcutData'
import { useShortcutGroupActions } from './composables/useShortcutGroupActions'
import { solveGridColumnFirst, usePagedGridLayout } from './composables/useShortcutLayout'
import { useShortcutPagination } from './composables/useShortcutPagination'
import { useTopSitesMerge } from './composables/useTopSitesMerge'

const focusStore = useFocusState()
const settings = useSettingsStore()
const shortcutStore = useShortcutStore()

const { height } = useWindowSize({ type: 'visual' })

const props = defineProps<{
  onOpenAddDialog?: (groupId?: string) => void
  onOpenEditDialog?: (target: ShortcutTarget) => void
}>()

const refreshDebounced = useDebounceFn(refresh, 100)

const { topSites, shortcuts, mounted, topSitesNeedsReload } = useShortcutData(refreshDebounced)

type DisplayItem = ReturnType<typeof buildShortcutDisplayItems>[number] & {
  groupId?: string
}

type ShortcutPage = {
  key: string
  groupId: string
  pageInGroup: number
  totalPagesInGroup: number
  isTopSites: boolean
  items: DisplayItem[]
}

const topSitesGroupId = '__top-sites__'
const topSitesGroupName = i18next.t('newtab:shortcut.groups.topSites')

const userGroups = computed(() => {
  if (!settings.shortcut.grouping) return []
  return shortcutStore.groups
})

const visibleCategoryGroups = computed(() =>
  userGroups.value.filter(
    (group) => group.id !== DEFAULT_SHORTCUT_GROUP_ID || group.items.length > 0,
  ),
)
const draggableCategoryGroups = computed({
  get: () => visibleCategoryGroups.value,
  set: (groups: ShortcutGroup[]) => {
    void updateCategoryGroupOrder(groups)
  },
})

const legacyItems = computed(() => buildShortcutDisplayItems(shortcuts.value, topSites.value))

const { updateMaxCols, maxFitCols, maxFitRows } = usePagedGridLayout()
const slotsPerPage = computed(() => maxFitCols.value * maxFitRows.value)

function buildGroupItems(group: ShortcutGroup): DisplayItem[] {
  return group.items.map((item, index) => ({
    url: item.url,
    title: item.title,
    favicon: item.favicon,
    isPinned: true,
    originalIndex: index,
    groupId: group.id,
  }))
}

function splitIntoPages(
  groupId: string,
  items: DisplayItem[],
  isTopSites: boolean,
): ShortcutPage[] {
  const slots = Math.max(1, slotsPerPage.value)
  const totalPagesInGroup = Math.max(1, Math.ceil((items.length + (isTopSites ? 0 : 1)) / slots))
  return Array.from({ length: totalPagesInGroup }, (_, pageInGroup) => {
    const isLastPage = pageInGroup === totalPagesInGroup - 1
    const start = pageInGroup * slots
    const maxItems = isLastPage && !isTopSites ? slots - 1 : slots
    return {
      key: `${groupId}-${pageInGroup}`,
      groupId,
      pageInGroup,
      totalPagesInGroup,
      isTopSites,
      items: items.slice(start, start + maxItems),
    }
  })
}

const pages = computed<ShortcutPage[]>(() => {
  if (!settings.shortcut.grouping) {
    return splitIntoPages('legacy', legacyItems.value, false)
  }

  const hasShortcutItems = userGroups.value.some((group) => group.items.length > 0)
  const hasTopSitesItems = settings.shortcut.topSites && topSites.value.length > 0
  if (!hasShortcutItems && !hasTopSitesItems) {
    return splitIntoPages(DEFAULT_SHORTCUT_GROUP_ID, [], false)
  }

  const visibleGroups = userGroups.value.filter(
    (group) =>
      group.id !== DEFAULT_SHORTCUT_GROUP_ID ||
      group.items.length > 0 ||
      (!settings.shortcut.topSites && userGroups.value.length === 1),
  )
  const result = visibleGroups.flatMap((group) =>
    splitIntoPages(group.id, buildGroupItems(group), false),
  )
  if (hasTopSitesItems) {
    result.push(
      ...splitIntoPages(
        topSitesGroupId,
        topSites.value.map((item, index) => ({
          url: item.url,
          title: item.title || '',
          favicon: item.favicon,
          isPinned: false,
          originalIndex: index,
          groupId: topSitesGroupId,
        })),
        true,
      ),
    )
  }
  return result.length > 0 ? result : splitIntoPages(DEFAULT_SHORTCUT_GROUP_ID, [], false)
})

// 始终使用完整 pages 长度，以支持关闭翻页时也能切换分组
const paginationTotalItems = computed(() => pages.value.length)
const paginationItemsPerPage = ref(1)
const allowPageLoop = computed(() => settings.shortcut.pagingLoop)

// 分页逻辑
const {
  currentPage,
  totalPages,
  showPagination: rawShowPagination,
  isAnimating,
  slideDirection,
  noTransition,
  preloadTargetPage,
  prevPage,
  nextPage,
  goToPage,
  setupSwipe,
} = useShortcutPagination(paginationTotalItems, paginationItemsPerPage, allowPageLoop)

// 仅在翻页启用时才显示翻页 UI
const showPagination = computed(() => settings.shortcut.paging && rawShowPagination.value)

function getPage(pageIndex: number): ShortcutPage | null {
  return pages.value[pageIndex] ?? null
}

function showAddButtonForPage(pageIndex: number) {
  const page = getPage(pageIndex)
  if (!page || page.isTopSites) return false
  return page.pageInGroup === page.totalPagesInGroup - 1
}

function getDisplayItemKey(pageKey: string | undefined, item: DisplayItem) {
  return `${pageKey ?? 'unknown'}-${item.isPinned ? 'pin' : 'top'}-${item.originalIndex}-${item.url}`
}

// 当前页显示的项目
const currentPageData = computed(() => getPage(currentPage.value))
const currentPageItems = computed(() => currentPageData.value?.items ?? [])
const currentEditableGroup = computed(() => {
  const groupId = currentPageData.value?.groupId
  if (!groupId || groupId === topSitesGroupId || !settings.shortcut.grouping) return null
  return shortcutStore.groups.find((group) => group.id === groupId) ?? null
})
const currentDragItems = computed({
  get: () => {
    const sourceItems = settings.shortcut.grouping
      ? (currentEditableGroup.value?.items ?? [])
      : shortcuts.value
    return getCurrentDraggableIndexes(sourceItems).map((index) => sourceItems[index]!)
  },
  set: (items: Shortcut[]) => {
    const sourceItems = settings.shortcut.grouping
      ? (currentEditableGroup.value?.items ?? [])
      : shortcuts.value
    const indexes = getCurrentDraggableIndexes(sourceItems)
    const nextItems = sourceItems.slice()
    indexes.forEach((index, offset) => {
      const item = items[offset]
      if (item) nextItems[index] = item
    })

    if (!settings.shortcut.grouping) {
      shortcuts.value = nextItems
    } else if (currentEditableGroup.value) {
      currentEditableGroup.value.items = nextItems
    }
  },
})
const showAddButton = computed(() => showAddButtonForPage(currentPage.value))

function getCurrentDraggableIndexes(sourceItems: Shortcut[]): number[] {
  const indexes = currentPageItems.value
    .filter((item) => item.isPinned)
    .map((item) => item.originalIndex)
  return indexes.filter((index) => index >= 0 && index < sourceItems.length)
}

// 前一页的项目（用于预加载）
const prevPageData = computed(() => {
  // 如果有预加载目标页且向右跳（目标页 < 当前页），将目标页内容加载到 prev 位置
  if (preloadTargetPage.value !== null && slideDirection.value === 'right') {
    return getPage(preloadTargetPage.value)
  }
  return getPage(currentPage.value - 1)
})
const prevPageItems = computed(() => prevPageData.value?.items ?? [])

// 后一页的项目（用于预加载）
const nextPageData = computed(() => {
  // 如果有预加载目标页且向左跳（目标页 > 当前页），将目标页内容加载到 next 位置
  if (preloadTargetPage.value !== null && slideDirection.value === 'left') {
    return getPage(preloadTargetPage.value)
  }
  return getPage(currentPage.value + 1)
})
const nextPageItems = computed(() => nextPageData.value?.items ?? [])

// 前一页是否显示添加按钮（避免模板中重复计算）
const showPrevPageAddButton = computed(() => {
  const pageIndex =
    preloadTargetPage.value !== null && slideDirection.value === 'right'
      ? preloadTargetPage.value
      : currentPage.value - 1
  return showAddButtonForPage(pageIndex)
})

// 后一页是否显示添加按钮（避免模板中重复计算）
const showNextPageAddButton = computed(() => {
  const pageIndex =
    preloadTargetPage.value !== null && slideDirection.value === 'left'
      ? preloadTargetPage.value
      : currentPage.value + 1
  return showAddButtonForPage(pageIndex)
})

const currentGroupPages = computed(() => {
  const page = currentPageData.value
  if (!page) return []
  return pages.value.filter((item) => item.groupId === page.groupId)
})

const currentGroupPageIndex = computed(() => currentPageData.value?.pageInGroup ?? 0)

function goToGroupPage(pageInGroup: number) {
  const page = currentPageData.value
  if (!page) return
  const index = pages.value.findIndex(
    (item) => item.groupId === page.groupId && item.pageInGroup === pageInGroup,
  )
  if (index >= 0) goToPage(index)
}

// ---- 共享右键菜单 ----
const perf = usePerfClasses(() => ({
  transparent: settings.perf.shortcut.transparent,
  blur: settings.perf.shortcut.blur,
}))
const popperClass = perf('shortcut__menu-popper')
const navBtnPerfClass = perf('shortcut__nav-btn')

// 记录当前打开的右键菜单关闭函数，实现全局唯一
const openedMenuCloseFn = ref<(() => void) | null>(null)
provide(SHORTCUT_OPENED_MENU_CLOSE_FN, openedMenuCloseFn)

const ctxMenuRef = useTemplateRef<InstanceType<typeof ShortcutContextMenu>>('ctxMenuRef')
const groupSelectDialogRef =
  useTemplateRef<InstanceType<typeof ShortcutGroupSelectDialog>>('groupSelectDialogRef')
const { groupNameRefs, setGroupNameRef } = useGroupNameRefs()

function selectGroup(groupId: string) {
  const index = pages.value.findIndex((page) => page.groupId === groupId)
  if (index >= 0) goToPage(index)
}

function hasDefaultGroup() {
  return shortcutStore.groups.some((group) => group.id === DEFAULT_SHORTCUT_GROUP_ID)
}

async function createGroupInline() {
  const group = await shortcutStore.createGroup('')
  await refreshDebounced()
  selectGroup(group.id)
  nextTick(() => groupNameRefs.get(group.id)?.beginEdit())
}

async function updateCategoryGroupOrder(groups: ShortcutGroup[]) {
  const changed = await shortcutStore.reorderGroups(groups)
  if (!changed) return
  await refreshDebounced()
}

async function openAddShortcut() {
  const page = currentPageData.value
  if (page && !page.isTopSites && page.groupId !== topSitesGroupId) {
    props.onOpenAddDialog?.(page.groupId)
    return
  }

  const groupId = await groupSelectDialogRef.value?.open({
    title: i18next.t('newtab:shortcut.groups.selectAddTarget'),
  })
  if (groupId) props.onOpenAddDialog?.(groupId)
}

function openCtxMenu(event: MouseEvent | PointerEvent, item: DisplayItem): void {
  // 关闭上一个
  if (openedMenuCloseFn.value) {
    openedMenuCloseFn.value()
  }
  ctxMenuRef.value?.open(event, item)
  openedMenuCloseFn.value = () => ctxMenuRef.value?.close()
}

const { pinToGroup, moveToGroup, renameGroup, confirmDeleteGroup } = useShortcutGroupActions({
  groupSelectDialogRef,
  refresh: refreshDebounced,
  t: (key, options) => i18next.t(`newtab:${key}`, options),
  afterDelete: () => selectGroup(shortcutStore.groups[0]?.id ?? DEFAULT_SHORTCUT_GROUP_ID),
})

// 切换页面时重置并关闭已打开的菜单
watch(
  () => currentPage.value,
  () => {
    if (openedMenuCloseFn.value) {
      openedMenuCloseFn.value()
      openedMenuCloseFn.value = null
    }
  },
)

// 网格解算
const grid = computed(() => {
  if (pages.value.length > 1) {
    return { cols: maxFitCols.value, rows: maxFitRows.value }
  }
  const currentCount = currentPageItems.value.length
  // 单页 → 根据内容收缩
  return solveGridColumnFirst(
    showAddButtonForPage(currentPage.value) ? currentCount + 1 : currentCount,
    maxFitCols.value,
    maxFitRows.value,
  )
})

const displayColumns = computed(() => grid.value.cols)
const displayRows = computed(() => grid.value.rows)

const shortcutContainerRef = useTemplateRef('shortcutContainerRef')
const prevPageContainerRef = useTemplateRef('prevPageContainerRef')
const currentPageContainerRef = useTemplateRef('currentPageContainerRef')
const nextPageContainerRef = useTemplateRef('nextPageContainerRef')
let refreshTask: Promise<void> | null = null

async function refresh() {
  if (refreshTask) return refreshTask

  refreshTask = (async () => {
    // 刷新时重置打开的菜单，防止布局或数据变化导致索引失效
    if (openedMenuCloseFn.value) {
      openedMenuCloseFn.value()
      openedMenuCloseFn.value = null
    }

    if (settings.shortcut.grouping && !hasDefaultGroup()) {
      await shortcutStore.enableGroupingFromItems()
    }

    shortcuts.value = shortcutStore.items.slice()

    // 合并最常访问
    if (settings.shortcut.topSites) {
      topSites.value = await useTopSitesMerge({
        shortcuts: settings.shortcut.grouping ? [] : shortcuts.value,
        columns: displayColumns.value,
        maxRows: displayRows.value,
        force: topSitesNeedsReload.value,
        noCap: true, // 不截断，获取所有可用的 top sites
      })
      topSitesNeedsReload.value = false
    } else {
      topSites.value = []
    }

    // 首次刷新完成后设置 mounted 标志
    if (!mounted.value) {
      mounted.value = true
    }
  })()

  try {
    await refreshTask
  } finally {
    refreshTask = null
  }
}

const isDragging = ref(false)
let pendingShortcutOrderSave = false
let shortcutOrderSaveTimer: ReturnType<typeof setTimeout> | undefined

async function flushShortcutOrderSave() {
  if (shortcutOrderSaveTimer) {
    clearTimeout(shortcutOrderSaveTimer)
    shortcutOrderSaveTimer = undefined
  }
  if (!pendingShortcutOrderSave) return
  pendingShortcutOrderSave = false
  await shortcutStore.save()
  await refreshDebounced()
}

function scheduleShortcutOrderSave() {
  pendingShortcutOrderSave = true
  if (shortcutOrderSaveTimer) clearTimeout(shortcutOrderSaveTimer)
  shortcutOrderSaveTimer = setTimeout(() => {
    void flushShortcutOrderSave()
  }, 150)
}

useDraggable(currentPageContainerRef, currentDragItems, {
  animation: 150,
  delayOnTouchOnly: true,
  touchStartThreshold: 10,
  delay: 100,
  handle: '.shortcut__item.pined',
  onStart() {
    isDragging.value = true
  },
  onEnd() {
    isDragging.value = false
    void flushShortcutOrderSave()
  },
  onUpdate() {
    const group = currentEditableGroup.value
    if (!settings.shortcut.grouping) {
      shortcutStore.items = shortcuts.value
      scheduleShortcutOrderSave()
      return
    }
    if (!group) return
    scheduleShortcutOrderSave()
  },
})

// 设置滑动手势支持（绑定到 slide-viewport，以便切换时能切换 overflow）
setupSwipe(
  shortcutContainerRef,
  prevPageContainerRef,
  currentPageContainerRef,
  nextPageContainerRef,
  isDragging,
  computed(() => settings.shortcut.paging),
)

// 开始拖拽时关闭已打开的菜单
watch(isDragging, (dragging) => {
  if (dragging && openedMenuCloseFn.value) {
    openedMenuCloseFn.value()
    openedMenuCloseFn.value = null
  }
})

useEventListener(
  currentPageContainerRef,
  'wheel',
  (evt: WheelEvent) => {
    if (isDragging.value || !settings.shortcut.paging) return
    if (evt.deltaY < 0 || evt.deltaX < 0) {
      // 向上滚动，上一页
      prevPage()
    } else if (evt.deltaY > 0 || evt.deltaX > 0) {
      // 向下滚动，下一页
      nextPage()
    }
  },
  { passive: true },
)

// useResizeObserver 会在开始观察时立即触发一次，因此不需要额外的 onMounted 刷新调用
useResizeObserver(document.documentElement, async () => {
  updateMaxCols()
  await refreshDebounced()
})

watch(
  () => [
    settings.shortcut.layout.columns,
    settings.shortcut.layout.rows,
    settings.shortcut.iconSize,
    settings.shortcut.spacing.itemGapX,
    settings.shortcut.spacing.itemGapY,
    settings.shortcut.paging,
  ],
  async () => {
    updateMaxCols()
    await refreshDebounced()
  },
)

watch(
  () => settings.shortcut.paging,
  (pagingEnabled) => {
    if (!pagingEnabled) {
      // 关闭翻页时，重置到当前分组的首页，避免停留在组内中间页
      const currentGroupId = currentPageData.value?.groupId
      if (currentGroupId) {
        const firstIdx = pages.value.findIndex((p) => p.groupId === currentGroupId)
        if (firstIdx >= 0 && firstIdx !== currentPage.value) {
          noTransition.value = true
          currentPage.value = firstIdx
          nextTick(() => {
            noTransition.value = false
          })
        }
      }
    }
  },
)

watch(isOnlyTouchDevice, updateMaxCols)

watch(
  () => settings.shortcut.topSites,
  (enabled) => {
    if (enabled) {
      topSitesNeedsReload.value = true
    }
    refreshDebounced()
  },
)

watch(
  () => settings.shortcut.grouping,
  async (enabled) => {
    if (enabled) {
      await shortcutStore.enableGroupingFromItems()
    } else {
      await shortcutStore.disableGroupingToItems()
    }
    await refreshDebounced()
  },
)

const isHideShortcut = computed(() => {
  if (!mounted.value) {
    return '0'
  }

  if (!focusStore.isFocused) {
    return '1'
  }

  return settings.shortcut.showOnSearchFocus ? '1' : '0'
})

// 提取容器通用class（避免模板中重复）
const containerBaseClasses = computed(() => [
  settings.shortcut.style.shadow ? 'shortcut__container--item-shadow' : undefined,
  settings.shortcut.title.whiteInLightMode ? 'shortcut__container--white-in-light' : undefined,
])

// 容器动画class
const containerAnimationClasses = computed(() => ({
  'shortcut__container--slide-left': slideDirection.value === 'left',
  'shortcut__container--slide-right': slideDirection.value === 'right',
  'shortcut__container--no-transition': noTransition.value,
}))

// 容器通用style
const containerGridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${displayColumns.value}, 1fr)`,
  gridTemplateRows: `repeat(${displayRows.value}, 1fr)`,
  gridGap: `${settings.shortcut.spacing.itemGapY}px ${settings.shortcut.spacing.itemGapX}px`,
  '--icon_size': `${settings.shortcut.iconSize}px`,
  '--icon_ratio': `${settings.shortcut.iconRatio}`,
}))

const categoryPerf = usePerfClasses(() => ({
  transparent: settings.perf.shortcut.transparent,
  blur: settings.perf.shortcut.blur,
}))

const categoryClass = categoryPerf('shortcut__category')
</script>

<template>
  <section
    class="shortcut"
    :style="{
      opacity: isHideShortcut,
      // paddingTop: `${settings.shortcut.marginTop / 2}px`,
      marginTop: height > 500 ? `${settings.shortcut.marginTop / 2}px` : undefined,
    }"
  >
    <div ref="shortcutWrapperRef" class="shortcut__wrapper" :class="containerBaseClasses">
      <el-space v-if="settings.shortcut.grouping" class="noselect" :class="categoryClass">
        <vue-draggable
          v-model="draggableCategoryGroups"
          class="shortcut__category-groups"
          :animation="150"
        >
          <shortcut-group-name
            v-for="group in draggableCategoryGroups"
            :key="group.id"
            :ref="(el) => setGroupNameRef(group.id, el)"
            :name="group.name"
            :active="currentPageData?.groupId === group.id"
            editable
            @select="selectGroup(group.id)"
            @rename="(name) => renameGroup(group.id, name)"
            @contextmenu.prevent="confirmDeleteGroup(group)"
          />
        </vue-draggable>
        <button
          v-if="settings.shortcut.topSites"
          type="button"
          class="shortcut__category-item"
          :class="{
            'shortcut__category-item--active': currentPageData?.groupId === topSitesGroupId,
          }"
          @click="selectGroup(topSitesGroupId)"
        >
          {{ topSitesGroupName }}
        </button>
        <button type="button" class="shortcut__category-item" @click="createGroupInline">
          <el-icon><PlusIcon /></el-icon>
        </button>
      </el-space>
      <div class="shortcut__wrapper-inner">
        <!-- 左翻页按钮 -->
        <button
          v-if="showPagination && !isOnlyTouchDevice"
          class="shortcut__nav-btn--prev"
          :class="[
            {
              'shortcut__nav-btn--disabled': isAnimating || (!allowPageLoop && currentPage === 0),
            },
            navBtnPerfClass,
          ]"
          :disabled="isAnimating || (!allowPageLoop && currentPage === 0)"
          @click="prevPage"
        >
          <el-icon :size="20">
            <chevron-left20-filled />
          </el-icon>
        </button>
        <div style="overflow: hidden">
          <!-- 滑动轨道容器 -->
          <div ref="shortcutContainerRef" class="shortcut__slide-viewport">
            <div class="shortcut__slide-track">
              <!-- 前一页 -->
              <div
                v-if="currentPage > 0 || preloadTargetPage !== null"
                ref="prevPageContainerRef"
                class="shortcut__container shortcut__container--page shortcut__container--prev"
                :class="containerAnimationClasses"
                :style="containerGridStyle"
              >
                <shortcut-item
                  v-for="item in prevPageItems"
                  :key="getDisplayItemKey(prevPageData?.key, item)"
                  v-memo="[item.url, item.title, item.favicon, item.isPinned]"
                  :url="item.url"
                  :title="item.title"
                  :favicon="item.favicon"
                  :pined="item.isPinned"
                  :on-context-menu="(e) => openCtxMenu(e, item)"
                />
                <add-shortcut
                  v-if="showPrevPageAddButton"
                  :key="`${prevPageData?.key ?? 'prev'}-add`"
                  :show-button="true"
                  :tabindex="false"
                  :on-open="openAddShortcut"
                />
              </div>
              <!-- 前一页占位（当没有前一页时） -->
              <div
                v-else
                class="shortcut__container shortcut__container--page shortcut__container--prev shortcut__container--placeholder"
              ></div>

              <!-- 当前页 -->
              <div
                ref="currentPageContainerRef"
                class="shortcut__container shortcut__container--page shortcut__container--current"
                :class="[...containerBaseClasses, containerAnimationClasses]"
                :style="{
                  pointerEvents:
                    settings.shortcut.showOnSearchFocus || !focusStore.isFocused ? 'auto' : 'none',
                  ...containerGridStyle,
                }"
              >
                <shortcut-item
                  v-for="item in currentPageItems"
                  :key="getDisplayItemKey(currentPageData?.key, item)"
                  v-memo="[item.url, item.title, item.favicon, item.isPinned]"
                  :url="item.url"
                  :title="item.title"
                  :favicon="item.favicon"
                  :pined="item.isPinned"
                  :on-context-menu="(e) => openCtxMenu(e, item)"
                  :tabindex="focusStore.isFocused ? -1 : 0"
                />

                <!-- 添加快捷方式按钮（始终在最后一页最后一格） -->
                <add-shortcut
                  :key="`${currentPageData?.key ?? 'current'}-add`"
                  :show-button="showAddButton"
                  :on-open="openAddShortcut"
                />
              </div>

              <!-- 后一页 -->
              <div
                v-if="currentPage < totalPages - 1 || preloadTargetPage !== null"
                ref="nextPageContainerRef"
                class="shortcut__container shortcut__container--page shortcut__container--next"
                :class="[...containerBaseClasses, containerAnimationClasses]"
                :style="containerGridStyle"
              >
                <shortcut-item
                  v-for="item in nextPageItems"
                  :key="getDisplayItemKey(nextPageData?.key, item)"
                  v-memo="[item.url, item.title, item.favicon, item.isPinned]"
                  :url="item.url"
                  :title="item.title"
                  :favicon="item.favicon"
                  :pined="item.isPinned"
                  :on-context-menu="(e) => openCtxMenu(e, item)"
                />
                <add-shortcut
                  v-if="showNextPageAddButton"
                  :key="`${nextPageData?.key ?? 'next'}-add`"
                  :show-button="true"
                  :tabindex="false"
                  :on-open="openAddShortcut"
                />
              </div>
              <!-- 后一页占位（当没有后一页时） -->
              <div
                v-else
                class="shortcut__container shortcut__container--page shortcut__container--next shortcut__container--placeholder"
              ></div>
            </div>
          </div>
        </div>
        <!-- 右翻页按钮 -->
        <button
          v-if="showPagination && !isOnlyTouchDevice"
          class="shortcut__nav-btn--next"
          :class="[
            {
              'shortcut__nav-btn--disabled':
                isAnimating || (!allowPageLoop && currentPage === totalPages - 1),
            },
            navBtnPerfClass,
          ]"
          :disabled="isAnimating || (!allowPageLoop && currentPage === totalPages - 1)"
          @click="nextPage"
        >
          <el-icon :size="20">
            <chevron-right20-filled />
          </el-icon>
        </button>
      </div>

      <!-- 页数指示器 -->
      <shortcut-pagination-dots
        :current-page="currentGroupPageIndex"
        :total-pages="showPagination ? currentGroupPages.length : 1"
        @goto="goToGroupPage"
      />
    </div>

    <!-- 共享右键菜单 -->
    <shortcut-context-menu
      ref="ctxMenuRef"
      :refresh-fn="refreshDebounced"
      :on-open-edit-dialog="props.onOpenEditDialog"
      :on-pin="pinToGroup"
      :on-move="moveToGroup"
      :popper-class="popperClass"
      show-edit
      show-move
    />
    <shortcut-group-select-dialog ref="groupSelectDialogRef" />
  </section>
</template>
