<script setup lang="ts">
import '@newtab/styles/quick-links.scss'
import { OnLongPress } from '@vueuse/components'
import { useDebounceFn, useResizeObserver, useWindowSize } from '@vueuse/core'
import { defineAsyncComponent } from 'vue'

import { useTranslation } from 'i18next-vue'
import Apps24Regular from '~icons/fluent/apps-24-regular'
import AddRound from '~icons/ic/round-add'

import {
  DEFAULT_QUICK_LINK_GROUP_ID,
  useQuickLinksStore,
  type QuickLinkTarget,
} from '@/shared/quickLinks'
import { useSettingsStore } from '@/shared/settings'

import { useFocusState } from '@newtab/composables/useFocus'
import usePerfClasses from '@newtab/composables/usePerfClasses'
import { isTouchEvent } from '@newtab/shared/touch'

import FaviconImage from './components/FaviconImage.vue'
import QuickLinkContextMenu from './components/QuickLinkContextMenu.vue'
import QuickLinkGroupSelectDialog from './components/QuickLinkGroupSelectDialog.vue'
import type { CtxQuickLinkItem } from './composables/useQuickLinkContextMenu'
import { useQuickLinkGroupActions } from './composables/useQuickLinkGroupActions'
import { useDockLayout } from './composables/useQuickLinksLayout'
import { mergeTopSites } from './composables/useTopSitesMerge'
import { rawTopSites } from './utils/topSites'

const Launchpad = defineAsyncComponent(() => import('./Launchpad.vue'))

const props = defineProps<{
  ready: boolean
  onOpenAddDialog?: (groupId?: string) => void
  onOpenEditDialog?: (target: QuickLinkTarget) => void
}>()

const { t } = useTranslation()
const focusStore = useFocusState()
const settings = useSettingsStore()
const quickLinksStore = useQuickLinksStore()

const perf = usePerfClasses(() => ({
  transparent: settings.perf.quickLinks.transparent,
  transparency: settings.perf.quickLinks.transparency,
  blur: settings.perf.quickLinks.blur,
}))

const popperClass = perf('quick-links__menu-popper')

const quickLinksTransparencyEnabled = computed(
  () => settings.perf.quickLinks.transparent && settings.perf.quickLinks.transparency > 0,
)
const quickLinksBlurEnabled = computed(
  () => quickLinksTransparencyEnabled.value && settings.perf.quickLinks.blur,
)
const dockClass = perf('dock')
const dockTooltipClass = computed(
  () =>
    `dock-tooltip noselect${quickLinksTransparencyEnabled.value ? ' dock-tooltip--opacity' : ''}${quickLinksBlurEnabled.value ? ' dock-tooltip--blur' : ''}`,
)

const { updateMaxCols, maxFitCols } = useDockLayout()

const refreshDebounced = useDebounceFn(refresh, 100)
const quickLinks = computed(() =>
  settings.quickLinks.grouping
    ? quickLinksStore.getDefaultGroupItems().slice()
    : quickLinksStore.items.slice(),
)
const topSites = computed(() =>
  settings.dock.topSites
    ? mergeTopSites(rawTopSites.value, {
        quickLinks: quickLinks.value,
        noCap: true,
      })
    : [],
)

async function refresh() {
  await refreshDockScaleLayout()
}

// 根据屏幕宽度初始两个区块的可见项目
const visibleQuickLinksData = computed(() => quickLinks.value.slice(0, maxFitCols.value))
const visibleTopSites = computed(() =>
  topSites.value.slice(0, Math.max(0, maxFitCols.value - visibleQuickLinksData.value.length)),
)

// 屏幕尺寸变化时更新最大列数
// useResizeObserver 会在开始观察时立即触发一次，因此不需要额外的 onMounted 刷新调用
useResizeObserver(document.documentElement, () => {
  updateMaxCols()
  refreshDebounced()
})

watch(
  () => [settings.dock.iconSize, settings.dock.limitCount, settings.dock.maxCount],
  async () => {
    updateMaxCols()
    await refreshDebounced()
  },
)

watch(
  () => settings.dock.topSites,
  () => {
    refreshDebounced()
  },
)

const isHideDock = computed(() => {
  if (!props.ready) return '0'
  if (!focusStore.isFocused) return '1'
  return settings.dock.showOnSearchFocus ? '1' : '0'
})

// ---- Dock 缩放逻辑（正弦波曲线，直接操作 DOM CSS 变量，不走响应式）----
const { width: windowWidth } = useWindowSize({ type: 'visual' })

