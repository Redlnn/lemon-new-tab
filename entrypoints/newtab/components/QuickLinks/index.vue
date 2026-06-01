<script setup lang="ts">
import { useDebounceFn, useEventListener, useResizeObserver, useWindowSize } from '@vueuse/core'

import i18next from 'i18next'
import { VueDraggable, useDraggable } from 'vue-draggable-plus'
import PlusIcon from '~icons/fa6-solid/plus'
import ChevronLeft20Filled from '~icons/fluent/chevron-left-20-filled'
import ChevronRight20Filled from '~icons/fluent/chevron-right-20-filled'

import {
  DEFAULT_QUICK_LINK_GROUP_ID,
  useQuickLinksStore,
  type QuickLink,
  type QuickLinkGroup,
  type QuickLinkTarget,
} from '@/shared/quickLinks'
import { useSettingsStore } from '@/shared/settings'

import { useFocusState } from '@newtab/composables/useFocus'
import usePerfClasses from '@newtab/composables/usePerfClasses'
import { QUICK_LINK_OPENED_MENU_CLOSE_FN } from '@newtab/shared/keys'
import { isOnlyTouchDevice } from '@newtab/shared/touch'

import AddQuickLink from './components/AddQuickLink.vue'
import QuickLinkContextMenu from './components/QuickLinkContextMenu.vue'
import QuickLinkGroupName from './components/QuickLinkGroupName.vue'
import QuickLinkGroupSelectDialog from './components/QuickLinkGroupSelectDialog.vue'
import QuickLinkItem from './components/QuickLinkItem.vue'
import QuickLinksPaginationDots from './components/QuickLinksPaginationDots.vue'
import { buildQuickLinkDisplayItems } from './composables/quickLinkDisplayItems'
import { useGroupNameRefs } from './composables/useGroupNameRefs'
import { useQuickLinkGroupActions } from './composables/useQuickLinkGroupActions'
import { useQuickLinksData } from './composables/useQuickLinksData'
import { solveGridColumnFirst, usePagedGridLayout } from './composables/useQuickLinksLayout'
import { useQuickLinksPagination } from './composables/useQuickLinksPagination'
import { useTopSitesMerge } from './composables/useTopSitesMerge'

const focusStore = useFocusState()
const settings = useSettingsStore()
const quickLinksStore = useQuickLinksStore()

const { height } = useWindowSize({ type: 'visual' })

const props = defineProps<{
  onOpenAddDialog?: (groupId?: string) => void
  onOpenEditDialog?: (target: QuickLinkTarget) => void
}>()

const refreshDebounced = useDebounceFn(refresh, 100)

const { topSites, quickLinks, mounted, topSitesNeedsReload } = useQuickLinksData(refreshDebounced)

type DisplayItem = ReturnType<typeof buildQuickLinkDisplayItems>[number] & {
  groupId?: string
}

type QuickLinkPage = {
  key: string
  groupId: string
  pageInGroup: number
  totalPagesInGroup: number
  isTopSites: boolean
  items: DisplayItem[]
}

type ScrollSection = {
  key: string
  title?: string
  groupId?: string
  isTopSites: boolean
  items: DisplayItem[]
}

const topSitesGroupId = '__top-sites__'
const topSitesGroupName = i18next.t('newtab:quickLinks.groups.topSites')

const userGroups = computed(() => {
  if (!settings.quickLinks.grouping) return []
  return quickLinksStore.groups
})

const visibleCategoryGroups = computed(() =>
  userGroups.value.filter(
    (group) => group.id !== DEFAULT_QUICK_LINK_GROUP_ID || group.items.length > 0,
  ),
)
const draggableCategoryGroups = computed({
  get: () => visibleCategoryGroups.value,
  set: (groups: QuickLinkGroup[]) => {
    void updateCategoryGroupOrder(groups)
  },
})

const legacyItems = computed(() => buildQuickLinkDisplayItems(quickLinks.value, topSites.value))

