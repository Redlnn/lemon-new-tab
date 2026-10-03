<script setup lang="ts">
import { useIntersectionObserver, useResizeObserver } from '@vueuse/core'

import type { QuickLinkViewItem } from '../composables/quickLinksViewModel'
import type { QuickLinkDndData } from '../composables/useQuickLinkDnd'
import { useVirtualGridViewport } from '../composables/useVirtualGridViewport'
import { virtualItemKey, type VirtualQuickLinkDnd } from '../composables/useVirtualQuickLinkDnd'

import QuickLinkDropTarget from './QuickLinkDropTarget.vue'

const props = defineProps<{
  items: QuickLinkViewItem[]
  columns: number
  groupId: string
  data: QuickLinkDndData
  id: string
  disabled?: boolean
  add?: boolean
  endTarget?: () => HTMLElement | undefined
  controller: VirtualQuickLinkDnd
}>()
const target = ref<InstanceType<typeof QuickLinkDropTarget>>()
const element = computed(() => target.value?.$el as HTMLElement | undefined)
const rowHeight = ref(96)
const gap = ref(0)
const bounds = ref({ top: 0, bottom: 600 })
const focusedKey = ref<string | null>(null)
const nearViewport = ref(false)
const { scrollVersion, viewport } = useVirtualGridViewport()
const scrollRoot = computed(() => {
  for (let parent = element.value?.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent
  }
  return null
})
let frame = 0
const stride = computed(() => rowHeight.value + gap.value)
const rows = computed(() => Math.ceil((props.items.length + Number(props.add)) / props.columns))
const keyIndices = computed(
  () => new Map(props.items.map((item, index) => [virtualItemKey(item), index])),
)
const indices = computed(() => {
  const first = Math.max(0, Math.floor(bounds.value.top / stride.value) - 3) * props.columns
  const last = Math.min(
    props.items.length,
    (Math.ceil(bounds.value.bottom / stride.value) + 3) * props.columns,
  )
  const set = new Set<number>()
  if (nearViewport.value) {
    for (let index = first; index < last; index++) set.add(index)
  }
  // 单个测量格保留真实主题/字体尺寸，不为测量挂载整个列表。
  if (props.items.length) set.add(0)
  const source = props.controller.source.value
  for (const key of [
    focusedKey.value,
    source ? `${source.origin === 'pinned' ? 'pin' : 'top'}:${source.id ?? source.url}` : null,
  ]) {
    const index = key ? keyIndices.value.get(key) : undefined
    if (index !== undefined) set.add(index)
  }
  return [...set].sort((a, b) => a - b)
})
const position = (index: number) => ({
  gridRow: Math.floor(index / props.columns) + 1,
  gridColumn: (index % props.columns) + 1,
})

function measure(cached = false) {
  const root = element.value
  if (!root) return
  if (!cached) {
    const sample = root.querySelector<HTMLElement>(
      '[data-virtual-index="0"] > *, [data-virtual-add] > *',
    )
    const height = sample?.offsetHeight
    if (height && height !== rowHeight.value) rowHeight.value = height
    gap.value = parseFloat(getComputedStyle(root).rowGap) || 0
  }
  const rect = root.getBoundingClientRect()
  const view = viewport(root, cached)
  const top = view.top - rect.top
  const bottom = view.bottom - rect.top
  if (top !== bounds.value.top || bottom !== bounds.value.bottom) bounds.value = { top, bottom }
}
function schedule() {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => measure())
}
watch(scrollVersion, () => {
  if (nearViewport.value) measure(true)
})
useIntersectionObserver(
  element,
  ([entry]) => {
    nearViewport.value = entry?.isIntersecting ?? false
    if (nearViewport.value) schedule()
  },
  { root: scrollRoot, rootMargin: '300px 0px' },
)
useResizeObserver(element, schedule)
useResizeObserver(
  computed(() => element.value?.querySelector<HTMLElement>('.quick-links__item, .launchpad-item')),
  schedule,
)
watch(
  () => [props.items, props.columns],
  () => nextTick(schedule),
)

