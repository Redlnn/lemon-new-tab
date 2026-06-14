<script setup lang="ts">
import { onKeyStroke, useDebounceFn, useElementSize, useSwipe, useWindowSize } from '@vueuse/core'

import {
  DragDropProvider,
  DragOverlay,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/vue'
import { useTranslation } from 'i18next-vue'
import ChevronDown20Filled from '~icons/fluent/chevron-down-20-filled'
import ChevronUp20Filled from '~icons/fluent/chevron-up-20-filled'
import Pin12Regular from '~icons/fluent/pin-12-regular'
import AddRound from '~icons/ic/round-add'
import DeleteRound from '~icons/ic/round-delete'
import SettingsRound from '~icons/ic/round-settings'

import { createFaviconUrlResolver } from '@/shared/media'
import {
  DEFAULT_QUICK_LINK_GROUP_ID,
  useQuickLinksStore,
  type QuickLink,
  type QuickLinkGroup,
  type QuickLinkTarget,
} from '@/shared/quickLinks'
import { useSettingsStore } from '@/shared/settings'

import { usePerfClasses } from '@newtab/composables/usePerfClasses'
import { OPEN_SETTINGS } from '@newtab/shared/keys'

import QuickLinkContextMenu from './components/QuickLinkContextMenu.vue'
import QuickLinkDragOverlay from './components/QuickLinkDragOverlay.vue'
import QuickLinkDropTarget from './components/QuickLinkDropTarget.vue'
import QuickLinkGroupName from './components/QuickLinkGroupName.vue'
import QuickLinkGroupSelectDialog from './components/QuickLinkGroupSelectDialog.vue'
import QuickLinkSortableItem from './components/QuickLinkSortableItem.vue'
import { buildQuickLinkDisplayItems } from './composables/quickLinkDisplayItems'
import { useGroupNameRefs } from './composables/useGroupNameRefs'
import {
  FLAT_QUICK_LINK_DND_GROUP_ID,
  TOP_SITES_DND_GROUP_ID,
  getDndData,
  getPointerClientPoint,
  getSortableMoveState,
  getSortableStoreIndexes,
  launchpadDndSensors,
  quickLinkContainerDndId,
  quickLinkDndId,
  resolveQuickLinkMoveTarget,
  resolveStoreIndexFromSortableIndex,
  type QuickLinkDndData,
} from './composables/useQuickLinkDnd'
import { useQuickLinkGroupActions } from './composables/useQuickLinkGroupActions'
import { useQuickLinksData } from './composables/useQuickLinksData'
import { useTopSitesMerge } from './composables/useTopSitesMerge'

const getOrCreateFaviconRef = createFaviconUrlResolver()

const refreshDebounced = useDebounceFn(refresh, 100)

const { topSites, quickLinks, topSitesNeedsReload } = useQuickLinksData(refreshDebounced)

const model = defineModel<boolean>({ required: true })

const props = defineProps<{
  onOpenAddDialog?: (groupId?: string) => void
  onOpenEditDialog?: (target: QuickLinkTarget) => void
}>()

type IndexedQuickLink = {
  item: QuickLink
  index: number
  sortableIndex: number
}

type GroupView = {
  group: QuickLinkGroup
  items: IndexedQuickLink[]
  sortableStoreIndexes: number[]
}

const { t } = useTranslation()
const settings = useSettingsStore()
const quickLinksStore = useQuickLinksStore()
const legacyDndGroupId = FLAT_QUICK_LINK_DND_GROUP_ID
const topSitesGroupId = TOP_SITES_DND_GROUP_ID

const openSettings = inject(OPEN_SETTINGS)

const { width: windowWidth } = useWindowSize({ type: 'visual' })

// ---- 状态 ----
const query = ref('')
const page = ref(0)
const containerRef = useTemplateRef<HTMLElement>('container')
const searchInputRef = useTemplateRef<{ focus: () => void }>('searchInput')
const { height: containerHeight } = useElementSize(containerRef)

const COLS = computed(() => {
  if (windowWidth.value <= 700) return 4
  else if (windowWidth.value <= 900) return 5
  else if (windowWidth.value <= 1000) return 6
  else return 7
})
const ROWS = computed(() => {
  const isSmall = windowWidth.value <= 500
  const isMid = windowWidth.value <= 800
  const h = containerHeight.value - (isSmall ? 70 : 88) - 64
  const rowHeight = isSmall ? 106 : isMid ? 114 : 122
  return Math.max(1, Math.floor((h + 8) / rowHeight))
})

const pageSize = computed(() => COLS.value * ROWS.value)

const allItems = computed(() => buildQuickLinkDisplayItems(quickLinks.value, topSites.value))
const userGroups = computed(() => (settings.quickLinks.grouping ? quickLinksStore.groups : []))
const topSitesItems = computed(() =>
  topSites.value.map((item, index) => ({
    url: item.url,
    title: item.title || '',
    favicon: item.favicon,
    isPinned: false,
    originalIndex: index,
  })),
)
const filteredTopSitesItems = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return topSitesItems.value
  return topSitesItems.value.filter(
    (item) => item.title.toLowerCase().includes(q) || item.url.toLowerCase().includes(q),
  )
})

