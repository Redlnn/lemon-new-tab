<script setup lang="ts">
import { useDebounceFn, useEventListener, useResizeObserver, useWindowSize } from '@vueuse/core'

import ChevronLeft20Filled from '~icons/fluent/chevron-left-20-filled'
import ChevronRight20Filled from '~icons/fluent/chevron-right-20-filled'

import { useSettingsStore } from '@/shared/settings'
import { useShortcutStore } from '@/shared/shortcut'

import { useFocusState } from '@newtab/composables/useFocus'
import usePerfClasses from '@newtab/composables/usePerfClasses'
import { SHORTCUT_OPENED_MENU_CLOSE_FN } from '@newtab/shared/keys'
import { isOnlyTouchDevice } from '@newtab/shared/touch'

import AddShortcut from './components/AddShortcut.vue'
import ShortcutContextMenu from './components/ShortcutContextMenu.vue'
import ShortcutItem from './components/ShortcutItem.vue'
import ShortcutPaginationDots from './components/ShortcutPaginationDots.vue'
import { buildShortcutDisplayItems } from './composables/shortcutDisplayItems'
import { useShortcutData } from './composables/useShortcutData'
import { useShortcutDrag } from './composables/useShortcutDrag'
import { solveGridColumnFirst, usePagedGridLayout } from './composables/useShortcutLayout'
import { useShortcutPagination } from './composables/useShortcutPagination'
import { useTopSitesMerge } from './composables/useTopSitesMerge'

const focusStore = useFocusState()
const settings = useSettingsStore()
const shortcutStore = useShortcutStore()

const { height } = useWindowSize({ type: 'visual' })

defineProps<{
  onOpenAddDialog?: () => void
  onOpenEditDialog?: (index: number) => void
}>()

const refreshDebounced = useDebounceFn(refresh, 100)

const { topSites, shortcuts, mounted, topSitesNeedsReload } = useShortcutData(refreshDebounced)

// 合并后的完整项目列表（shortcuts + topSites）
const allItems = computed(() => buildShortcutDisplayItems(shortcuts.value, topSites.value))

const { updateMaxCols, maxFitCols, maxFitRows } = usePagedGridLayout()
const slotsPerPage = computed(() => maxFitCols.value * maxFitRows.value)
const totalItemsCount = computed(() => allItems.value.length)

// 如果用户禁用翻页，则将用于分页计算的总项目数限制为每页格子数，确保只有一页
const paginationTotalItems = computed(() =>
  !settings.shortcut.paging
    ? Math.min(totalItemsCount.value, slotsPerPage.value)
    : totalItemsCount.value,
)

// 分页逻辑
const {
  currentPage,
  totalPages,
  showPagination,
  isAnimating,
  slideDirection,
  noTransition,
  preloadTargetPage,
  prevPage,
  nextPage,
  goToPage,
  setupSwipe,
} = useShortcutPagination(paginationTotalItems, slotsPerPage)

// 是否在指定页显示添加按钮
function showAddButtonForPage(pageIndex: number) {
  return pageIndex === totalPages.value - 1
}

// 是否在当前页显示添加按钮（始终在最后一页的最后一格）
const showAddButton = computed(() => showAddButtonForPage(currentPage.value))

// 获取指定页的项目
function getPageItems(pageIndex: number) {
  if (pageIndex < 0 || pageIndex >= totalPages.value) {
    return []
  }

  const slots = slotsPerPage.value
  const startIndex = pageIndex * slots
  const isLastPage = pageIndex === totalPages.value - 1

  // 计算最大项目数，最后一页限制为 slots - 1
  const maxItems = isLastPage ? slots - 1 : slots
  return allItems.value.slice(startIndex, startIndex + maxItems)
}

// 当前页显示的项目
const currentPageItems = computed(() => getPageItems(currentPage.value))

// 前一页的项目（用于预加载）
const prevPageItems = computed(() => {
  // 如果有预加载目标页且向右跳（目标页 < 当前页），将目标页内容加载到 prev 位置
  if (preloadTargetPage.value !== null && preloadTargetPage.value < currentPage.value) {
    return getPageItems(preloadTargetPage.value)
  }
  return getPageItems(currentPage.value - 1)
})

// 后一页的项目（用于预加载）
const nextPageItems = computed(() => {
  // 如果有预加载目标页且向左跳（目标页 > 当前页），将目标页内容加载到 next 位置
  if (preloadTargetPage.value !== null && preloadTargetPage.value > currentPage.value) {
    return getPageItems(preloadTargetPage.value)
  }
  return getPageItems(currentPage.value + 1)
})

// 前一页是否显示添加按钮（避免模板中重复计算）
const showPrevPageAddButton = computed(() => {
  const pageIndex =
    preloadTargetPage.value !== null && preloadTargetPage.value < currentPage.value
      ? preloadTargetPage.value
      : currentPage.value - 1
  return showAddButtonForPage(pageIndex)
})

// 后一页是否显示添加按钮（避免模板中重复计算）
const showNextPageAddButton = computed(() => {
  const pageIndex =
    preloadTargetPage.value !== null && preloadTargetPage.value > currentPage.value
      ? preloadTargetPage.value
      : currentPage.value + 1
  return showAddButtonForPage(pageIndex)
})

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