const CURVE_RANGE = computed(() => {
  if (windowWidth.value <= 600) return 130
  else if (windowWidth.value <= 800) return 150
  else if (windowWidth.value <= 1000) return 180
  else return 200
})
const TRANSITION_DURATION = '0.1s'
const MIN_SCALE = 1
const MAX_SCALE = computed(() => {
  if (windowWidth.value <= 600) return 1.3
  else if (windowWidth.value <= 800) return 1.4
  else if (windowWidth.value <= 1000) return 1.5
  else return 1.6
})

const dockRef = ref<HTMLElement | null>(null)
// 按文档顺序存放所有需缩放的元素（item 与 gap 交替）
// 动态部分（v-for 生成）：每次更新前清空后重新收集
const scalableDynEls = shallowRef<HTMLElement[]>([])
// 静态部分（不在 v-for 内）：只在挂载时收集，不受 onBeforeUpdate 影响
const addBtnEl = ref<HTMLElement | null>(null)
// 启动台入口（静态）
const launchpadBtnEl = ref<HTMLElement | null>(null)
const showLaunchpad = ref(false)
const launchpadLoaded = ref(false)

// 合并动态+静态，供 cacheNaturalCenters / updateScales 使用
const scalableEls = computed(() => {
  const els: HTMLElement[] = []
  if (launchpadBtnEl.value) els.push(launchpadBtnEl.value)
  els.push(...scalableDynEls.value)
  if (addBtnEl.value) els.push(addBtnEl.value)
  return els
})
// 缓存元素在 scale=1 时的中心点 X 坐标，避免放大后位置偏移导致波形变形
let naturalCenters: number[] = []

function cacheNaturalCenters(): void {
  naturalCenters = scalableEls.value.map((el) => {
    if (!el) return 0
    const { left, width } = el.getBoundingClientRect()
    return left + width / 2
  })
}

function scaleCurve(curveCentreX: number, itemCentreX: number): number {
  const range = CURVE_RANGE.value
  const beginX = curveCentreX - range / 2
  const endX = curveCentreX + range / 2
  if (itemCentreX < beginX || itemCentreX > endX) return MIN_SCALE
  const amplitude = MAX_SCALE.value - MIN_SCALE
  const angle = ((itemCentreX - beginX) / range) * Math.PI
  return Math.sin(angle) * amplitude + MIN_SCALE
}

function updateScales(clientX: number | null): void {
  const els = scalableEls.value
  for (let i = 0; i < els.length; i++) {
    const el = els[i]
    if (!el) continue
    // 优先使用缓存的自然中心点，保证波形形状不随元素大小变化
    const center =
      naturalCenters[i] ?? el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2
    const scale = clientX === null ? MIN_SCALE : scaleCurve(clientX, center)
    el.style.setProperty('--scale', String(scale))
  }
}

async function refreshDockScaleLayout() {
  await nextTick()
  cacheNaturalCenters()
  updateScales(null)
  requestAnimationFrame(() => {
    cacheNaturalCenters()
    updateScales(null)
  })
  window.setTimeout(() => {
    cacheNaturalCenters()
    updateScales(null)
  }, 180)
}

let transitionTimer: ReturnType<typeof setTimeout> | null = null

// 追踪当前交互是否来自触屏，用于混合设备（鼠标+触屏）的判断
const isUsingTouch = ref(false)

function onPointerEnter(e: PointerEvent): void {
  isUsingTouch.value = e.pointerType !== 'mouse'
}

function applyTransition(duration: string): void {
  dockRef.value?.style.setProperty('--td', duration)
}

function onMouseEnter(e: MouseEvent): void {
  if (!settings.perf.dockScale || isUsingTouch.value) return

  if (transitionTimer) clearTimeout(transitionTimer)
  applyTransition(TRANSITION_DURATION)
  transitionTimer = setTimeout(() => applyTransition('0s'), 80)
  cacheNaturalCenters() // 在缩放发生前缓存自然位置
  updateScales(e.clientX)
}

function onMouseMove(e: MouseEvent): void {
  if (!settings.perf.dockScale || isUsingTouch.value) return

  updateScales(e.clientX)
}

function onMouseLeave(): void {
  if (!settings.perf.dockScale || isUsingTouch.value) return

  if (transitionTimer) clearTimeout(transitionTimer)
  applyTransition(TRANSITION_DURATION)
  updateScales(null)
  transitionTimer = setTimeout(() => applyTransition('0s'), 80)
}

// 每次 DOM 更新前只清空动态部分，静态元素 ref 不受影响
onBeforeUpdate(() => {
  scalableDynEls.value = []
})