const isSearching = computed(() => query.value.trim().length > 0)

const filteredItems = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return allItems.value
  return allItems.value.filter(
    (item) => item.title.toLowerCase().includes(q) || item.url.toLowerCase().includes(q),
  )
})

// 添加按钮占1个槽，纳入分页计算
const pageCount = computed(() => {
  const total = !isSearching.value ? allItems.value.length + 1 : allItems.value.length
  return Math.max(1, Math.ceil(total / pageSize.value))
})

const currentItems = computed(() => {
  if (isSearching.value) return filteredItems.value
  const start = page.value * pageSize.value
  const isLastPage = page.value === pageCount.value - 1
  // 最后一页留一个槽给添加按钮
  const end = isLastPage && !isSearching.value ? start + pageSize.value - 1 : start + pageSize.value
  return allItems.value.slice(start, end)
})

const currentSortableStoreIndexes = computed(() => getSortableStoreIndexes(currentItems.value))
const currentSortableIndexByStoreIndex = computed(
  () =>
    new Map(
      currentSortableStoreIndexes.value.map((storeIndex, sortableIndex) => [
        storeIndex,
        sortableIndex,
      ]),
    ),
)

const currentFlatContainerInsertIndex = computed(() => {
  const pinnedIndexes = currentItems.value
    .filter((item) => item.isPinned)
    .map((item) => item.originalIndex)
  if (pinnedIndexes.length === 0) {
    return Math.min(page.value * pageSize.value, quickLinksStore.items.length)
  }
  return Math.min(Math.max(...pinnedIndexes) + 1, quickLinksStore.items.length)
})

// ---- 数据获取 ----
async function refresh() {
  if (
    settings.quickLinks.grouping &&
    !quickLinksStore.groups.some((group) => group.id === DEFAULT_QUICK_LINK_GROUP_ID)
  ) {
    await quickLinksStore.enableGroupingFromItems()
  }
  quickLinks.value = quickLinksStore.items.slice()

  // 合并最常访问
  if (settings.dock.launchpad.topSites) {
    topSites.value = await useTopSitesMerge({
      quickLinks: settings.quickLinks.grouping ? [] : quickLinks.value,
      force: topSitesNeedsReload.value,
      noCap: true, // 不截断，获取所有可用的 top sites
    })
    topSitesNeedsReload.value = false
  } else {
    topSites.value = []
  }
}

// ---- 翻页 ----
const pageDirection = ref<'forward' | 'backward'>('forward')

function prevPage() {
  if (page.value > 0) {
    pageDirection.value = 'backward'
    page.value--
  }
}

function nextPage() {
  if (page.value < pageCount.value - 1) {
    pageDirection.value = 'forward'
    page.value++
  }
}

// ---- 关闭 ----
function close() {
  if (ctxMenuOpen.value) {
    ctxMenuRef.value?.close()
    ctxMenuOpen.value = false
    return
  }
  model.value = false
}

// ---- 滑动翻页（移动端）----
useSwipe(containerRef, {
  onSwipeEnd(_e, dir) {
    if (dir === 'left') nextPage()
    else if (dir === 'right') prevPage()
  },
})

// ---- 键盘 ----
onKeyStroke('Escape', (e) => {
  if (model.value) {
    e.preventDefault()
    close()
  }
})

onKeyStroke('ArrowLeft', (e) => {
  if (model.value && !isSearching.value) {
    e.preventDefault()
    prevPage()
  }
})

onKeyStroke('ArrowRight', (e) => {
  if (model.value && !isSearching.value) {
    e.preventDefault()
    nextPage()
  }
})

// ---- 打开时重置 & 刷新 ----
watch(
  model,
  async (v) => {
    if (v) {
      query.value = ''
      page.value = 0
      await refresh()
      await nextTick()
      searchInputRef.value?.focus()
    }
  },
  { immediate: true },
)

// 搜索时回到第0页
watch(query, () => {
  page.value = 0
})

// 页数变化时确保当前页有效
watch(pageCount, (count) => {
  if (page.value >= count) page.value = Math.max(0, count - 1)
})

watch(
  () => settings.dock.launchpad.topSites,
  (enabled) => {
    if (enabled) {
      topSitesNeedsReload.value = true
    }
    refreshDebounced()
  },
)

// ---- 右键菜单 ----
const perf = usePerfClasses(() => ({
  transparent: settings.perf.quickLinks.transparent,
  blur: settings.perf.quickLinks.blur,
}))

const popperClass = perf('quick-links__menu-popper')

const ctxMenuRef = useTemplateRef<InstanceType<typeof QuickLinkContextMenu>>('ctxMenuRef')
const ctxMenuOpen = ref(false)
const dndRenderKey = ref(0)

function openCtxMenu(
  event: MouseEvent | PointerEvent,
  item: { url: string; title: string; isPinned: boolean; originalIndex: number; groupId?: string },
): void {
  ctxMenuRef.value?.open(event, item)
  ctxMenuOpen.value = true
}

