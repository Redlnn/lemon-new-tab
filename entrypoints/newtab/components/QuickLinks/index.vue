<script setup lang="ts">
import '@newtab/styles/quick-links.scss'
import { useDebounceFn, useEventListener, useResizeObserver, useWindowSize } from '@vueuse/core'

import {
  DragDropProvider,
  DragOverlay,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/vue'
import i18next from 'i18next'
import { useTranslation } from 'i18next-vue'
import PlusIcon from '~icons/fa6-solid/plus'
import ChevronLeft20Filled from '~icons/fluent/chevron-left-20-filled'
import ChevronRight20Filled from '~icons/fluent/chevron-right-20-filled'

import {
  DEFAULT_QUICK_LINK_GROUP_ID,
  useQuickLinksStore,
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
import QuickLinkDragOverlay from './components/QuickLinkDragOverlay.vue'
import QuickLinkDropTarget from './components/QuickLinkDropTarget.vue'
import QuickLinkGroupName from './components/QuickLinkGroupName.vue'
import QuickLinkGroupSelectDialog from './components/QuickLinkGroupSelectDialog.vue'
import QuickLinkItem from './components/QuickLinkItem.vue'
import type { QuickLinkItemPresentation } from './components/quickLinkItemPresentation'
import QuickLinkSortableItem from './components/QuickLinkSortableItem.vue'
import QuickLinksPaginationDots from './components/QuickLinksPaginationDots.vue'
import {
  buildQuickLinkDisplayItems,
  buildTopSiteDisplayItems,
} from './composables/quickLinkDisplayItems'
import {
  buildQuickLinkPages,
  buildQuickLinkScrollSections,
  type QuickLinkPage,
  type QuickLinkScrollSection as ScrollSection,
  type QuickLinkViewItem as DisplayItem,
} from './composables/quickLinksViewModel'
import { useGroupNameRefs } from './composables/useGroupNameRefs'
import {
  FLAT_QUICK_LINK_DND_GROUP_ID,
  QUICK_LINK_GROUPS_DND_ID,
  QUICK_LINK_GROUP_DND_TYPE,
  TOP_SITES_DND_GROUP_ID,
  getDndData,
  getPointerClientPoint,
  getSortableMoveState,
  persistQuickLinkDndMove,
  quickLinkContainerDndId,
  quickLinkDndId,
  quickLinkGroupDndId,
  quickLinkDndSensors,
  resolveQuickLinkMoveTarget,
  resolveStoreIndexFromSortableIndex,
  type QuickLinkDndData,
} from './composables/useQuickLinkDnd'
import { useQuickLinkGroupActions } from './composables/useQuickLinkGroupActions'
import { solveGridColumnFirst, usePagedGridLayout } from './composables/useQuickLinksLayout'
import { useQuickLinksPagination } from './composables/useQuickLinksPagination'
import { mergeTopSites } from './composables/useTopSitesMerge'
import { rawTopSites } from './utils/topSites'
const focusStore = useFocusState()
const settings = useSettingsStore()
const quickLinksStore = useQuickLinksStore()
const { t } = useTranslation()

const { height } = useWindowSize({ type: 'visual' })

const props = defineProps<{
  ready: boolean
  onOpenAddDialog?: (groupId?: string) => void
  onOpenEditDialog?: (target: QuickLinkTarget) => void
}>()

const refreshDebounced = useDebounceFn(refresh, 100)
const quickLinks = computed(() => quickLinksStore.items.slice())
const topSites = computed(() =>
  settings.quickLinks.topSites
    ? mergeTopSites(rawTopSites.value, {
        quickLinks: settings.quickLinks.grouping ? [] : quickLinks.value,
        noCap: true,
      })
    : [],
)

const topSitesGroupId = TOP_SITES_DND_GROUP_ID
const legacyDndGroupId = FLAT_QUICK_LINK_DND_GROUP_ID
const topSitesGroupName = i18next.t('newtab:quickLinks.groups.topSites')

const userGroups = computed(() => {
  if (!settings.quickLinks.grouping) return []
  return quickLinksStore.groups
})

const legacyItems = computed(() => buildQuickLinkDisplayItems(quickLinks.value, topSites.value))
const hasTopSitesItems = computed(() => settings.quickLinks.topSites && topSites.value.length > 0)
const topSiteDisplayItems = computed(() =>
  hasTopSitesItems.value ? buildTopSiteDisplayItems(topSites.value, topSitesGroupId) : [],
)

const visibleCategoryGroups = computed(() => userGroups.value)

const { updateMaxCols, maxFitCols, maxFitRows } = usePagedGridLayout()
const slotsPerPage = computed(() => maxFitCols.value * maxFitRows.value)
const isDragging = ref(false)
const dndRenderKey = ref(0)

const pages = computed<QuickLinkPage[]>(() => {
  return buildQuickLinkPages({
    grouping: settings.quickLinks.grouping,
    groups: visibleCategoryGroups.value,
    legacyItems: legacyItems.value,
    topSiteItems: topSiteDisplayItems.value,
    slotsPerPage: slotsPerPage.value,
    defaultGroupId: DEFAULT_QUICK_LINK_GROUP_ID,
    flatGroupId: legacyDndGroupId,
    topSitesGroupId,
  })
})

const scrollSections = computed<ScrollSection[]>(() => {
  return buildQuickLinkScrollSections({
    grouping: settings.quickLinks.grouping,
    groups: visibleCategoryGroups.value,
    legacyItems: legacyItems.value,
    topSiteItems: topSiteDisplayItems.value,
    topSitesTitle: topSitesGroupName,
    defaultGroupId: DEFAULT_QUICK_LINK_GROUP_ID,
    defaultGroupName: quickLinksStore.groups[0]?.name,
    topSitesGroupId,
  })
})

const pageLookup = computed(() => {
  const map = new Map<string, QuickLinkPage>()
  for (const page of pages.value) {
    map.set(`${page.groupId}:${page.pageInGroup}`, page)
  }
  return map
})

const scrollSectionLookup = computed(() => {
  const map = new Map<string, ScrollSection>()
  for (const section of scrollSections.value) {
    map.set(getDisplayGroupId(section.groupId), section)
  }
  return map
})

// 始终使用完整 pages 长度，以支持关闭翻页时也能切换分组
const paginationTotalItems = computed(() => pages.value.length)
const paginationItemsPerPage = ref(1)
const allowPageLoop = computed(() => settings.quickLinks.pagingLoop && !isDragging.value)

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
  resetPagingTransition,
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
const showAddButton = computed(() => showAddButtonForPage(currentPage.value))

function getDisplayGroupId(groupId?: string) {
  return settings.quickLinks.grouping ? (groupId ?? DEFAULT_QUICK_LINK_GROUP_ID) : legacyDndGroupId
}

function getItemDndGroupId(item: DisplayItem, groupId?: string) {
  return item.isPinned ? getDisplayGroupId(groupId) : topSitesGroupId
}

function getItemSortableIndex(item: DisplayItem) {
  return item.isPinned ? (item.sortableIndex ?? 0) : item.originalIndex
}

function getItemDndOrigin(item: DisplayItem) {
  return item.isPinned ? 'pinned' : 'top-sites'
}

function getItemDndDisabled(item: DisplayItem) {
  return item.isPinned ? false : { draggable: false, droppable: true }
}

function getSortableStoreIndexesForContext(groupId: string, pageIndex?: number) {
  if (settings.quickLinks.useScroll) {
    const section = scrollSectionLookup.value.get(groupId)
    if (section?.isTopSites) return []
    return section?.sortableStoreIndexes ?? []
  }

  const page =
    pageIndex !== undefined
      ? pageLookup.value.get(`${groupId}:${pageIndex}`)
      : currentPageData.value

  if (page && page.groupId === groupId && !page.isTopSites) {
    return page.sortableStoreIndexes
  }

  return []
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
  transparency: settings.perf.quickLinks.transparency,
  blur: settings.perf.quickLinks.blur,
}))
const popperClass = perf('quick-links__menu-popper')
const navBtnPerfClass = perf('quick-links__nav-btn')
const iconPerfClass = perf('quick-links__icon')
const pinIconPerfClass = perf('quick-links__pin-icon')

