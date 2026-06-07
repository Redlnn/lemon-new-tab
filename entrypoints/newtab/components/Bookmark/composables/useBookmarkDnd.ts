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

export function bookmarkDndId(id: string) {
  return `bookmark:${id}`
}

export function bookmarkContainerDndId(parentId: string) {
  return `bookmark-container:${parentId}`
}

export function toBookmarkDndData(value: unknown): BookmarkDndData | null {
  if (!value || typeof value !== 'object' || !('kind' in value)) return null
  const kind = (value as { kind?: unknown }).kind
  if (kind !== 'bookmark-item' && kind !== 'bookmark-container') return null
  return value as BookmarkDndData
}

export function getBookmarkDndData(entity: unknown): BookmarkDndData | null {
  return toBookmarkDndData((entity as { data?: unknown } | null | undefined)?.data)
}