const groupSelectDialogRef =
  useTemplateRef<InstanceType<typeof QuickLinkGroupSelectDialog>>('groupSelectDialogRef')
const { groupNameRefs, setGroupNameRef } = useGroupNameRefs()

const groupViews = computed<GroupView[]>(() => {
  const q = query.value.trim().toLowerCase()
  return userGroups.value.map((group) => {
    const items: IndexedQuickLink[] = []
    const sortableStoreIndexes: number[] = []

    for (let index = 0; index < group.items.length; index++) {
      const item = group.items[index]!
      if (q && !item.title.toLowerCase().includes(q) && !item.url.toLowerCase().includes(q)) {
        continue
      }
      items.push({
        item,
        index,
        sortableIndex: sortableStoreIndexes.length,
      })
      sortableStoreIndexes.push(index)
    }

    return {
      group,
      items,
      sortableStoreIndexes,
    }
  })
})

function toGroupedDisplayItem(item: QuickLink, index: number, groupId: string) {
  return {
    url: item.url,
    title: item.title,
    favicon: item.favicon,
    isPinned: true,
    originalIndex: index,
    groupId,
  }
}

function getCurrentSortableStoreIndexes() {
  return currentSortableStoreIndexes.value
}

function getFlatSortableIndex(storeIndex: number) {
  return currentSortableIndexByStoreIndex.value.get(storeIndex) ?? 0
}

function getLaunchpadContextStoreIndexes(groupId: string) {
  if (!settings.quickLinks.grouping) return getCurrentSortableStoreIndexes()
  return groupViews.value.find((view) => view.group.id === groupId)?.sortableStoreIndexes ?? []
}

async function createGroupInline() {
  const group = await quickLinksStore.createGroup('')
  await refreshDebounced()
  nextTick(() => groupNameRefs.get(group.id)?.beginEdit())
}

async function moveGroup(groupId: string, direction: -1 | 1) {
  const visibleGroups = userGroups.value
  const index = visibleGroups.findIndex((group) => group.id === groupId)
  const targetIndex = index + direction
  if (index < 0 || targetIndex < 0 || targetIndex >= visibleGroups.length) return
  const nextGroups = visibleGroups.slice()
  const [group] = nextGroups.splice(index, 1)
  if (!group) return
  nextGroups.splice(targetIndex, 0, group)
  const changed = await quickLinksStore.reorderGroups(nextGroups)
  if (!changed) return
  await refreshDebounced()
}

function openAddQuickLink(groupId?: string) {
  props.onOpenAddDialog?.(groupId ?? DEFAULT_QUICK_LINK_GROUP_ID)
}

const { pinToGroup, moveToGroup, renameGroup, confirmDeleteGroup } = useQuickLinkGroupActions({
  groupSelectDialogRef,
  refresh: refreshDebounced,
  t,
})

const activeDndData = shallowRef<QuickLinkDndData | null>(null)
let pageSwitchTimer: ReturnType<typeof setTimeout> | undefined
let pageSwitchTarget: number | null = null