function setScalableRef(el: unknown): void {
  let node: HTMLElement | null = null
  if (el instanceof HTMLElement) {
    node = el
  } else if (
    el !== null &&
    typeof el === 'object' &&
    '$el' in el &&
    el.$el instanceof HTMLElement
  ) {
    node = el.$el
  }
  if (node) scalableDynEls.value.push(node)
}

function setAddBtnRef(el: unknown): void {
  addBtnEl.value = el instanceof HTMLElement ? el : null
}

function setLaunchpadBtnRef(el: unknown): void {
  launchpadBtnEl.value = el instanceof HTMLElement ? el : null
}

// ---- 右键上下文菜单 ----
const ctxMenuRef = useTemplateRef<InstanceType<typeof QuickLinkContextMenu>>('ctxMenuRef')
const groupSelectDialogRef =
  useTemplateRef<InstanceType<typeof QuickLinkGroupSelectDialog>>('groupSelectDialogRef')

function openDockItemMenu(
  event: MouseEvent | TouchEvent | PointerEvent,
  item: { url: string; title?: string },
  isPinned: boolean,
  originalIndex: number,
): void {
  ctxMenuRef.value?.open(event, {
    url: item.url,
    title: item.title || '',
    isPinned,
    originalIndex,
    groupId: isPinned && settings.quickLinks.grouping ? DEFAULT_QUICK_LINK_GROUP_ID : undefined,
  })
}

function onItemContextmenu(
  event: MouseEvent | TouchEvent | PointerEvent,
  item: { url: string; title?: string },
  isPinned: boolean,
  originalIndex: number,
): void {
  openDockItemMenu(event, item, isPinned, originalIndex)
}

function onItemLongPress(
  event: PointerEvent,
  item: { url: string; title?: string },
  isPinned: boolean,
  originalIndex: number,
): void {
  if (isTouchEvent(event)) {
    openDockItemMenu(event, item, isPinned, originalIndex)
  }
}

const { pinToGroup, moveToGroup } = useQuickLinkGroupActions({
  groupSelectDialogRef,
  refresh: refreshDebounced,
  t,
})

function getDockQuickLinkCount() {
  if (!settings.quickLinks.grouping) return quickLinksStore.items.length
  return quickLinksStore.getGroupItemCount(DEFAULT_QUICK_LINK_GROUP_ID)
}

function canMoveDockQuickLinkLeft(item: CtxQuickLinkItem) {
  return item.isPinned && item.originalIndex > 0
}

function canMoveDockQuickLinkRight(item: CtxQuickLinkItem) {
  return item.isPinned && item.originalIndex < getDockQuickLinkCount() - 1
}

async function moveDockQuickLink(item: CtxQuickLinkItem, direction: -1 | 1) {
  if (!item.isPinned) return
  const fromIndex = item.originalIndex
  const toIndex = fromIndex + direction
  if (toIndex < 0 || toIndex >= getDockQuickLinkCount()) return
  try {
    const changed = settings.quickLinks.grouping
      ? await quickLinksStore.moveQuickLink({
          fromGroupId: DEFAULT_QUICK_LINK_GROUP_ID,
          fromIndex,
          toGroupId: DEFAULT_QUICK_LINK_GROUP_ID,
          toIndex,
        })
      : await quickLinksStore.moveFlatQuickLink({
          fromIndex,
          toIndex,
        })
    if (changed) await refreshDebounced()
  } catch (error) {
    console.error('[dock] Failed to move quick link:', error)
    ElMessage.error(t('quickLinks.moveError'))
    await refreshDebounced()
  } finally {
    await refreshDockScaleLayout()
  }
}

function openAddQuickLink() {
  props.onOpenAddDialog?.(settings.quickLinks.grouping ? DEFAULT_QUICK_LINK_GROUP_ID : undefined)
}

function toggleLaunchpad() {
  launchpadLoaded.value = true
  showLaunchpad.value = !showLaunchpad.value
}

defineExpose({ refresh, toggleLaunchpad })
</script>