const registration = {
  groupId: props.groupId,
  items: () => props.items,
  columns: () => props.columns,
  enabled: () => !props.disabled,
  hit(point: { x: number; y: number }) {
    const root = element.value
    if (!root) return null
    const rect = root.getBoundingClientRect()
    const view = viewport(root)
    const header = props.endTarget?.()?.getBoundingClientRect()
    if (
      header &&
      point.x >= Math.max(view.left, header.left) &&
      point.x <= Math.min(view.right, header.right) &&
      point.y >= Math.max(view.top, header.top) &&
      point.y <= Math.min(view.bottom, header.bottom)
    )
      return props.items.length
    if (
      point.x < Math.max(view.left, rect.left) ||
      point.x > Math.min(view.right, rect.right) ||
      point.y < Math.max(view.top, rect.top) ||
      point.y > Math.min(view.bottom, rect.bottom)
    )
      return null
    const style = getComputedStyle(root)
    const padding = parseFloat(style.paddingLeft) || 0
    const columnGap = parseFloat(style.columnGap) || 0
    const unit =
      (root.clientWidth - padding - (parseFloat(style.paddingRight) || 0) + columnGap) /
      props.columns
    const x = Math.max(0, point.x - rect.left - padding)
    const column = Math.min(props.columns - 1, Math.floor(x / unit))
    const row = Math.max(0, Math.floor((point.y - rect.top) / stride.value))
    const cell = props.items[row * props.columns + column]
    if (cell && !cell.isPinned) return null
    return Math.min(
      props.items.length,
      row * props.columns + column + Number(x % unit > (unit - columnGap) / 2),
    )
  },
  async reveal(index: number, focus = false) {
    const root = element.value
    if (!root) return
    if (focus && props.items[index]) focusedKey.value = virtualItemKey(props.items[index]!)
    const rect = root.getBoundingClientRect()
    const view = viewport(root)
    const top = rect.top + Math.floor(index / props.columns) * stride.value
    const delta =
      top < view.top
        ? top - view.top
        : top + rowHeight.value > view.bottom
          ? top + rowHeight.value - view.bottom
          : 0
    let scroller = root.parentElement
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY))
      scroller = scroller.parentElement
    if (delta) (scroller ?? window).scrollBy({ top: delta })
    nearViewport.value = true
    measure()
    await nextTick()
    if (focus)
      root
        .querySelector<HTMLElement>(
          `[data-virtual-index="${index}"] [tabindex="0"], [data-virtual-index="${index}"] a`,
        )
        ?.focus({ preventScroll: true })
  },
}
onMounted(() => {
  props.controller.grids.set(props.groupId, registration)
  measure()
})
onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  props.controller.grids.delete(props.groupId)
})
const marker = computed(() =>
  props.controller.preview.value?.groupId === props.groupId
    ? props.controller.preview.value.index
    : null,
)
function handleTab(event: KeyboardEvent) {
  if (event.key !== 'Tab' || props.controller.source.value || !(event.target instanceof Element))
    return
  const cell = event.target.closest<HTMLElement>('[data-virtual-index]')
  if (!cell) return
  const index = Number(cell.dataset.virtualIndex) + (event.shiftKey ? -1 : 1)
  if (index < 0 || index >= props.items.length + Number(props.add)) return
  event.preventDefault()
  void registration.reveal(index, true)
}
</script>

<template>
  <quick-link-drop-target
    ref="target"
    :id="id"
    :data="data"
    :disabled="disabled"
    class="quick-link-virtual-grid"
    :data-virtual-group="groupId"
    @keydown.capture="handleTab"
    :style="{ gridTemplateRows: `repeat(${Math.max(1, rows)}, ${rowHeight}px)` }"
  >
    <div
      v-for="index in indices"
      :key="virtualItemKey(items[index]!)"
      class="quick-link-virtual-cell"
      :data-virtual-index="index"
      :style="position(index)"
      @focusin="focusedKey = virtualItemKey(items[index]!)"
      @focusout="focusedKey = null"
    >
      <slot :item="items[index]!" :index="index" />
    </div>
    <div
      v-if="add"
      class="quick-link-virtual-cell"
      data-virtual-add
      :data-virtual-index="items.length"
      :style="position(items.length)"
    >
      <slot name="add" />
    </div>
    <div v-if="marker !== null" class="quick-link-virtual-marker" :style="position(marker)" />
  </quick-link-drop-target>
</template>

<style>
.quick-link-virtual-grid {
  position: relative;
}

.quick-link-virtual-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-width: 0;
}

.quick-link-virtual-marker {
  z-index: 2;
  place-self: stretch start;
  width: 3px;
  height: 100%;
  pointer-events: none;
  background: var(--el-color-primary);
}
</style>