function clearPageSwitchTimer() {
  if (pageSwitchTimer) {
    clearTimeout(pageSwitchTimer)
    pageSwitchTimer = undefined
  }
  pageSwitchTarget = null
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

function scheduleLaunchpadPageSwitch(point: { x: number; y: number } | null) {
  if (!point || settings.quickLinks.grouping || isSearching.value || pageCount.value <= 1) {
    clearPageSwitchTimer()
    return
  }

  const rect = containerRef.value?.getBoundingClientRect()
  if (!rect) {
    clearPageSwitchTimer()
    return
  }

  const threshold = 72
  let target: number | null = null
  if (point.x - rect.left < threshold && page.value > 0) {
    target = page.value - 1
  } else if (rect.right - point.x < threshold && page.value < pageCount.value - 1) {
    target = page.value + 1
  }

  if (target === null || target === page.value) {
    clearPageSwitchTimer()
    return
  }
  if (pageSwitchTarget === target) return

  clearPageSwitchTimer()
  pageSwitchTarget = target
  pageSwitchTimer = setTimeout(() => {
    if (target! > page.value) nextPage()
    else prevPage()
    clearPageSwitchTimer()
  }, 500)
}

function autoScrollGroupedLaunchpad(point: { x: number; y: number } | null) {
  if (!point || !settings.quickLinks.grouping) return
  const scrollEl = containerRef.value?.querySelector('.launchpad-grouped .el-scrollbar__wrap')
  if (!(scrollEl instanceof HTMLElement)) return
  const rect = scrollEl.getBoundingClientRect()
  const threshold = 80
  if (point.y - rect.top < threshold) {
    scrollEl.scrollBy({ top: -18 })
  } else if (rect.bottom - point.y < threshold) {
    scrollEl.scrollBy({ top: 18 })
  }
}

function getLaunchpadMoveTarget(
  source: Extract<QuickLinkDndData, { kind: 'quick-link' }>,
  target: QuickLinkDndData | null,
  sortableMove: ReturnType<typeof getSortableMoveState>,
) {
  const fallbackGroupId = settings.quickLinks.grouping ? source.groupId : legacyDndGroupId
  const fallbackStoreIndex = settings.quickLinks.grouping
    ? (quickLinksStore.groups.find((group) => group.id === fallbackGroupId)?.items.length ?? 0)
    : currentFlatContainerInsertIndex.value
  const fallbackTarget = {
    groupId: fallbackGroupId,
    sortableIndex: getLaunchpadContextStoreIndexes(fallbackGroupId).length,
    storeIndex: fallbackStoreIndex,
  }
  const targetForQuickLink =
    target?.kind === 'quick-link-group'
      ? {
          ...target,
          sortableIndex: getLaunchpadContextStoreIndexes(target.groupId).length,
          storeIndex:
            quickLinksStore.groups.find((group) => group.id === target.groupId)?.items.length ?? 0,
        }
      : target
  const moveTarget = resolveQuickLinkMoveTarget(targetForQuickLink, fallbackTarget)
  if (!moveTarget || moveTarget.groupId === topSitesGroupId) return null

  if (targetForQuickLink?.kind !== 'quick-link') {
    return {
      groupId: moveTarget.groupId,
      storeIndex: moveTarget.storeIndex,
    }
  }

  const targetGroupId = sortableMove.toGroupId ?? moveTarget.groupId
  if (targetGroupId === topSitesGroupId) return null
  const targetStoreIndexes = getLaunchpadContextStoreIndexes(targetGroupId)
  return {
    groupId: targetGroupId,
    storeIndex: resolveStoreIndexFromSortableIndex(
      targetStoreIndexes,
      sortableMove.toSortableIndex,
      moveTarget.storeIndex,
    ),
  }
}

function handleLaunchpadDragStart(event: DragStartEvent) {
  const data = getDndData(event.operation.source)
  activeDndData.value = data
  if (ctxMenuOpen.value) {
    ctxMenuRef.value?.close()
    ctxMenuOpen.value = false
  }
}

function handleLaunchpadDragMove(event: DragMoveEvent) {
  const point = getPointerClientPoint(event)
  scheduleLaunchpadPageSwitch(point)
  autoScrollGroupedLaunchpad(point)
}

function handleLaunchpadDragOver(event: DragOverEvent) {
  const source = getDndData(event.operation.source)
  if (!source || source.source !== 'launchpad' || isSearching.value) {
    event.preventDefault()
  }
}

async function handleLaunchpadDragEnd(event: DragEndEvent) {
  clearPageSwitchTimer()
  const source = activeDndData.value ?? getDndData(event.operation.source)
  const target = getDndData(event.operation.target)
  const sortableMove = getSortableMoveState(event.operation.source)
  activeDndData.value = null

  if (!source || event.canceled || source.source !== 'launchpad' || source.kind !== 'quick-link') {
    return
  }

  const moveTarget = getLaunchpadMoveTarget(source, target, sortableMove)
  if (!moveTarget) return

  try {
    const quickLink = {
      url: source.url,
      title: source.title,
      favicon: source.favicon,
    }
    let changed: boolean
    if (source.origin === 'top-sites') {
      changed = settings.quickLinks.grouping
        ? await quickLinksStore.insertQuickLinkToGroup({
            groupId: moveTarget.groupId,
            quickLink,
            index: moveTarget.storeIndex,
          })
        : await quickLinksStore.insertFlatQuickLink({
            quickLink,
            index: moveTarget.storeIndex,
          })
    } else {
      changed = !settings.quickLinks.grouping
        ? await quickLinksStore.moveFlatQuickLink({
            fromIndex: source.storeIndex,
            toIndex: moveTarget.storeIndex,
          })
        : await quickLinksStore.moveQuickLink({
            fromGroupId: source.groupId,
            fromIndex: source.storeIndex,
            toGroupId: moveTarget.groupId,
            toIndex: moveTarget.storeIndex,
          })
    }
    if (source.origin === 'top-sites') {
      await refreshDebounced()
      dndRenderKey.value++
    } else if (changed) {
      await refreshDebounced()
    }
  } catch (error) {
    console.error('[launchpad] Failed to persist drag order:', error)
    ElMessage.error('拖拽排序保存失败')
    await refreshDebounced()
    if (source.origin === 'top-sites') {
      dndRenderKey.value++
    }
  }
}

function handleLaunchpadTouchMenu(event: PointerEvent, data: QuickLinkDndData) {
  if (data.kind !== 'quick-link') return
  openCtxMenu(event, buildDisplayItemFromDndData(data))
}

onBeforeUnmount(() => {
  clearPageSwitchTimer()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="launchpad-fade">
      <el-overlay v-show="model" :overlay-class="['launchpad-overlay', 'noselect']" :z-index="1">
        <div
          class="launchpad-wrapper"
          ref="container"
          @click.self="close"
          @contextmenu.prevent.stop
        >
          <!-- 搜索栏 -->
          <div class="launchpad-search">
            <el-input
              ref="searchInput"
              v-model="query"
              :placeholder="t('dock.launchpad.search')"
              clearable
              size="large"
              class="launchpad-search__input"
            >
              <template #prefix>
                <el-icon :size="16">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path
                      d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
                    />
                  </svg>
                </el-icon>
              </template>
            </el-input>

            <div
              v-if="settings.quickLinks.grouping"
              role="button"
              tabindex="0"
              class="launchpad-group-add action-btn setting-btn"
              @click="createGroupInline"
            >
              <el-icon><add-round /></el-icon>
            </div>

            <!-- 设置按钮 -->
            <div
              role="button"
              tabindex="0"
              class="launchpad-settings action-btn setting-btn"
              @click="openSettings"
            >
              <el-icon><settings-round /></el-icon>
            </div>
          </div>

          <DragDropProvider
            :key="dndRenderKey"
            :sensors="launchpadDndSensors"
            @dragStart="handleLaunchpadDragStart"
            @dragMove="handleLaunchpadDragMove"
            @dragOver="handleLaunchpadDragOver"
            @dragEnd="handleLaunchpadDragEnd"
          >
            <!-- 图标网格 -->
            <div v-if="settings.quickLinks.grouping" class="launchpad-grouped" @click.self="close">
              <el-scrollbar>
                <section v-for="view in groupViews" :key="view.group.id" class="launchpad-group">
                  <div class="launchpad-group__header">
                    <quick-link-drop-target
                      :id="`launchpad-group-title:${view.group.id}`"
                      class="launchpad-group__title-drop"
                      :disabled="isSearching"
                      :data="{
                        kind: 'quick-link-group',
                        source: 'launchpad',
                        groupId: view.group.id,
                        sortableIndex: view.sortableStoreIndexes.length,
                        storeIndex: view.group.items.length,
                      }"
                    >
                      <quick-link-group-name
                        :ref="(el) => setGroupNameRef(view.group.id, el)"
                        :name="view.group.name"
                        class="launchpad-group__title"
                        editable
                        plain
                        @rename="(name) => renameGroup(view.group.id, name)"
                      />
                    </quick-link-drop-target>
                    <div class="launchpad-group__actions">
                      <button
                        type="button"
                        class="launchpad-group__sort-btn"
                        :disabled="userGroups[0]?.id === view.group.id"
                        @click="moveGroup(view.group.id, -1)"
                      >
                        <el-icon><chevron-up20-filled /></el-icon>
                      </button>
                      <button
                        type="button"
                        class="launchpad-group__sort-btn"
                        :disabled="userGroups[userGroups.length - 1]?.id === view.group.id"
                        @click="moveGroup(view.group.id, 1)"
                      >
                        <el-icon><chevron-down20-filled /></el-icon>
                      </button>
                      <button
                        type="button"
                        class="launchpad-group__sort-btn"
                        @click="confirmDeleteGroup(view.group)"
                      >
                        <el-icon><delete-round /></el-icon>
                      </button>
                    </div>
                  </div>
                  <quick-link-drop-target
                    :id="quickLinkContainerDndId('launchpad', view.group.id)"
                    class="launchpad-grid"
                    :style="{ '--lp-cols': COLS }"
                    :disabled="isSearching"
                    :data="{
                      kind: 'quick-link-container',
                      source: 'launchpad',
                      groupId: view.group.id,
                      sortableIndex: view.sortableStoreIndexes.length,
                      storeIndex: view.group.items.length,
                    }"
                  >
                    <quick-link-sortable-item
                      v-for="{ item, index, sortableIndex } in view.items"
                      :key="`${view.group.id}-${item.url}-${index}`"
                      :id="quickLinkDndId('launchpad', view.group.id, index, item.url)"
                      :index="sortableIndex"
                      :group="view.group.id"
                      :disabled="isSearching"
                      :data="{
                        kind: 'quick-link',
                        source: 'launchpad',
                        groupId: view.group.id,
                        sortableIndex,
                        storeIndex: index,
                        url: item.url,
                        title: item.title,
                        favicon: item.favicon,
                        isPinned: true,
                        origin: 'pinned',
                      }"
                      @touch-menu="handleLaunchpadTouchMenu"
                    >
                      <a
                        class="launchpad-item launchpad-item--pined"
                        :href="item.url"
                        :target="settings.quickLinks.openInNewTab ? '_blank' : '_self'"
                        :rel="settings.quickLinks.openInNewTab ? 'noopener noreferrer' : undefined"
                        @contextmenu.prevent="
                          openCtxMenu($event, toGroupedDisplayItem(item, index, view.group.id))
                        "
                      >
                        <div class="launchpad-item__icon">
                          <img
                            :src="item.favicon || getOrCreateFaviconRef(item.url)"
                            :alt="item.title"
                          />
                        </div>
                        <el-text :line-clamp="1" truncated class="launchpad-item__label">
                          {{ item.title }}
                        </el-text>
                      </a>
                    </quick-link-sortable-item>
                    <div
                      v-if="!isSearching"
                      class="launchpad-item"
                      @click="openAddQuickLink(view.group.id)"
                    >
                      <el-icon class="launchpad-item__icon launchpad-item__icon--add">
                        <add-round />
                      </el-icon>
                      <el-text :line-clamp="1" truncated class="launchpad-item__label">
                        {{ t('dock.launchpad.add') }}
                      </el-text>
                    </div>
                  </quick-link-drop-target>
                </section>

                <section
                  v-if="settings.dock.launchpad.topSites && filteredTopSitesItems.length > 0"
                  class="launchpad-group"
                >
                  <h2 class="launchpad-group__system-title">
                    {{ t('quickLinks.groups.topSites') }}
                  </h2>
                  <div class="launchpad-grid" :style="{ '--lp-cols': COLS }">
                    <quick-link-sortable-item
                      v-for="item in filteredTopSitesItems"
                      :key="`top-${item.originalIndex}`"
                      :id="
                        quickLinkDndId('launchpad', topSitesGroupId, item.originalIndex, item.url)
                      "
                      :index="item.originalIndex"
                      :group="topSitesGroupId"
                      :disabled="isSearching ? true : { draggable: false, droppable: true }"
                      :data="{
                        kind: 'quick-link',
                        source: 'launchpad',
                        groupId: topSitesGroupId,
                        sortableIndex: item.originalIndex,
                        storeIndex: item.originalIndex,
                        url: item.url,
                        title: item.title,
                        favicon: item.favicon,
                        isPinned: false,
                        origin: 'top-sites',
                      }"
                      @touch-menu="handleLaunchpadTouchMenu"
                    >
                      <a
                        class="launchpad-item"
                        :href="item.url"
                        :target="settings.quickLinks.openInNewTab ? '_blank' : '_self'"
                        :rel="settings.quickLinks.openInNewTab ? 'noopener noreferrer' : undefined"
                        @contextmenu.prevent="openCtxMenu($event, item)"
                      >
                        <div class="launchpad-item__icon">
                          <img
                            :src="item.favicon || getOrCreateFaviconRef(item.url)"
                            :alt="item.title"
                          />
                        </div>
                        <el-text :line-clamp="1" truncated class="launchpad-item__label">
                          {{ item.title }}
                        </el-text>
                      </a>
                    </quick-link-sortable-item>
                  </div>
                </section>
              </el-scrollbar>
            </div>

            <Transition
              v-else
              :name="pageDirection === 'backward' ? 'launchpad-page-back' : 'launchpad-page'"
              mode="out-in"
            >
              <quick-link-drop-target
                :key="isSearching ? 'search' : page"
                :id="quickLinkContainerDndId('launchpad', legacyDndGroupId, page)"
                class="launchpad-grid"
                :style="{ '--lp-cols': COLS }"
                :disabled="isSearching"
                :data="{
                  kind: 'quick-link-container',
                  source: 'launchpad',
                  groupId: legacyDndGroupId,
                  sortableIndex: getCurrentSortableStoreIndexes().length,
                  storeIndex: currentFlatContainerInsertIndex,
                  pageIndex: page,
                }"
                @click.self="close"
              >
                <template v-for="item in currentItems" :key="item.url">
                  <quick-link-sortable-item
                    v-if="item.isPinned"
                    :id="
                      quickLinkDndId('launchpad', legacyDndGroupId, item.originalIndex, item.url)
                    "
                    :index="getFlatSortableIndex(item.originalIndex)"
                    :group="legacyDndGroupId"
                    :disabled="isSearching"
                    :data="{
                      kind: 'quick-link',
                      source: 'launchpad',
                      groupId: legacyDndGroupId,
                      sortableIndex: getFlatSortableIndex(item.originalIndex),
                      storeIndex: item.originalIndex,
                      url: item.url,
                      title: item.title,
                      favicon: item.favicon,
                      isPinned: true,
                      origin: 'pinned',
                      pageIndex: page,
                    }"
                    @touch-menu="handleLaunchpadTouchMenu"
                  >
                    <a
                      class="launchpad-item launchpad-item--pined"
                      :href="item.url"
                      :target="settings.quickLinks.openInNewTab ? '_blank' : '_self'"
                      :rel="settings.quickLinks.openInNewTab ? 'noopener noreferrer' : undefined"
                      @contextmenu.prevent="openCtxMenu($event, item)"
                    >
                      <div class="launchpad-item__icon">
                        <img
                          :src="item.favicon || getOrCreateFaviconRef(item.url)"
                          :alt="item.title"
                        />
                      </div>
                      <el-text :line-clamp="1" truncated class="launchpad-item__label">
                        <el-icon v-if="settings.dock.launchpad.topSites">
                          <pin12-regular />
                        </el-icon>
                        {{ item.title }}
                      </el-text>
                    </a>
                  </quick-link-sortable-item>
                  <quick-link-sortable-item
                    v-else
                    :id="quickLinkDndId('launchpad', topSitesGroupId, item.originalIndex, item.url)"
                    :index="item.originalIndex"
                    :group="topSitesGroupId"
                    :disabled="isSearching ? true : { draggable: false, droppable: true }"
                    :data="{
                      kind: 'quick-link',
                      source: 'launchpad',
                      groupId: topSitesGroupId,
                      sortableIndex: item.originalIndex,
                      storeIndex: item.originalIndex,
                      url: item.url,
                      title: item.title,
                      favicon: item.favicon,
                      isPinned: false,
                      origin: 'top-sites',
                      pageIndex: page,
                    }"
                    @touch-menu="handleLaunchpadTouchMenu"
                  >
                    <a
                      class="launchpad-item"
                      :href="item.url"
                      :target="settings.quickLinks.openInNewTab ? '_blank' : '_self'"
                      :rel="settings.quickLinks.openInNewTab ? 'noopener noreferrer' : undefined"
                      @contextmenu.prevent="openCtxMenu($event, item)"
                    >
                      <div class="launchpad-item__icon">
                        <img
                          :src="item.favicon || getOrCreateFaviconRef(item.url)"
                          :alt="item.title"
                        />
                      </div>
                      <el-text :line-clamp="1" truncated class="launchpad-item__label">
                        {{ item.title }}
                      </el-text>
                    </a>
                  </quick-link-sortable-item>
                </template>
                <!-- 无结果 -->
                <div
                  v-if="currentItems.length === 0 && isSearching"
                  class="launchpad-empty"
                  style="pointer-events: none"
                >
                  {{ t('dock.launchpad.empty') }}
                </div>
                <!-- 添加按钮（仅最后一页显示）-->
                <div
                  v-if="!isSearching && page === pageCount - 1"
                  class="launchpad-item"
                  @click="props.onOpenAddDialog?.()"
                >
                  <el-icon class="launchpad-item__icon launchpad-item__icon--add">
                    <add-round />
                  </el-icon>
                  <el-text :line-clamp="1" truncated class="launchpad-item__label">
                    {{ t('dock.launchpad.add') }}
                  </el-text>
                </div>
              </quick-link-drop-target>
            </Transition>

            <!-- 分页控制（非搜索模式，多于1页时显示） -->
            <div
              v-if="!settings.quickLinks.grouping && !isSearching && pageCount > 1"
              class="launchpad-pagination"
            >
              <button class="launchpad-arrow" :disabled="page === 0" @click="prevPage">
                <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                  <path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z" />
                </svg>
              </button>
              <div class="launchpad-dots">
                <span
                  v-for="i in pageCount"
                  :key="i"
                  class="launchpad-dot"
                  :class="{ 'launchpad-dot--active': page === i - 1 }"
                  @click="page = i - 1"
                ></span>
              </div>
              <button class="launchpad-arrow" :disabled="page === pageCount - 1" @click="nextPage">
                <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                  <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
                </svg>
              </button>
            </div>
            <DragOverlay :drop-animation="null">
              <quick-link-drag-overlay :data="activeDndData" />
            </DragOverlay>
          </DragDropProvider>
        </div>
      </el-overlay>
    </Transition>

    <!-- 右键菜单 -->
    <quick-link-context-menu
      ref="ctxMenuRef"
      :refresh-fn="refreshDebounced"
      :on-open-edit-dialog="props.onOpenEditDialog"
      :popper-class="popperClass"
      show-edit
      show-move
      :on-pin="pinToGroup"
      :on-move="moveToGroup"
      @visible-change="(v: boolean) => (ctxMenuOpen = v)"
    />
    <quick-link-group-select-dialog ref="groupSelectDialogRef" />
  </Teleport>