const quickLinkItemPresentation = computed<QuickLinkItemPresentation>(() => {
  const quickLinks = settings.quickLinks
  const openInNewTab = quickLinks.openInNewTab

  return {
    linkTarget: openInNewTab ? '_blank' : '_self',
    linkRel: openInNewTab ? 'noopener noreferrer' : undefined,
    iconTitleGap: `${quickLinks.spacing.iconTitleGap}px`,
    showPinnedIcon: quickLinks.pinnedIcon && quickLinks.topSites,
    iconBorder: quickLinks.style.border,
    showTitle: quickLinks.title.show,
    titleWidth: `calc(var(--icon_size) + ${quickLinks.title.extraWidth}px)`,
    iconClass: iconPerfClass.value,
    pinIconClass: pinIconPerfClass.value,
  }
})

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
const currentPageContainerRef = ref<HTMLElement | null>(null)
const nextPageContainerRef = useTemplateRef('nextPageContainerRef')

function setCurrentPageContainerRef(el: unknown) {
  if (el instanceof HTMLElement) {
    currentPageContainerRef.value = el
  } else if (
    el !== null &&
    typeof el === 'object' &&
    '$el' in el &&
    el.$el instanceof HTMLElement
  ) {
    currentPageContainerRef.value = el.$el
  } else {
    currentPageContainerRef.value = null
  }
}

