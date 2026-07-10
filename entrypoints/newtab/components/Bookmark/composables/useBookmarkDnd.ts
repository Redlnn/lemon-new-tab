export const BOOKMARK_DND_TYPE = 'bookmark-item'
export const BOOKMARK_DND_GROUP = 'bookmark-tree'

export type BookmarkDndData =
  | {
      kind: 'bookmark-item'
      id: string
      parentId?: string
      index?: number
      isFolder: boolean
    }
  | {
      kind: 'bookmark-container'
      parentId: string
      index: number
    }

export type SortableLike = {
  initialGroup?: unknown
  group?: unknown
  initialIndex?: unknown
  index?: unknown
  sortable?: {
    initialGroup?: unknown
    group?: unknown
    initialIndex?: unknown
    index?: unknown
  }
}

export function bookmarkDndId(id: string) {
  return `bookmark:${id}`
}

export function bookmarkContainerDndId(parentId: string) {
  return `bookmark-container:${parentId}`
}

export function toBookmarkDndData(value: unknown): BookmarkDndData | null {
  if (!value || typeof value !== 'object' || !('kind' in value)) return null
  const { kind } = value as { kind?: unknown }
  if (kind !== 'bookmark-item' && kind !== 'bookmark-container') return null
  return value as BookmarkDndData
}

export function getBookmarkDndData(entity: unknown): BookmarkDndData | null {
  return toBookmarkDndData((entity as { data?: unknown } | null | undefined)?.data)
}

export function getSortableString(value: SortableLike | null, key: 'initialGroup' | 'group') {
  const direct = value?.[key]
  if (typeof direct === 'string') return direct
  const nested = value?.sortable?.[key]
  return typeof nested === 'string' ? nested : null
}

export function getSortableNumber(value: SortableLike | null, key: 'initialIndex' | 'index') {
  const direct = value?.[key]
  if (typeof direct === 'number') return direct
  const nested = value?.sortable?.[key]
  return typeof nested === 'number' ? nested : null
}

function clampBookmarkMoveIndex(
  index: number,
  parentId: string,
  getChildrenCount: (parentId: string) => number | null,
) {
  const childrenCount = getChildrenCount(parentId)
  if (childrenCount === null) return Math.max(0, index)

  return Math.min(Math.max(0, index), Math.max(0, childrenCount))
}

export function resolveBookmarkMoveIndex(options: {
  fromParentId: string | undefined
  fromIndex: number
  nextParentId: string
  nextIndex: number
  getChildrenCount: (parentId: string) => number | null
}) {
  const { fromParentId, fromIndex, nextParentId, nextIndex, getChildrenCount } = options
  if (fromParentId !== nextParentId || nextIndex <= fromIndex) {
    return clampBookmarkMoveIndex(nextIndex, nextParentId, getChildrenCount)
  }

  // dnd-kit 的同级排序 index 描述拖拽列表位置，bookmarks.move 接收的是移除源节点后的插入位置。
  const offset = nextIndex - fromIndex
  const browserMoveIndex = offset === 1 ? nextIndex - 1 : nextIndex + 1
  return clampBookmarkMoveIndex(browserMoveIndex, nextParentId, getChildrenCount)
}