</template>

<style lang="scss">
.launchpad-overlay {
  overflow: hidden;
  backdrop-filter: blur(40px) saturate(1.5);
}

.launchpad-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  height: 100%;
  max-height: 100dvh;
  padding: 60px 40px 90px;

  @media (width <= 500px) {
    padding: 40px 20px 90px;
  }
}

.launchpad-search {
  display: flex;
  gap: 5px;
  align-items: center;
  width: 320px;
  max-width: 90dvw;
  margin-bottom: 48px;

  @media (width <= 500px) {
    margin-bottom: 30px;
  }

  &__input {
    --el-input-bg-color: rgb(255 255 255 / 20%);
    --el-input-border-color: rgb(255 255 255 / 30%);
    --el-input-hover-border-color: rgb(255 255 255 / 60%);
    --el-input-focus-border-color: rgb(255 255 255 / 80%);
    --el-input-text-color: #fff;
    --el-input-placeholder-color: rgb(255 255 255 / 55%);
    --el-input-clear-hover-color: #fff;

    .el-input__wrapper {
      backdrop-filter: blur(10px);
    }
  }
}

.launchpad-settings {
  position: absolute;
  top: 25px;
  right: 35px;
  color: rgb(255 255 255 / 30%);

  @media (width <= 480px) {
    position: static;
  }
}

