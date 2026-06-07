import { KeyboardSensor, PointerSensor } from '@dnd-kit/vue'

import type { QuickLink } from '@/shared/quickLinks'

export const QUICK_LINK_DND_TYPE = 'quick-link'
export const QUICK_LINK_GROUP_DND_TYPE = 'quick-link-group'
export const QUICK_LINK_GROUPS_DND_ID = 'quick-link-groups'
export const TOP_SITES_DND_GROUP_ID = '__top-sites__'
export const FLAT_QUICK_LINK_DND_GROUP_ID = 'flat'
export const QUICK_LINK_TOUCH_CONTEXT_MENU_EVENT = 'quick-link-touch-context-menu'
export const QUICK_LINK_DND_ACTIVATION_DELAY = 500
export const QUICK_LINK_DND_MOVE_THRESHOLD = 8

export type QuickLinkDndSource = 'quick-links' | 'launchpad' | 'dock'

export type QuickLinkDndData =
  | {
      kind: 'quick-link'
      source: QuickLinkDndSource
      groupId: string
      sortableIndex: number
      storeIndex: number
      url: string
      title: string
      favicon?: string
      isPinned: true
      pageIndex?: number
    }
  | {
      kind: 'quick-link-container'
      source: QuickLinkDndSource
      groupId: string
      sortableIndex: number
      storeIndex: number
      pageIndex?: number
    }
  | {
      kind: 'quick-link-group'
      source: QuickLinkDndSource
      groupId: string
      sortableIndex: number
      storeIndex: number
    }

export type QuickLinkMoveTarget = {
  groupId: string
  sortableIndex: number
  storeIndex: number
}

export type SortableMoveState = {
  fromGroupId?: string
  toGroupId?: string
  fromSortableIndex?: number
  toSortableIndex?: number
}

type PointerActivationController = {
  signal: AbortSignal
  activate(event: PointerEvent): void
  abort(event?: PointerEvent): void
}

class QuickLinkLongPressActivationConstraint {
  private controllerRef: PointerActivationController | undefined
  private initialEvent: PointerEvent | undefined
  private latestEvent: PointerEvent | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private moved = false

  constructor(private readonly options: { touchMenu: boolean }) {}

  set controller(controller: PointerActivationController) {
    this.controllerRef = controller
    controller.signal.addEventListener('abort', () => this.abort())
  }

  onEvent(event: PointerEvent) {
    if (event.type === 'pointerdown') {
      this.initialEvent = event
      this.latestEvent = event
      this.moved = false
      this.timer = setTimeout(() => this.activateOrOpenMenu(), QUICK_LINK_DND_ACTIVATION_DELAY)
      return
    }

    if (event.type === 'pointermove') {
      this.latestEvent = event
      if (!this.initialEvent) return
      const distance = Math.hypot(
        event.clientX - this.initialEvent.clientX,
        event.clientY - this.initialEvent.clientY,
      )
      if (distance > QUICK_LINK_DND_MOVE_THRESHOLD) {
        this.moved = true
        if (!this.options.touchMenu) {
          this.activateOrOpenMenu()
        }
      }
    }
  }

  abort() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.initialEvent = undefined
    this.latestEvent = undefined
    this.moved = false
  }

  private activateOrOpenMenu() {
    const event = this.latestEvent ?? this.initialEvent
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (!event) return

    if (this.options.touchMenu && !this.moved) {
      event.target?.dispatchEvent(
        new CustomEvent(QUICK_LINK_TOUCH_CONTEXT_MENU_EVENT, {
          bubbles: true,
          detail: { event: this.initialEvent ?? event },
        }),
      )
      this.controllerRef?.abort(event)
      return
    }

    this.controllerRef?.activate(event)
  }
}

export const quickLinkDndSensors = [
  PointerSensor.configure({
    activationConstraints(event) {
      return [
        new QuickLinkLongPressActivationConstraint({ touchMenu: event.pointerType === 'touch' }),
      ] as never
    },
  }),
  KeyboardSensor,
]

export function quickLinkDndId(
  source: QuickLinkDndSource,
  groupId: string,
  index: number,
  url: string,
) {
  return `${source}:quick-link:${groupId}:${index}:${url}`
}

export function quickLinkContainerDndId(
  source: QuickLinkDndSource,
  groupId: string,
  pageIndex?: number,
) {
  return `${source}:quick-link-container:${groupId}:${pageIndex ?? 'all'}`
}