<template>
  <div
    ref="dockRef"
    class="dock noselect"
    :class="dockClass"
    :style="{
      opacity: isHideDock,
      pointerEvents: isHideDock === '0' ? 'none' : 'auto',
      '--item-size': settings.dock.iconSize + 'px',
      '--item-ratio': settings.dock.iconRatio * 100 + '%',
      '--dock-icon-inset': (settings.dock.iconSize * (1 - settings.dock.iconRatio)) / 2 + 'px',
      '--dock-radius': settings.dock.borderRadius + 'px',
      '--gap-size': settings.dock.gap + 'px',
    }"
    @pointerenter="onPointerEnter"
    @mouseenter="onMouseEnter"
    @mousemove="onMouseMove"
    @mouseleave="onMouseLeave"
    @contextmenu.stop.prevent
    @dragstart.prevent
  >
    <!-- 启动台固定入口 -->
    <template v-if="settings.dock.launchpad.enabled">
      <el-tooltip
        :content="t('dock.launchpad.title')"
        placement="top"
        effect="light"
        :hide-after="0"
        :show-arrow="false"
        :enterable="false"
        :disabled="isUsingTouch"
        transition="none"
        :popper-class="dockTooltipClass"
      >
        <div
          role="button"
          tabindex="0"
          class="dock-item"
          :aria-label="t('dock.launchpad.title')"
          :ref="setLaunchpadBtnRef"
          @click="toggleLaunchpad"
          @keydown.enter.prevent="toggleLaunchpad"
          @keydown.space.prevent="toggleLaunchpad"
        >
          <apps24-regular />
        </div>
      </el-tooltip>
      <div v-if="settings.dock.launchpad.enabled" class="dock-gap" :ref="setScalableRef"></div>
    </template>
    <template v-for="(item, idx) in visibleQuickLinksData" :key="`pin-${idx}`">
      <el-tooltip
        :content="item.title"
        placement="top"
        effect="light"
        :hide-after="0"
        :show-arrow="false"
        :enterable="false"
        :disabled="isUsingTouch"
        transition="none"
        :popper-class="dockTooltipClass"
      >
        <a
          class="dock-item"
          draggable="false"
          :href="item.url"
          :ref="setScalableRef"
          :aria-label="item.title"
          :target="settings.dock.openInNewTab ? '_blank' : '_self'"
          :rel="settings.dock.openInNewTab ? 'noopener noreferrer' : undefined"
          @contextmenu.stop.prevent="onItemContextmenu($event, item, true, idx)"
        >
          <favicon-image :url="item.url" :favicon="item.favicon" alt="" />
        </a>
      </el-tooltip>
      <div
        v-if="idx !== visibleQuickLinksData.length - 1"
        class="dock-gap"
        :ref="setScalableRef"
      ></div>
    </template>
    <template v-if="visibleQuickLinksData.length > 0 && visibleTopSites.length > 0">
      <div class="dock-gap" :ref="setScalableRef"></div>
      <div class="dock-separator"></div>
      <div class="dock-gap" :ref="setScalableRef"></div>
    </template>
    <template v-for="(item, j) in visibleTopSites" :key="`top-${j}`">
      <el-tooltip
        :content="item.title"
        placement="top"
        effect="light"
        :hide-after="0"
        :show-arrow="false"
        :enterable="false"
        :disabled="isUsingTouch"
        transition="none"
        :popper-class="dockTooltipClass"
      >
        <OnLongPress
          as="a"
          class="dock-item"
          draggable="false"
          :href="item.url"
          :ref="setScalableRef"
          :aria-label="item.title"
          :target="settings.dock.openInNewTab ? '_blank' : '_self'"
          :rel="settings.dock.openInNewTab ? 'noopener noreferrer' : undefined"
          @contextmenu.stop.prevent="onItemContextmenu($event, item, false, j)"
          @trigger="onItemLongPress($event, item, false, j)"
        >
          <favicon-image :url="item.url" :favicon="item.favicon" alt="" />
        </OnLongPress>
      </el-tooltip>
      <div v-if="j !== visibleTopSites.length - 1" class="dock-gap" :ref="setScalableRef"></div>
    </template>
    <template v-if="!settings.dock.launchpad.enabled">
      <div class="dock-gap" :ref="setScalableRef"></div>
      <div class="dock-separator"></div>
      <div class="dock-gap" :ref="setScalableRef"></div>
    </template>
    <template v-if="!settings.dock.launchpad.enabled">
      <div class="dock-item" :ref="setAddBtnRef" @click="openAddQuickLink">
        <add-round />
      </div>
    </template>

    <!-- 启动台覆盖层 -->
    <Launchpad
      v-if="launchpadLoaded"
      v-model="showLaunchpad"
      :on-open-add-dialog="props.onOpenAddDialog"
      :on-open-edit-dialog="props.onOpenEditDialog"
    />

    <!-- 共享右键菜单 -->
    <quick-link-context-menu
      ref="ctxMenuRef"
      placement="top-start"
      :popper-class="popperClass"
      show-edit
      :show-move="settings.quickLinks.grouping"
      :refresh-fn="refreshDebounced"
      :on-open-edit-dialog="props.onOpenEditDialog"
      :on-pin="pinToGroup"
      :on-move="moveToGroup"
      show-sort-actions
      :can-move-left="canMoveDockQuickLinkLeft"
      :can-move-right="canMoveDockQuickLinkRight"
      :on-move-left="(item) => moveDockQuickLink(item, -1)"
      :on-move-right="(item) => moveDockQuickLink(item, 1)"
    />
    <quick-link-group-select-dialog ref="groupSelectDialogRef" />
  </div>