const { updateMaxCols, maxFitCols, maxFitRows } = usePagedGridLayout()
const slotsPerPage = computed(() => maxFitCols.value * maxFitRows.value)

function buildGroupItems(group: QuickLinkGroup): DisplayItem[] {
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
): QuickLinkPage[] {
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

const pages = computed<QuickLinkPage[]>(() => {
  if (!settings.quickLinks.grouping) {
    return splitIntoPages('legacy', legacyItems.value, false)
  }

  const hasQuickLinkItems = userGroups.value.some((group) => group.items.length > 0)
  const hasTopSitesItems = settings.quickLinks.topSites && topSites.value.length > 0
  if (!hasQuickLinkItems && !hasTopSitesItems) {
    return splitIntoPages(DEFAULT_QUICK_LINK_GROUP_ID, [], false)
  }

  const visibleGroups = userGroups.value.filter(
    (group) =>
      group.id !== DEFAULT_QUICK_LINK_GROUP_ID ||
      group.items.length > 0 ||
      (!settings.quickLinks.topSites && userGroups.value.length === 1),
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
  return result.length > 0 ? result : splitIntoPages(DEFAULT_QUICK_LINK_GROUP_ID, [], false)
})

const scrollSections = computed<ScrollSection[]>(() => {
  if (!settings.quickLinks.grouping) {
    return [
      {
        key: 'quick-links',
        isTopSites: false,
        items: legacyItems.value,
      },
    ]
  }

  const sections: ScrollSection[] = visibleCategoryGroups.value.map((group) => ({
    key: group.id,
    title: group.name,
    groupId: group.id,
    isTopSites: false,
    items: buildGroupItems(group),
  }))

  if (settings.quickLinks.topSites && topSites.value.length > 0) {
    sections.push({
      key: topSitesGroupId,
      title: topSitesGroupName,
      groupId: topSitesGroupId,
      isTopSites: true,
      items: topSites.value.map((item, index) => ({
        url: item.url,
        title: item.title || '',
        favicon: item.favicon,
        isPinned: false,
        originalIndex: index,
        groupId: topSitesGroupId,
      })),
    })
  }

  return sections.length > 0
    ? sections
    : [
        {
          key: DEFAULT_QUICK_LINK_GROUP_ID,
          title: quickLinksStore.groups[0]?.name,
          groupId: DEFAULT_QUICK_LINK_GROUP_ID,
          isTopSites: false,
          items: [],
        },
      ]
})

// 始终使用完整 pages 长度，以支持关闭翻页时也能切换分组
const paginationTotalItems = computed(() => pages.value.length)
const paginationItemsPerPage = ref(1)
const allowPageLoop = computed(() => settings.quickLinks.pagingLoop)

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
} = useQuickLinksPagination(paginationTotalItems, paginationItemsPerPage, allowPageLoop)

// 仅在翻页启用时才显示翻页 UI
const showPagination = computed(
  () => !settings.quickLinks.useScroll && settings.quickLinks.paging && rawShowPagination.value,
)

function getPage(pageIndex: number): QuickLinkPage | null {
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
  if (!groupId || groupId === topSitesGroupId || !settings.quickLinks.grouping) return null
  return quickLinksStore.groups.find((group) => group.id === groupId) ?? null
})
const currentDragItems = computed({
  get: () => {
    const sourceItems = settings.quickLinks.grouping
      ? (currentEditableGroup.value?.items ?? [])
      : quickLinks.value
    return getCurrentDraggableIndexes(sourceItems).map((index) => sourceItems[index]!)
  },
  set: (items: QuickLink[]) => {
    const sourceItems = settings.quickLinks.grouping
      ? (currentEditableGroup.value?.items ?? [])
      : quickLinks.value
    const indexes = getCurrentDraggableIndexes(sourceItems)
    const nextItems = sourceItems.slice()
    indexes.forEach((index, offset) => {
      const item = items[offset]
      if (item) nextItems[index] = item
    })

    if (!settings.quickLinks.grouping) {
      quickLinks.value = nextItems
    } else if (currentEditableGroup.value) {
      currentEditableGroup.value.items = nextItems
    }
  },
})
const showAddButton = computed(() => showAddButtonForPage(currentPage.value))