function refresh() {
  // 刷新时重置打开的菜单，防止布局或数据变化导致索引失效
  if (openedMenuCloseFn.value) {
    openedMenuCloseFn.value()
    openedMenuCloseFn.value = null
  }
}

const activeDndData = shallowRef<QuickLinkDndData | null>(null)
let edgeSwitchTimer: ReturnType<typeof setTimeout> | undefined
let edgeSwitchTarget: number | null = null
let edgeSwitchOccurred = false

function clearEdgeSwitchTimer() {
  if (edgeSwitchTimer) {
    clearTimeout(edgeSwitchTimer)
    edgeSwitchTimer = undefined
  }
  edgeSwitchTarget = null
}

function getItemGroupSize(groupId: string) {
  if (!settings.quickLinks.grouping) return quickLinksStore.items.length
  return quickLinksStore.getGroupItemCount(groupId)
}

function buildDisplayItemFromDndData(data: Extract<QuickLinkDndData, { kind: 'quick-link' }>) {
  return {
    url: data.url,
    title: data.title,
    favicon: data.favicon,
    isPinned: data.origin === 'pinned',
    originalIndex: data.storeIndex,
    groupId: settings.quickLinks.grouping && data.origin === 'pinned' ? data.groupId : undefined,
  }
}

async function moveCategoryGroup(fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex) return
  const nextGroups = visibleCategoryGroups.value.slice()
  const [group] = nextGroups.splice(fromIndex, 1)
  if (!group) return
  nextGroups.splice(Math.max(0, Math.min(toIndex, nextGroups.length)), 0, group)
  await updateCategoryGroupOrder(nextGroups)
}

function scheduleEdgePageSwitch(point: { x: number; y: number } | null) {
  if (!point || settings.quickLinks.useScroll || !settings.quickLinks.paging || isAnimating.value) {
    clearEdgeSwitchTimer()
    return
  }

  const rect = quickLinksContainerRef.value?.getBoundingClientRect()
  if (!rect) {
    clearEdgeSwitchTimer()
    return
  }

  const threshold = 48
  let target: number | null = null
  if (point.x - rect.left < threshold) {
    if (currentPage.value > 0) target = currentPage.value - 1
    else if (allowPageLoop.value) target = totalPages.value - 1
  } else if (rect.right - point.x < threshold) {
    if (currentPage.value < totalPages.value - 1) target = currentPage.value + 1
    else if (allowPageLoop.value) target = 0
  }

  if (target === null || target === currentPage.value) {
    clearEdgeSwitchTimer()
    return
  }
  if (edgeSwitchTarget === target) return

  clearEdgeSwitchTimer()
  edgeSwitchTarget = target
  edgeSwitchTimer = setTimeout(() => {
    goToPage(target)
    edgeSwitchOccurred = true
    clearEdgeSwitchTimer()
  }, 500)
}

