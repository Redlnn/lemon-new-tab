export const BOOKMARK_DND_TYPE = 'bookmark-item'

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

export type BookmarkDropPreview = {
  nodeId: string
  placement: 'before' | 'after' | 'inside'
  parentId: string
  index: number
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

export function createBookmarkDropPreview(
  source: BookmarkDndData | null,
  target: BookmarkDndData | null,
  pointerY?: number,
  targetCenterY?: number,
): BookmarkDropPreview | null {
  if (source?.kind !== 'bookmark-item' || !target) return null

  if (target.kind === 'bookmark-container') {
    return {
      nodeId: target.parentId,
      placement: 'inside',
      parentId: target.parentId,
      index: target.index,
    }
  }

  if (source.id === target.id || target.parentId === undefined || target.index === undefined) {
    return null
  }

  const placement =
    pointerY === undefined || targetCenterY === undefined
      ? source.parentId === target.parentId && (source.index ?? 0) < target.index
        ? 'after'
        : 'before'
      : pointerY < targetCenterY
        ? 'before'
        : 'after'

  return {
    nodeId: target.id,
    placement,
    parentId: target.parentId,
    index: target.index + (placement === 'after' ? 1 : 0),
  }
}

export function resolveBookmarkMoveDestination(options: {
  fromParentId: string | undefined
  fromIndex: number
  preview: BookmarkDropPreview
  getChildrenCount: (parentId: string) => number | null
}) {
  const { fromParentId, fromIndex, preview, getChildrenCount } = options
  const sameParent = fromParentId === preview.parentId
  const childrenCount = getChildrenCount(preview.parentId)
  const maxIndex = childrenCount === null ? Number.POSITIVE_INFINITY : Math.max(0, childrenCount)
  const index = Math.min(Math.max(0, preview.index), maxIndex)

  return {
    parentId: preview.parentId,
    // 同级移动使用移除前的索引；当前位置后一格也代表无需移动。
    index: sameParent && index === fromIndex + 1 ? fromIndex : index,
  }
}
