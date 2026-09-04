import type { Browser } from 'wxt/browser'

export const BOOKMARK_ROW_HEIGHT = 40
export const BOOKMARK_VIRTUAL_OVERSCAN = 6

type BookmarkTreeNode = Browser.bookmarks.BookmarkTreeNode

export interface VirtualBookmarkRow {
  node: BookmarkTreeNode
  depth: number
  index: number
}

export interface VirtualRange {
  start: number
  end: number
  totalHeight: number
}

export function flattenVisibleBookmarkTree(
  nodes: BookmarkTreeNode[],
  activeMap: Readonly<Record<number, readonly string[]>>,
): VirtualBookmarkRow[] {
  const rows: VirtualBookmarkRow[] = []
  const stack: Array<{ node: BookmarkTreeNode; depth: number }> = []

  for (let i = nodes.length - 1; i >= 0; i--) {
    stack.push({ node: nodes[i]!, depth: 1 })
  }

  while (stack.length) {
    const { node, depth } = stack.pop()!
    rows.push({ node, depth, index: rows.length })

    if (!node.children?.length || !activeMap[depth]?.includes(node.id)) continue
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push({ node: node.children[i]!, depth: depth + 1 })
    }
  }

  return rows
}

export function getBookmarkVirtualRange(
  itemCount: number,
  scrollTop: number,
  viewportHeight: number,
): VirtualRange {
  const safeScrollTop = Math.max(0, scrollTop)
  const safeViewportHeight = Math.max(BOOKMARK_ROW_HEIGHT, viewportHeight)
  const start = Math.max(
    0,
    Math.floor(safeScrollTop / BOOKMARK_ROW_HEIGHT) - BOOKMARK_VIRTUAL_OVERSCAN,
  )
  const end = Math.min(
    itemCount,
    Math.ceil((safeScrollTop + safeViewportHeight) / BOOKMARK_ROW_HEIGHT) +
      BOOKMARK_VIRTUAL_OVERSCAN,
  )

  return {
    start,
    end,
    totalHeight: itemCount * BOOKMARK_ROW_HEIGHT,
  }
}