function getCurrentDraggableIndexes(sourceItems: QuickLink[]): number[] {
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
  transparent: settings.perf.quickLinks.transparent,
  blur: settings.perf.quickLinks.blur,
}))
const popperClass = perf('quick-links__menu-popper')
const navBtnPerfClass = perf('quick-links__nav-btn')

// 记录当前打开的右键菜单关闭函数，实现全局唯一
const openedMenuCloseFn = ref<(() => void) | null>(null)
provide(QUICK_LINK_OPENED_MENU_CLOSE_FN, openedMenuCloseFn)

const ctxMenuRef = useTemplateRef<InstanceType<typeof QuickLinkContextMenu>>('ctxMenuRef')
const groupSelectDialogRef =
  useTemplateRef<InstanceType<typeof QuickLinkGroupSelectDialog>>('groupSelectDialogRef')
const { groupNameRefs, setGroupNameRef } = useGroupNameRefs()

function selectGroup(groupId: string) {
  const index = pages.value.findIndex((page) => page.groupId === groupId)
  if (index >= 0) goToPage(index)
}

function hasDefaultGroup() {
  return quickLinksStore.groups.some((group) => group.id === DEFAULT_QUICK_LINK_GROUP_ID)
}

async function createGroupInline() {
  const group = await quickLinksStore.createGroup('')
  await refreshDebounced()
  selectGroup(group.id)
  nextTick(() => groupNameRefs.get(group.id)?.beginEdit())
}

async function updateCategoryGroupOrder(groups: QuickLinkGroup[]) {
  const changed = await quickLinksStore.reorderGroups(groups)
  if (!changed) return
  await refreshDebounced()
}

async function openAddQuickLink() {
  if (!settings.quickLinks.grouping) {
    props.onOpenAddDialog?.()
    return
  }

  const page = currentPageData.value
  if (page && !page.isTopSites && page.groupId !== topSitesGroupId) {
    props.onOpenAddDialog?.(page.groupId)
    return
  }

  const groupId = await groupSelectDialogRef.value?.open({
    title: i18next.t('newtab:quickLinks.groups.selectAddTarget'),
  })
  if (groupId) props.onOpenAddDialog?.(groupId)
}

function openAddQuickLinkForSection(section: ScrollSection) {
  if (!settings.quickLinks.grouping) {
    props.onOpenAddDialog?.()
    return
  }
  props.onOpenAddDialog?.(section.groupId ?? DEFAULT_QUICK_LINK_GROUP_ID)
}

function openCtxMenu(event: MouseEvent | PointerEvent, item: DisplayItem): void {
  // 关闭上一个
  if (openedMenuCloseFn.value) {
    openedMenuCloseFn.value()
  }
  ctxMenuRef.value?.open(event, item)
  openedMenuCloseFn.value = () => ctxMenuRef.value?.close()
}