.launchpad-group-add {
  position: absolute;
  top: 25px;
  right: 82px;
  color: rgb(255 255 255 / 30%);

  @media (width <= 480px) {
    position: static;
  }
}

.launchpad-grouped {
  flex: 1;
  width: 100%;
  max-width: 1000px;
  overflow: auto;

  .el-scrollbar__view {
    padding-right: 10px;
  }
}

.launchpad-group {
  padding: 0 5px;
  margin-bottom: 28px;
}

.launchpad-group__header {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.launchpad-group__title {
  --quick-links-group-title-color: rgb(255 255 255 / 82%);

  display: inline-flex;
  font-size: 15px;
  font-weight: 600;
  color: rgb(255 255 255 / 82%);
  background: transparent;
}

.launchpad-group__title-drop {
  display: inline-flex;
  border-radius: 8px;
}

.launchpad-group__title.quick-links__category-item {
  padding: 0;
  background: transparent;
  border-radius: 0;
}

.launchpad-group__actions {
  display: inline-flex;
  gap: 4px;
  align-items: center;
}

.launchpad-group__sort-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: rgb(255 255 255 / 70%);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 50%;
  transition:
    color 0.15s ease,
    background-color 0.15s ease;

  &:hover:not(:disabled),
  &:focus-visible:not(:disabled) {
    color: #fff;
    background: rgb(255 255 255 / 14%);
  }

  &:disabled {
    cursor: default;
    opacity: 0.3;
  }
}