function getQuickLinkMoveTarget(
  source: Extract<QuickLinkDndData, { kind: 'quick-link' }>,
  target: QuickLinkDndData | null,
  sortableMove: ReturnType<typeof getSortableMoveState>,
) {
  const currentPage = currentPageData.value
  const isStalePagedTarget =
    !settings.quickLinks.useScroll &&
    (target?.kind === 'quick-link' || target?.kind === 'quick-link-container') &&
    currentPage &&
    (target.groupId !== currentPage.groupId || target.pageIndex !== currentPage.pageInGroup)
  const targetForQuickLink = isStalePagedTarget ? null : target
  const targetGroupAsContainer =
    source.origin === 'top-sites' && targetForQuickLink?.kind === 'quick-link-group'
      ? {
          groupId: targetForQuickLink.groupId,
          sortableIndex: getSortableStoreIndexesForContext(targetForQuickLink.groupId).length,
          storeIndex: getItemGroupSize(targetForQuickLink.groupId),
        }
      : null
  if (targetForQuickLink?.kind === 'quick-link-group' && !targetGroupAsContainer) return null

  const fallbackGroupId = currentPageData.value?.groupId ?? source.groupId
  const fallbackTarget =
    fallbackGroupId && fallbackGroupId !== topSitesGroupId
      ? {
          groupId: fallbackGroupId,
          sortableIndex: getSortableStoreIndexesForContext(fallbackGroupId).length,
          storeIndex: getItemGroupSize(fallbackGroupId),
        }
      : null
  const moveTarget =
    targetGroupAsContainer ?? resolveQuickLinkMoveTarget(targetForQuickLink, fallbackTarget)
  if (!moveTarget || moveTarget.groupId === topSitesGroupId) return null

  if (targetForQuickLink?.kind !== 'quick-link' || targetGroupAsContainer) {
    return {
      groupId: moveTarget.groupId,
      storeIndex: moveTarget.storeIndex,
    }
  }

  const targetGroupId = sortableMove.toGroupId ?? moveTarget.groupId
  if (targetGroupId === topSitesGroupId) return null
  const targetStoreIndexes = getSortableStoreIndexesForContext(
    targetGroupId,
    targetForQuickLink.pageIndex ?? source.pageIndex,
  )
  return {
    groupId: targetGroupId,
    storeIndex: resolveStoreIndexFromSortableIndex(
      targetStoreIndexes,
      sortableMove.toSortableIndex,
      moveTarget.storeIndex,
    ),
  }
}

async function handleQuickLinkDragStart(event: DragStartEvent) {
  const data = getDndData(event.operation.source)
  activeDndData.value = data
  isDragging.value = data?.kind === 'quick-link' || data?.kind === 'quick-link-group'
  edgeSwitchOccurred = false
  if (openedMenuCloseFn.value) {
    openedMenuCloseFn.value()
    openedMenuCloseFn.value = null
  }
}

function handleQuickLinkDragMove(event: DragMoveEvent) {
  scheduleEdgePageSwitch(getPointerClientPoint(event))
}

function handleQuickLinkDragOver(event: DragOverEvent) {
  const source = getDndData(event.operation.source)
  const target = getDndData(event.operation.target)
  if (!source || source.source !== 'quick-links') {
    event.preventDefault()
    return
  }
  if (source.kind === 'quick-link-group' && target?.kind !== 'quick-link-group') {
    event.preventDefault()
  }
  if (
    source.kind === 'quick-link' &&
    source.origin !== 'top-sites' &&
    target?.kind === 'quick-link-group'
  ) {
    event.preventDefault()
  }
}

async function handleQuickLinkDragEnd(event: DragEndEvent) {
  let shouldRemountDnd = false

  try {
    clearEdgeSwitchTimer()
    isDragging.value = false

    const source = activeDndData.value ?? getDndData(event.operation.source)
    const target = getDndData(event.operation.target)
    const sortableMove = getSortableMoveState(event.operation.source)

    if (!source || event.canceled || source.source !== 'quick-links') {
      return
    }

    if (source.kind === 'quick-link-group') {
      if (target?.kind === 'quick-link-group' || sortableMove.toSortableIndex !== undefined) {
        await moveCategoryGroup(
          source.storeIndex,
          sortableMove.toSortableIndex ?? target?.storeIndex ?? source.storeIndex,
        )
      }
      return
    }

    if (source.kind !== 'quick-link') return
    shouldRemountDnd = source.origin === 'top-sites'
    const moveTarget = getQuickLinkMoveTarget(source, target, sortableMove)
    if (!moveTarget) return

    try {
      const changed = await persistQuickLinkDndMove({
        store: quickLinksStore,
        grouping: settings.quickLinks.grouping,
        source,
        moveTarget,
      })
      if (source.origin === 'top-sites') {
        await refreshDebounced()
      } else if (changed) {
        await refreshDebounced()
      }
    } catch (error) {
      console.error('[quick-links] Failed to persist drag order:', error)
      ElMessage.error('拖拽排序保存失败')
      await refreshDebounced()
    }
  } finally {
    clearEdgeSwitchTimer()
    isDragging.value = false
    activeDndData.value = null
    resetPagingTransition()
    if (shouldRemountDnd || edgeSwitchOccurred) {
      dndRenderKey.value++
    }
    edgeSwitchOccurred = false
  }
}