function openCtxMenu(
  event: MouseEvent | PointerEvent,
  item: { url: string; title: string; isPinned: boolean; originalIndex: number },
): void {
  // 关闭上一个
  if (openedMenuCloseFn.value) {
    openedMenuCloseFn.value()
  }
  ctxMenuRef.value?.open(event, item)
  openedMenuCloseFn.value = () => ctxMenuRef.value?.close()
}

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
  // 多页 → 固定布局
  if (totalPages.value > 1) {
    return { cols: maxFitCols.value, rows: maxFitRows.value }
  }
  const currentCount = currentPageItems.value.length
  const isLastPage = currentPage.value === totalPages.value - 1
  // 单页 → 根据内容收缩
  return solveGridColumnFirst(
    isLastPage ? currentCount + 1 : currentCount,
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

async function refresh() {
  // 刷新时重置打开的菜单，防止布局或数据变化导致索引失效
  if (openedMenuCloseFn.value) {
    openedMenuCloseFn.value()
    openedMenuCloseFn.value = null
  }

  shortcuts.value = shortcutStore.items.slice()

  // 合并最常访问
  if (settings.shortcut.topSites) {
    topSites.value = await useTopSitesMerge({
      shortcuts: shortcuts.value,
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
}

const { isDragging } = useShortcutDrag(currentPageContainerRef, shortcuts, refreshDebounced)

// 设置滑动手势支持（绑定到 slide-viewport，以便切换时能切换 overflow）
setupSwipe(
  shortcutContainerRef,
  prevPageContainerRef,
  currentPageContainerRef,
  nextPageContainerRef,
  isDragging,
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
    if (isDragging.value) return
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
</script>

<template>
  <section
    class="shortcut"
    :style="{
      opacity: isHideShortcut,
      paddingTop: `${settings.shortcut.marginTop / 2}px`,
      marginTop: height > 500 ? `${settings.shortcut.marginTop / 2}px` : undefined,
    }"
  >
    <div ref="shortcutWrapperRef" class="shortcut__wrapper">
      <div class="shortcut__wrapper-inner">
        <!-- 左翻页按钮 -->
        <button
          v-if="showPagination && !isOnlyTouchDevice"
          class="shortcut__nav-btn--prev"
          :class="[
            { 'shortcut__nav-btn--disabled': currentPage === 0 || isAnimating },
            navBtnPerfClass,
          ]"
          :disabled="currentPage === 0 || isAnimating"
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
                v-if="currentPage > 0"
                ref="prevPageContainerRef"
                class="shortcut__container shortcut__container--page shortcut__container--prev"
                :class="[...containerBaseClasses, containerAnimationClasses]"
                :style="containerGridStyle"
              >
                <shortcut-item
                  v-for="item in prevPageItems"
                  :key="`${item.isPinned ? 'pin' : 'top'}-${item.originalIndex}`"
                  v-memo="[item.url, item.title, item.favicon, item.isPinned]"
                  :url="item.url"
                  :title="item.title"
                  :favicon="item.favicon"
                  :pined="item.isPinned"
                  :on-context-menu="(e) => openCtxMenu(e, item)"
                />
                <add-shortcut
                  v-if="showPrevPageAddButton"
                  :show-button="true"
                  :tabindex="false"
                  :on-open="onOpenAddDialog"
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
                  :key="`${item.isPinned ? 'pin' : 'top'}-${item.originalIndex}`"
                  v-memo="[item.url, item.title, item.favicon, item.isPinned]"
                  :url="item.url"
                  :title="item.title"
                  :favicon="item.favicon"
                  :pined="item.isPinned"
                  :on-context-menu="(e) => openCtxMenu(e, item)"
                  :tabindex="focusStore.isFocused ? -1 : 0"
                />

                <!-- 添加快捷方式按钮（始终在最后一页最后一格） -->
                <add-shortcut :show-button="showAddButton" :on-open="onOpenAddDialog" />
              </div>

              <!-- 后一页 -->
              <div
                v-if="currentPage < totalPages - 1"
                ref="nextPageContainerRef"
                class="shortcut__container shortcut__container--page shortcut__container--next"
                :class="[...containerBaseClasses, containerAnimationClasses]"
                :style="containerGridStyle"
              >
                <shortcut-item
                  v-for="item in nextPageItems"
                  :key="`${item.isPinned ? 'pin' : 'top'}-${item.originalIndex}`"
                  v-memo="[item.url, item.title, item.favicon, item.isPinned]"
                  :url="item.url"
                  :title="item.title"
                  :favicon="item.favicon"
                  :pined="item.isPinned"
                  :on-context-menu="(e) => openCtxMenu(e, item)"
                />
                <add-shortcut
                  v-if="showNextPageAddButton"
                  :show-button="true"
                  :tabindex="false"
                  :on-open="onOpenAddDialog"
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
            { 'shortcut__nav-btn--disabled': currentPage === totalPages - 1 || isAnimating },
            navBtnPerfClass,
          ]"
          :disabled="currentPage === totalPages - 1 || isAnimating"
          @click="nextPage"
        >
          <el-icon :size="20">
            <chevron-right20-filled />
          </el-icon>
        </button>
      </div>

      <!-- 页数指示器 -->
      <shortcut-pagination-dots
        v-if="showPagination"
        :current-page="currentPage"
        :total-pages="totalPages"
        @goto="goToPage"
      />
    </div>

    <!-- 共享右键菜单 -->
    <shortcut-context-menu
      ref="ctxMenuRef"
      :refresh-fn="refreshDebounced"
      :on-open-edit-dialog="onOpenEditDialog"
      :popper-class="popperClass"
      show-edit
    />
  </section>
</template>