.launchpad-group__system-title {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 400;
  color: rgb(255 255 255 / 82%);
}

.launchpad-grid {
  display: grid;
  flex: 1;
  grid-template-columns: repeat(var(--lp-cols, 7), 1fr);
  gap: 8px;
  align-content: start;
  width: 100%;
  max-width: 1000px;
}

.launchpad-grouped .launchpad-grid.quick-link-dnd-drop-target {
  min-height: 96px;
}

.launchpad-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  padding: 10px 8px;
  overflow: hidden;
  cursor: pointer;
  border-radius: 16px;
  transition:
    background-color 0.15s ease,
    transform 0.15s ease;

  &:hover:not(:has(.launchpad-item__icon--add)),
  &:focus-visible {
    background-color: rgb(255 255 255 / 12%);
  }

  &:hover,
  &:focus-visible {
    transform: scale(1.06);

    .launchpad-item__icon--add {
      background-color: rgb(255 255 255 / 25%);
    }
  }

  &__icon {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 72px;
    height: 72px;
    margin-bottom: 8px;
    overflow: hidden;
    border-radius: 18px;
    transition: 0.15s ease;

    @media (width <= 800px) {
      width: 64px;
      height: 64px;
      border-radius: 14px;
    }

    @media (width <= 500px) {
      width: 56px;
      height: 56px;
      border-radius: 12px;
    }

    img {
      width: 75%;
      height: 75%;
      object-fit: contain;
      border-radius: 10px;
    }

    &--add {
      font-size: 38px;
      color: rgb(255 255 255 / 85%);
      background-color: rgb(255 255 255 / 15%);
    }
  }

  &__label {
    font-size: 12px;
    font-weight: 500;
    color: #fff;
    text-shadow: 0 1px 4px rgb(0 0 0 / 40%);
  }
}