const { pinToGroup, moveToGroup, renameGroup, confirmDeleteGroup } = useQuickLinkGroupActions({
  groupSelectDialogRef,
  refresh: refreshDebounced,
  t: (key, options) => i18next.t(`newtab:${key}`, options),
  afterDelete: () => selectGroup(quickLinksStore.groups[0]?.id ?? DEFAULT_QUICK_LINK_GROUP_ID),
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

const quickLinksContainerRef = useTemplateRef('quickLinksContainerRef')
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

    if (settings.quickLinks.grouping && !hasDefaultGroup()) {
      await quickLinksStore.enableGroupingFromItems()
    }

    quickLinks.value = quickLinksStore.items.slice()

    // 合并最常访问
    if (settings.quickLinks.topSites) {
      topSites.value = await useTopSitesMerge({
        quickLinks: settings.quickLinks.grouping ? [] : quickLinks.value,
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
let pendingQuickLinkOrderSave = false
let quickLinksOrderSaveTimer: ReturnType<typeof setTimeout> | undefined

async function flushQuickLinkOrderSave() {
  if (quickLinksOrderSaveTimer) {
    clearTimeout(quickLinksOrderSaveTimer)
    quickLinksOrderSaveTimer = undefined
  }
  if (!pendingQuickLinkOrderSave) return
  pendingQuickLinkOrderSave = false
  await quickLinksStore.save()
  await refreshDebounced()
}

function scheduleQuickLinkOrderSave() {
  pendingQuickLinkOrderSave = true
  if (quickLinksOrderSaveTimer) clearTimeout(quickLinksOrderSaveTimer)
  quickLinksOrderSaveTimer = setTimeout(() => {
    void flushQuickLinkOrderSave()
  }, 150)
}

const currentPageDraggable = useDraggable(currentPageContainerRef, currentDragItems, {
  immediate: false,
  animation: 150,
  delayOnTouchOnly: true,
  touchStartThreshold: 10,
  delay: 100,
  handle: '.quick-links__item.pined',
  onStart() {
    isDragging.value = true
  },
  onEnd() {
    isDragging.value = false
    void flushQuickLinkOrderSave()
  },
  onUpdate() {
    const group = currentEditableGroup.value
    if (!settings.quickLinks.grouping) {
      quickLinksStore.items = quickLinks.value
      scheduleQuickLinkOrderSave()
      return
    }
    if (!group) return
    scheduleQuickLinkOrderSave()
  },
})

watch(
  [() => settings.quickLinks.useScroll, currentPageContainerRef],
  ([useScroll]) => {
    currentPageDraggable.destroy()
    if (useScroll || !currentPageContainerRef.value) return
    currentPageDraggable.start(currentPageContainerRef.value)
  },
  { immediate: true, flush: 'post' },
)

// 设置滑动手势支持（绑定到 slide-viewport，以便切换时能切换 overflow）
setupSwipe(
  quickLinksContainerRef,
  prevPageContainerRef,
  currentPageContainerRef,
  nextPageContainerRef,
  isDragging,
  computed(() => settings.quickLinks.paging && !settings.quickLinks.useScroll),
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
    if (isDragging.value || settings.quickLinks.useScroll || !settings.quickLinks.paging) return
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
    settings.quickLinks.layout.columns,
    settings.quickLinks.layout.rows,
    settings.quickLinks.iconSize,
    settings.quickLinks.spacing.itemGapX,
    settings.quickLinks.spacing.itemGapY,
    settings.quickLinks.paging,
    settings.quickLinks.useScroll,
  ],
  async () => {
    updateMaxCols()
    await refreshDebounced()
  },
)

watch(
  () => settings.quickLinks.useScroll,
  (enabled) => {
    if (!enabled) return
    noTransition.value = true
    currentPage.value = 0
    nextTick(() => {
      noTransition.value = false
    })
  },
)

watch(
  () => settings.quickLinks.paging,
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
  () => settings.quickLinks.topSites,
  (enabled) => {
    if (enabled) {
      topSitesNeedsReload.value = true
    }
    refreshDebounced()
  },
)

watch(
  () => settings.quickLinks.grouping,
  async (enabled) => {
    if (enabled) {
      await quickLinksStore.enableGroupingFromItems()
    } else {
      await quickLinksStore.disableGroupingToItems()
    }
    await refreshDebounced()
  },
)

const isHideQuickLink = computed(() => {
  if (!mounted.value) {
    return '0'
  }

  if (!focusStore.isFocused) {
    return '1'
  }

  return settings.quickLinks.showOnSearchFocus ? '1' : '0'
})

// 提取容器通用class（避免模板中重复）
const containerBaseClasses = computed(() => [
  settings.quickLinks.style.shadow ? 'quick-links__container--item-shadow' : undefined,
  settings.quickLinks.title.whiteInLightMode ? 'quick-links__container--white-in-light' : undefined,
])

// 容器动画class
const containerAnimationClasses = computed(() => ({
  'quick-links__container--slide-left': slideDirection.value === 'left',
  'quick-links__container--slide-right': slideDirection.value === 'right',
  'quick-links__container--no-transition': noTransition.value,
}))

// 容器通用style
const containerGridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${displayColumns.value}, 1fr)`,
  gridTemplateRows: `repeat(${displayRows.value}, 1fr)`,
  gridGap: `${settings.quickLinks.spacing.itemGapY}px ${settings.quickLinks.spacing.itemGapX}px`,
  '--icon_size': `${settings.quickLinks.iconSize}px`,
  '--icon_ratio': `${settings.quickLinks.iconRatio}`,
}))

const scrollGridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${displayColumns.value}, 1fr)`,
  gridGap: `${settings.quickLinks.spacing.itemGapY}px ${settings.quickLinks.spacing.itemGapX}px`,
  '--icon_size': `${settings.quickLinks.iconSize}px`,
  '--icon_ratio': `${settings.quickLinks.iconRatio}`,
}))