function handleQuickLinkTouchMenu(event: PointerEvent, data: QuickLinkDndData) {
  if (data.kind !== 'quick-link') return
  openCtxMenu(event, buildDisplayItemFromDndData(data))
}

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
useResizeObserver(document.documentElement, () => {
  updateMaxCols()
  refreshDebounced()
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

onBeforeUnmount(() => {
  clearEdgeSwitchTimer()
})

watch(
  () => settings.quickLinks.topSites,
  () => {
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
  if (!props.ready) {
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
  '--icon_border_radius': `${settings.quickLinks.iconBorderRadius}%`,
}))

const scrollGridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${displayColumns.value}, 1fr)`,
  gridGap: `${settings.quickLinks.spacing.itemGapY}px ${settings.quickLinks.spacing.itemGapX}px`,
  '--icon_size': `${settings.quickLinks.iconSize}px`,
  '--icon_ratio': `${settings.quickLinks.iconRatio}`,
  '--icon_border_radius': `${settings.quickLinks.iconBorderRadius}%`,
}))

const categoryPerf = usePerfClasses(() => ({
  transparent: settings.perf.quickLinks.transparent,
  transparency: settings.perf.quickLinks.transparency,
  blur: settings.perf.quickLinks.blur,
}))

const categoryClass = categoryPerf('quick-links__category')

function getActiveGroupId() {
  const page = currentPageData.value
  if (settings.quickLinks.useScroll || !page || page.isTopSites) {
    return DEFAULT_QUICK_LINK_GROUP_ID
  }
  return page.groupId ?? DEFAULT_QUICK_LINK_GROUP_ID
}

defineExpose({ refresh, getActiveGroupId })
</script>

<template>
  <section
    class="quick-links"
    :aria-label="t('settings:quickLinks.title')"
    :class="{
      'quick-links--scroll': settings.quickLinks.useScroll,
      'quick-links--dragging': isDragging,
    }"
    :style="{
      opacity: isHideQuickLink,
      // paddingTop: `${settings.quickLinks.marginTop / 2}px`,
      marginTop: height > 500 ? `${settings.quickLinks.marginTop / 2}px` : undefined,
    }"
  >
    <DragDropProvider
      :key="dndRenderKey"
      :sensors="quickLinkDndSensors"
      @dragStart="handleQuickLinkDragStart"
      @dragMove="handleQuickLinkDragMove"
      @dragOver="handleQuickLinkDragOver"
      @dragEnd="handleQuickLinkDragEnd"
    >
      <div ref="quickLinksWrapperRef" class="quick-links__wrapper" :class="containerBaseClasses">
        <div v-if="settings.quickLinks.useScroll" class="quick-links__scroll">
          <section
            v-for="section in scrollSections"
            :key="section.key"
            class="quick-links__scroll-section"
          >
            <h2 v-if="section.title" class="quick-links__scroll-title">{{ section.title }}</h2>
            <quick-link-drop-target
              :id="quickLinkContainerDndId('quick-links', getDisplayGroupId(section.groupId))"
              class="quick-links__container quick-links__scroll-grid"
              :class="containerBaseClasses"
              :style="scrollGridStyle"
              :disabled="section.isTopSites"
              :data="{
                kind: 'quick-link-container',
                source: 'quick-links',
                groupId: getDisplayGroupId(section.groupId),
                sortableIndex: section.sortableStoreIndexes.length,
                storeIndex: getItemGroupSize(getDisplayGroupId(section.groupId)),
              }"
            >
              <template v-for="item in section.items" :key="getDisplayItemKey(section.key, item)">
                <quick-link-sortable-item
                  :id="
                    quickLinkDndId(
                      'quick-links',
                      getItemDndGroupId(item, section.groupId),
                      item.originalIndex,
                      item.url,
                    )
                  "
                  :index="getItemSortableIndex(item)"
                  :group="getItemDndGroupId(item, section.groupId)"
                  :disabled="getItemDndDisabled(item)"
                  :data="{
                    kind: 'quick-link',
                    source: 'quick-links',
                    groupId: getItemDndGroupId(item, section.groupId),
                    sortableIndex: getItemSortableIndex(item),
                    storeIndex: item.originalIndex,
                    url: item.url,
                    title: item.title,
                    favicon: item.favicon,
                    isPinned: item.isPinned,
                    origin: getItemDndOrigin(item),
                  }"
                  :title="item.title"
                  @touch-menu="handleQuickLinkTouchMenu"
                >
                  <quick-link-item
                    :url="item.url"
                    :title="item.title"
                    :favicon="item.favicon"
                    :pined="item.isPinned"
                    :presentation="quickLinkItemPresentation"
                    :on-context-menu="(e) => openCtxMenu(e, item)"
                    :tabindex="focusStore.isFocused ? -1 : 0"
                  />
                </quick-link-sortable-item>
              </template>
              <add-quick-link
                v-if="!section.isTopSites"
                :presentation="quickLinkItemPresentation"
                :show-button="true"
                :on-open="() => openAddQuickLinkForSection(section)"
              />
            </quick-link-drop-target>
          </section>
        </div>
        <el-space
          v-if="!settings.quickLinks.useScroll && settings.quickLinks.grouping"
          class="noselect"
          :class="categoryClass"
          role="navigation"
          :aria-label="t('newtab:a11y.quickLinksGroups')"
        >
          <div class="quick-links__category-groups">
            <quick-link-sortable-item
              v-for="(group, index) in visibleCategoryGroups"
              :key="group.id"
              :id="quickLinkGroupDndId('quick-links', group.id)"
              :index="index"
              :group="QUICK_LINK_GROUPS_DND_ID"
              :type="QUICK_LINK_GROUP_DND_TYPE"
              :accept="QUICK_LINK_GROUP_DND_TYPE"
              :data="{
                kind: 'quick-link-group',
                source: 'quick-links',
                groupId: group.id,
                sortableIndex: index,
                storeIndex: index,
              }"
            >
              <quick-link-drop-target
                :id="`quick-links-group-title:${group.id}`"
                class="quick-links__category-title-drop"
                :data="{
                  kind: 'quick-link-group',
                  source: 'quick-links',
                  groupId: group.id,
                  sortableIndex: getSortableStoreIndexesForContext(group.id).length,
                  storeIndex: getItemGroupSize(group.id),
                }"
              >
                <quick-link-group-name
                  :ref="(el) => setGroupNameRef(group.id, el)"
                  :name="group.name"
                  :active="currentPageData?.groupId === group.id"
                  editable
                  @select="selectGroup(group.id)"
                  @rename="(name) => renameGroup(group.id, name)"
                  @contextmenu.prevent="confirmDeleteGroup(group)"
                />
              </quick-link-drop-target>
            </quick-link-sortable-item>
          </div>
          <button
            v-if="settings.quickLinks.topSites"
            type="button"
            class="quick-links__category-item"
            :class="{
              'quick-links__category-item--active': currentPageData?.groupId === topSitesGroupId,
            }"
            :aria-current="currentPageData?.groupId === topSitesGroupId ? 'page' : undefined"
            @click="selectGroup(topSitesGroupId)"
          >
            {{ topSitesGroupName }}
          </button>
          <button
            type="button"
            class="quick-links__category-item"
            :aria-label="t('newtab:a11y.addQuickLinksGroup')"
            @click="createGroupInline"
          >
            <el-icon><PlusIcon /></el-icon>
          </button>
        </el-space>
        <div v-if="!settings.quickLinks.useScroll" class="quick-links__wrapper-inner">
          <!-- 左翻页按钮 -->
          <button
            v-if="showPagination && !isOnlyTouchDevice"
            type="button"
            class="quick-links__nav-btn--prev"
            :aria-label="t('newtab:a11y.previousPage')"
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
                    v-memo="[
                      item.url,
                      item.title,
                      item.favicon,
                      item.isPinned,
                      quickLinkItemPresentation,
                    ]"
                    :url="item.url"
                    :title="item.title"
                    :favicon="item.favicon"
                    :pined="item.isPinned"
                    :presentation="quickLinkItemPresentation"
                    :on-context-menu="(e) => openCtxMenu(e, item)"
                  />
                  <add-quick-link
                    v-if="showPrevPageAddButton"
                    :key="`${prevPageData?.key ?? 'prev'}-add`"
                    :presentation="quickLinkItemPresentation"
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
                <quick-link-drop-target
                  :ref="setCurrentPageContainerRef"
                  :id="
                    quickLinkContainerDndId(
                      'quick-links',
                      getDisplayGroupId(currentPageData?.groupId),
                      currentPageData?.pageInGroup,
                    )
                  "
                  class="quick-links__container quick-links__container--page quick-links__container--current"
                  :class="[...containerBaseClasses, containerAnimationClasses]"
                  :disabled="currentPageData?.isTopSites"
                  :data="{
                    kind: 'quick-link-container',
                    source: 'quick-links',
                    groupId: getDisplayGroupId(currentPageData?.groupId),
                    sortableIndex: currentPageData?.sortableStoreIndexes.length ?? 0,
                    storeIndex: getItemGroupSize(getDisplayGroupId(currentPageData?.groupId)),
                    pageIndex: currentPageData?.pageInGroup,
                  }"
                  :style="{
                    pointerEvents:
                      settings.quickLinks.showOnSearchFocus || !focusStore.isFocused
                        ? 'auto'
                        : 'none',
                    ...containerGridStyle,
                  }"
                >
                  <template
                    v-for="item in currentPageItems"
                    :key="getDisplayItemKey(currentPageData?.key, item)"
                  >
                    <quick-link-sortable-item
                      :id="
                        quickLinkDndId(
                          'quick-links',
                          getItemDndGroupId(item, currentPageData?.groupId),
                          item.originalIndex,
                          item.url,
                        )
                      "
                      :index="getItemSortableIndex(item)"
                      :group="getItemDndGroupId(item, currentPageData?.groupId)"
                      :disabled="getItemDndDisabled(item)"
                      :data="{
                        kind: 'quick-link',
                        source: 'quick-links',
                        groupId: getItemDndGroupId(item, currentPageData?.groupId),
                        sortableIndex: getItemSortableIndex(item),
                        storeIndex: item.originalIndex,
                        url: item.url,
                        title: item.title,
                        favicon: item.favicon,
                        isPinned: item.isPinned,
                        origin: getItemDndOrigin(item),
                        pageIndex: currentPageData?.pageInGroup,
                      }"
                      @touch-menu="handleQuickLinkTouchMenu"
                    >
                      <quick-link-item
                        :url="item.url"
                        :title="item.title"
                        :favicon="item.favicon"
                        :pined="item.isPinned"
                        :presentation="quickLinkItemPresentation"
                        :on-context-menu="(e) => openCtxMenu(e, item)"
                        :tabindex="focusStore.isFocused ? -1 : 0"
                      />
                    </quick-link-sortable-item>
                  </template>

                  <!-- 添加链接按钮（始终在最后一页最后一格） -->
                  <add-quick-link
                    :key="`${currentPageData?.key ?? 'current'}-add`"
                    :presentation="quickLinkItemPresentation"
                    :show-button="showAddButton"
                    :on-open="openAddQuickLink"
                  />
                </quick-link-drop-target>

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
                    v-memo="[
                      item.url,
                      item.title,
                      item.favicon,
                      item.isPinned,
                      quickLinkItemPresentation,
                    ]"
                    :url="item.url"
                    :title="item.title"
                    :favicon="item.favicon"
                    :pined="item.isPinned"
                    :presentation="quickLinkItemPresentation"
                    :on-context-menu="(e) => openCtxMenu(e, item)"
                  />
                  <add-quick-link
                    v-if="showNextPageAddButton"
                    :key="`${nextPageData?.key ?? 'next'}-add`"
                    :presentation="quickLinkItemPresentation"
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
            type="button"
            class="quick-links__nav-btn--next"
            :aria-label="t('newtab:a11y.nextPage')"
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

      <DragOverlay :drop-animation="null">
        <quick-link-drag-overlay :data="activeDndData" />
      </DragOverlay>
    </DragDropProvider>

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
