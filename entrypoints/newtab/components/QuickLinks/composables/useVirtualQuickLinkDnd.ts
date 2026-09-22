import { onBeforeUnmount, ref } from 'vue'

import type { DragEndEvent, DragMoveEvent, DragStartEvent } from '@dnd-kit/vue'

import type { QuickLinkDisplayItem } from './quickLinkDisplayItems'
import { getDndData, type QuickLinkDndData } from './useQuickLinkDnd'

export const virtualItemKey = (item: QuickLinkDisplayItem) =>
  `${item.isPinned ? 'pin' : 'top'}:${item.id ?? item.url}`

export interface VirtualQuickLinkGrid {
  groupId: string
  items: () => QuickLinkDisplayItem[]
  columns: () => number
  enabled: () => boolean
  hit: (point: { x: number; y: number }) => number | null
  reveal: (index: number, focus?: boolean) => Promise<void>
}

type Source = Extract<QuickLinkDndData, { kind: 'quick-link' }>
export function useVirtualQuickLinkDnd() {
  const grids = new Map<string, VirtualQuickLinkGrid>()
  const source = ref<Source | null>(null)
  const preview = ref<{ groupId: string; index: number } | null>(null)
  let pointer: { x: number; y: number } | null = null
  let keyboard = false
  let frame = 0

  const locate = () => {
    if (!pointer || keyboard) return
    let next: typeof preview.value = null
    for (const grid of grids.values()) {
      if (!grid.enabled()) continue
      const index = grid.hit(pointer)
      if (index !== null) {
        next = { groupId: grid.groupId, index }
        break
      }
    }
    if (next?.groupId !== preview.value?.groupId || next?.index !== preview.value?.index) {
      preview.value = next
    }
  }

  const start = (event: DragStartEvent) => {
    const data = getDndData(event.operation.source)
    if (data?.kind !== 'quick-link') return
    source.value = data
    keyboard = event.nativeEvent instanceof KeyboardEvent
    pointer = { ...event.operation.position.current }
    const grid = grids.get(data.groupId)
    const index =
      grid?.items().findIndex((item) => (data.id ? item.id === data.id : item.url === data.url)) ??
      -1
    preview.value = index < 0 ? null : { groupId: data.groupId, index }
    const track = () => {
      locate()
      frame = requestAnimationFrame(track)
    }
    frame = requestAnimationFrame(track)
  }

  const move = (event: DragMoveEvent) => {
    if (!source.value) return
    if (!keyboard) {
      if (event.nativeEvent instanceof PointerEvent) {
        pointer = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY }
      }
      return
    }
    event.preventDefault()
    if (!(event.nativeEvent instanceof KeyboardEvent) || !preview.value) return
    const { key } = event.nativeEvent
    const next = { ...preview.value }
    const enabled = [...grids.values()].filter((grid) => grid.enabled())
    if (event.nativeEvent.altKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      const index = enabled.findIndex((grid) => grid.groupId === next.groupId)
      next.groupId =
        enabled[Math.max(0, Math.min(enabled.length - 1, index + (key === 'ArrowRight' ? 1 : -1)))]
          ?.groupId ?? next.groupId
    } else {
      const cols = grids.get(next.groupId)?.columns() ?? 1
      next.index +=
        (
          { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols } as Record<
            string,
            number
          >
        )[key] ?? 0
    }
    const grid = grids.get(next.groupId)
    if (!grid) return
    next.index = Math.max(0, Math.min(grid.items().length, next.index))
    preview.value = next
    void grid.reveal(next.index)
  }

  const destination = (event: DragEndEvent) => {
    cancelAnimationFrame(frame)
    locate()
    const drop = preview.value
    if (event.canceled || !source.value || !drop) return null
    const grid = grids.get(drop.groupId)
    if (!grid?.enabled()) return null
    const items = grid.items()
    // 常用网站不是可写排序节点；其尾部区域只能映射到固定链接的末尾。
    const pinned = items.filter((item) => item.isPinned)
    const target = items.slice(drop.index).find((item) => item.isPinned)
    let storeIndex =
      target?.originalIndex ?? (pinned.length ? pinned[pinned.length - 1]!.originalIndex + 1 : 0)
    const from = source.value
    if (from.origin === 'pinned') {
      const current = grids
        .get(from.groupId)
        ?.items()
        .find((item) => (from.id ? item.id === from.id : item.url === from.url))
      // 外部刷新改变源位置时取消这次提交，不能用拖拽开始时的过期索引移动另一项。
      if (!current || current.originalIndex !== from.storeIndex) return null
    }
    if (from.origin === 'pinned' && from.groupId === grid.groupId && from.storeIndex < storeIndex)
      storeIndex--
    return { groupId: grid.groupId, storeIndex }
  }

  const finish = async (restoreFocus = true) => {
    cancelAnimationFrame(frame)
    const oldSource = source.value
    if (restoreFocus && keyboard && oldSource) {
      for (const grid of grids.values()) {
        const index = grid
          .items()
          .findIndex((item) =>
            oldSource.id ? item.id === oldSource.id : item.url === oldSource.url,
          )
        if (index !== -1) {
          await grid.reveal(index, true)
          break
        }
      }
    }
    source.value = null
    preview.value = null
    pointer = null
  }
  onBeforeUnmount(() => {
    cancelAnimationFrame(frame)
    grids.clear()
  })
  return { grids, source, preview, start, move, destination, finish }
}

export type VirtualQuickLinkDnd = ReturnType<typeof useVirtualQuickLinkDnd>