export function quickLinkGroupDndId(source: QuickLinkDndSource, groupId: string) {
  return `${source}:quick-link-group:${groupId}`
}

export function toQuickLinkDndData(value: unknown): QuickLinkDndData | null {
  if (!value || typeof value !== 'object' || !('kind' in value)) return null
  const kind = (value as { kind?: unknown }).kind
  if (kind !== 'quick-link' && kind !== 'quick-link-container' && kind !== 'quick-link-group') {
    return null
  }
  return value as QuickLinkDndData
}

export function getDndData(entity: unknown): QuickLinkDndData | null {
  return toQuickLinkDndData((entity as { data?: unknown } | null | undefined)?.data)
}

export function toQuickLinkDndItem(
  item: QuickLink,
  source: QuickLinkDndSource,
  groupId: string,
  storeIndex: number,
  sortableIndex: number,
  pageIndex?: number,
): Extract<QuickLinkDndData, { kind: 'quick-link' }> {
  return {
    kind: 'quick-link',
    source,
    groupId,
    storeIndex,
    sortableIndex,
    url: item.url,
    title: item.title,
    favicon: item.favicon,
    isPinned: true,
    pageIndex,
  }
}

export function resolveQuickLinkMoveTarget(
  target: QuickLinkDndData | null,
  fallback?: QuickLinkMoveTarget | null,
): QuickLinkMoveTarget | null {
  if (!target) return fallback ?? null
  if (target.kind === 'quick-link') {
    return {
      groupId: target.groupId,
      sortableIndex: target.sortableIndex,
      storeIndex: target.storeIndex,
    }
  }
  if (target.kind === 'quick-link-container' || target.kind === 'quick-link-group') {
    return {
      groupId: target.groupId,
      sortableIndex: target.sortableIndex,
      storeIndex: target.storeIndex,
    }
  }
  return fallback ?? null
}

export function getPointerClientPoint(event: unknown): { x: number; y: number } | null {
  const nativeEvent = (event as { nativeEvent?: Event } | null | undefined)?.nativeEvent
  if (nativeEvent instanceof PointerEvent || nativeEvent instanceof MouseEvent) {
    return { x: nativeEvent.clientX, y: nativeEvent.clientY }
  }

  const to = (event as { to?: { x?: number; y?: number } } | null | undefined)?.to
  if (typeof to?.x === 'number' && typeof to.y === 'number') {
    return { x: to.x, y: to.y }
  }

  return null
}

export function getSortableMoveState(source: unknown): SortableMoveState {
  const sortable = source as
    | {
        initialGroup?: unknown
        group?: unknown
        initialIndex?: unknown
        index?: unknown
      }
    | null
    | undefined

  return {
    fromGroupId: typeof sortable?.initialGroup === 'string' ? sortable.initialGroup : undefined,
    toGroupId: typeof sortable?.group === 'string' ? sortable.group : undefined,
    fromSortableIndex:
      typeof sortable?.initialIndex === 'number' ? sortable.initialIndex : undefined,
    toSortableIndex: typeof sortable?.index === 'number' ? sortable.index : undefined,
  }
}

export function getSortableStoreIndexes<T extends { isPinned: boolean; originalIndex: number }>(
  items: T[],
) {
  return items.filter((item) => item.isPinned).map((item) => item.originalIndex)
}

export function getSortableIndexForStoreIndex(
  sortableStoreIndexes: number[],
  storeIndex: number,
) {
  return sortableStoreIndexes.indexOf(storeIndex)
}

export function resolveStoreIndexFromSortableIndex(
  sortableStoreIndexes: number[],
  sortableIndex: number | undefined,
  fallbackStoreIndex: number,
) {
  if (sortableIndex === undefined) return fallbackStoreIndex
  if (sortableStoreIndexes.length === 0) return fallbackStoreIndex

  if (sortableIndex <= 0) {
    return sortableStoreIndexes[0] ?? fallbackStoreIndex
  }

  if (sortableIndex >= sortableStoreIndexes.length) {
    const lastStoreIndex = sortableStoreIndexes[sortableStoreIndexes.length - 1]
    return lastStoreIndex === undefined ? fallbackStoreIndex : lastStoreIndex + 1
  }

  return sortableStoreIndexes[sortableIndex] ?? fallbackStoreIndex
}