.launchpad-empty {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  justify-content: center;
  height: 200px;
  font-size: 16px;
  color: rgb(255 255 255 / 50%);
}

.launchpad-pagination {
  display: flex;
  flex-shrink: 0;
  gap: 12px;
  align-items: center;
  margin-top: 32px;
}

.launchpad-dots {
  display: flex;
  gap: 8px;
}

.launchpad-dot {
  width: 7px;
  height: 7px;
  cursor: pointer;
  background-color: rgb(255 255 255 / 35%);
  border-radius: 50%;
  transition:
    background-color 0.2s ease,
    transform 0.2s ease;

  &:hover {
    background-color: rgb(255 255 255 / 65%);
  }

  &--active {
    background-color: #fff;
    transform: scale(1.2);
  }
}

.launchpad-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  overflow: hidden;
  color: rgb(255 255 255 / 70%);
  cursor: pointer;
  background: rgb(255 255 255 / 12%);
  border: none;
  border-radius: 50%;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;

  &:hover:not(:disabled) {
    color: #fff;
    background: rgb(255 255 255 / 25%);
  }

  &:disabled {
    cursor: default;
    opacity: 0.3;
  }
}

/* ---- 入场/离场动画 ---- */
.launchpad-fade-enter-active,
.launchpad-fade-leave-active {
  transition:
    opacity 0.3s ease,
    backdrop-filter 0.3s ease;

  .launchpad-wrapper {
    transition: transform 0.3s ease;
  }
}

.launchpad-fade-enter-from,
.launchpad-fade-leave-to {
  opacity: 0;

  .launchpad-wrapper {
    transform: scale(1.05);
  }
}

/* ---- 翻页动画（下一页：右→左）---- */
.launchpad-page-enter-active,
.launchpad-page-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.launchpad-page-enter-from {
  opacity: 0;
  transform: translateX(24px);
}

.launchpad-page-leave-to {
  opacity: 0;
  transform: translateX(-24px);
}

/* ---- 翻页动画（上一页：左→右）---- */
.launchpad-page-back-enter-active,
.launchpad-page-back-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.launchpad-page-back-enter-from {
  opacity: 0;
  transform: translateX(-24px);
}

.launchpad-page-back-leave-to {
  opacity: 0;
  transform: translateX(24px);
}
</style>