const categoryPerf = usePerfClasses(() => ({
  transparent: settings.perf.quickLinks.transparent,
  blur: settings.perf.quickLinks.blur,
}))

const categoryClass = categoryPerf('quick-links__category')

defineExpose({ refresh })
</script>

<template>
  <section
    class="quick-links"
    :class="{ 'quick-links--scroll': settings.quickLinks.useScroll }"
    :style="{
      opacity: isHideQuickLink,
      // paddingTop: `${settings.quickLinks.marginTop / 2}px`,
      marginTop: height > 500 ? `${settings.quickLinks.marginTop / 2}px` : undefined,
    }"
  >
    <div ref="quickLinksWrapperRef" class="quick-links__wrapper" :class="containerBaseClasses">
      <div v-if="settings.quickLinks.useScroll" class="quick-links__scroll">
        <section
          v-for="section in scrollSections"
          :key="section.key"
          class="quick-links__scroll-section"
        >
          <h2 v-if="section.title" class="quick-links__scroll-title">{{ section.title }}</h2>
          <div
            class="quick-links__container quick-links__scroll-grid"
            :class="containerBaseClasses"
            :style="scrollGridStyle"
          >
            <quick-link-item
              v-for="item in section.items"
              :key="getDisplayItemKey(section.key, item)"
              :url="item.url"
              :title="item.title"
              :favicon="item.favicon"
              :pined="item.isPinned"
              :on-context-menu="(e) => openCtxMenu(e, item)"
              :tabindex="focusStore.isFocused ? -1 : 0"
            />
            <add-quick-link
              v-if="!section.isTopSites"
              :show-button="true"
              :on-open="() => openAddQuickLinkForSection(section)"
            />
          </div>
        </section>
      </div>
      <el-space
        v-if="!settings.quickLinks.useScroll && settings.quickLinks.grouping"
        class="noselect"
        :class="categoryClass"
      >
        <vue-draggable
          v-model="draggableCategoryGroups"
          class="quick-links__category-groups"
          :animation="150"
        >
          <quick-link-group-name
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
          v-if="settings.quickLinks.topSites"
          type="button"
          class="quick-links__category-item"
          :class="{
            'quick-links__category-item--active': currentPageData?.groupId === topSitesGroupId,
          }"
          @click="selectGroup(topSitesGroupId)"
        >
          {{ topSitesGroupName }}
        </button>
        <button type="button" class="quick-links__category-item" @click="createGroupInline">
          <el-icon><PlusIcon /></el-icon>
        </button>
      </el-space>
      <div v-if="!settings.quickLinks.useScroll" class="quick-links__wrapper-inner">
        <!-- 左翻页按钮 -->
        <button
          v-if="showPagination && !isOnlyTouchDevice"
          class="quick-links__nav-btn--prev"
          :class="[
            {
              'quick-links__nav-btn--disabled':
                isAnimating || (!allowPageLoop && currentPage === 0),
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
          <div ref="quickLinksContainerRef" class="quick-links__slide-viewport">
            <div class="quick-links__slide-track">
              <!-- 前一页 -->
              <div
                v-if="currentPage > 0 || preloadTargetPage !== null"
                ref="prevPageContainerRef"
                class="quick-links__container quick-links__container--page quick-links__container--prev"
                :class="containerAnimationClasses"
                :style="containerGridStyle"
              >
                <quick-link-item
                  v-for="item in prevPageItems"
                  :key="getDisplayItemKey(prevPageData?.key, item)"
                  v-memo="[item.url, item.title, item.favicon, item.isPinned]"
                  :url="item.url"
                  :title="item.title"
                  :favicon="item.favicon"
                  :pined="item.isPinned"
                  :on-context-menu="(e) => openCtxMenu(e, item)"
                />
                <add-quick-link
                  v-if="showPrevPageAddButton"
                  :key="`${prevPageData?.key ?? 'prev'}-add`"
                  :show-button="true"
                  :tabindex="false"
                  :on-open="openAddQuickLink"
                />
              </div>
              <!-- 前一页占位（当没有前一页时） -->
              <div
                v-else
                class="quick-links__container quick-links__container--page quick-links__container--prev quick-links__container--placeholder"
              ></div>

              <!-- 当前页 -->
              <div
                ref="currentPageContainerRef"
                class="quick-links__container quick-links__container--page quick-links__container--current"
                :class="[...containerBaseClasses, containerAnimationClasses]"
                :style="{
                  pointerEvents:
                    settings.quickLinks.showOnSearchFocus || !focusStore.isFocused
                      ? 'auto'
                      : 'none',
                  ...containerGridStyle,
                }"
              >
                <quick-link-item
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

                <!-- 添加链接按钮（始终在最后一页最后一格） -->
                <add-quick-link
                  :key="`${currentPageData?.key ?? 'current'}-add`"
                  :show-button="showAddButton"
                  :on-open="openAddQuickLink"
                />
              </div>

              <!-- 后一页 -->
              <div
                v-if="currentPage < totalPages - 1 || preloadTargetPage !== null"
                ref="nextPageContainerRef"
                class="quick-links__container quick-links__container--page quick-links__container--next"
                :class="[...containerBaseClasses, containerAnimationClasses]"
                :style="containerGridStyle"
              >
                <quick-link-item
                  v-for="item in nextPageItems"
                  :key="getDisplayItemKey(nextPageData?.key, item)"
                  v-memo="[item.url, item.title, item.favicon, item.isPinned]"
                  :url="item.url"
                  :title="item.title"
                  :favicon="item.favicon"
                  :pined="item.isPinned"
                  :on-context-menu="(e) => openCtxMenu(e, item)"
                />
                <add-quick-link
                  v-if="showNextPageAddButton"
                  :key="`${nextPageData?.key ?? 'next'}-add`"
                  :show-button="true"
                  :tabindex="false"
                  :on-open="openAddQuickLink"
                />
              </div>
              <!-- 后一页占位（当没有后一页时） -->
              <div
                v-else
                class="quick-links__container quick-links__container--page quick-links__container--next quick-links__container--placeholder"
              ></div>
            </div>
          </div>
        </div>
        <!-- 右翻页按钮 -->
        <button
          v-if="showPagination && !isOnlyTouchDevice"
          class="quick-links__nav-btn--next"
          :class="[
            {
              'quick-links__nav-btn--disabled':
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
      <quick-links-pagination-dots
        v-if="!settings.quickLinks.useScroll"
        :current-page="currentGroupPageIndex"
        :total-pages="showPagination ? currentGroupPages.length : 1"
        @goto="goToGroupPage"
      />
    </div>

    <!-- 共享右键菜单 -->
    <quick-link-context-menu
      ref="ctxMenuRef"
      :refresh-fn="refreshDebounced"
      :on-open-edit-dialog="props.onOpenEditDialog"
      :on-pin="pinToGroup"
      :on-move="moveToGroup"
      :popper-class="popperClass"
      show-edit
      show-move
    />
    <quick-link-group-select-dialog ref="groupSelectDialogRef" />
  </section>
</template>