</template>

<style lang="scss">
@use '@newtab/styles/mixins/acrylic.scss' as acrylic;

.dock {
  --dock-background: var(--el-bg-color-overlay);
  --dock-item-background: var(--el-color-primary-light-9);
  --dock-padding: 5px;
  --dock-item-radius: max(0px, calc(var(--dock-radius) - var(--dock-padding)));
  --dock-icon-radius: max(0px, calc(var(--dock-item-radius) - var(--dock-icon-inset)));

  position: fixed;
  bottom: 20px;
  left: 50%;
  z-index: 2;
  display: flex;
  align-items: flex-end;
  max-width: 93%;
  height: calc(var(--item-size) + var(--dock-padding) * 2);
  padding: var(--dock-padding);
  background-color: var(--dock-background);
  border-radius: var(--dock-radius);
  box-shadow: 0 4px 6px rgb(0 0 0 / 10%);
  transform: translateX(-50%);
  transition:
    opacity 0.1s ease,
    bottom var(--el-transition-duration-fast) ease,
    background-color var(--el-transition-duration-fast) ease;

  &--blur {
    @include acrylic.acrylic(var(--le-quick-links-backdrop-blur, 10px), 1.2, 1.1);
  }

  &--opacity {
    --dock-background: var(--le-bg-color-overlay-quick-links);
    --dock-item-background: var(--le-bg-color-overlay-quick-links-strong);
  }
}

html.colorful .dock:not(.dock--opacity) {
  --dock-background: var(--el-color-primary-light-9);
  --dock-item-background: var(--el-color-primary-light-8);
}

.app:has(.yiyan) {
  .dock {
    @media (height <= 800px) {
      bottom: 10px;
    }
  }
}

.dock-item {
  display: inline-flex;
  flex-shrink: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: calc(var(--scale, 1) * var(--item-size));
  height: calc(var(--scale, 1) * var(--item-size));
  overflow: hidden;
  cursor: pointer;
  background-color: var(--dock-item-background);
  border-radius: calc(var(--scale, 1) * var(--dock-item-radius));
  transition:
    width var(--td, 0s),
    height var(--td, 0s),
    border-radius var(--td, 0s),
    background-color var(--el-transition-duration-fast) ease;

  img {
    width: 75%;
    width: var(--item-ratio);
    height: var(--item-ratio);
    object-fit: cover;
    border-radius: calc(var(--scale, 1) * var(--dock-icon-radius));
    transition:
      border-radius var(--td, 0s),
      opacity 0.1s ease;

    &.favicon-image--pending {
      opacity: 0;
    }
  }

  svg {
    width: var(--item-ratio);
    height: var(--item-ratio);
    border-radius: 6px;
  }

  &:focus-visible {
    outline: 2px solid var(--el-color-primary);
    outline-offset: -2px;
  }
}

.dock-gap {
  width: calc(var(--scale, 1) * var(--gap-size));
  min-width: var(--gap-size);
  height: calc(var(--scale, 1) * var(--item-size));
  margin-bottom: calc((var(--scale, 1) - 1) * var(--item-size));
  transition:
    width var(--td, 0s),
    height var(--td, 0s),
    margin-bottom var(--td, 0s);
}

.dock-separator {
  align-self: center;
  width: 1px;
  height: 60%;
  background-color: rgb(255 255 255 / 50%);
}

.dock-tooltip.el-popper {
  --dock-tooltip-background: var(--el-bg-color-overlay);

  background: var(--dock-tooltip-background);
  border: none;

  &.dock-tooltip--opacity {
    --dock-tooltip-background: var(--le-bg-color-overlay-quick-links-tooltip);
  }

  &.dock-tooltip--blur {
    @include acrylic.acrylic(var(--le-quick-links-tooltip-backdrop-blur, 10px), 1.3, 1.4);
  }
}

html.colorful .dock-tooltip {
  --dock-tooltip-background: var(--el-color-primary-light-7);

  &.dock-tooltip--opacity {
    --dock-tooltip-background: var(--le-bg-color-overlay-quick-links-tooltip);
  }
}
</style>
