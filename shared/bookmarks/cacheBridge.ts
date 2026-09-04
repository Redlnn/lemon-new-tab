import { browser, type Browser } from 'wxt/browser'

export type BookmarkCacheMessage = { type: 'bookmark-cache:warm' } | { type: 'bookmark-cache:get' }

export function isBookmarkCacheMessage(value: unknown): value is BookmarkCacheMessage {
  if (!value || typeof value !== 'object') return false
  const { type } = value as { type?: unknown }
  return type === 'bookmark-cache:warm' || type === 'bookmark-cache:get'
}

export async function warmBookmarkCache(): Promise<void> {
  try {
    await browser.runtime.sendMessage({ type: 'bookmark-cache:warm' })
  } catch (error) {
    console.warn('[bookmark-cache] Failed to warm bookmark cache:', error)
  }
}

export async function getCachedBookmarkTree(): Promise<
  Browser.bookmarks.BookmarkTreeNode[] | null
> {
  try {
    const tree: unknown = await browser.runtime.sendMessage({ type: 'bookmark-cache:get' })
    return Array.isArray(tree) ? (tree as Browser.bookmarks.BookmarkTreeNode[]) : null
  } catch (error) {
    console.warn('[bookmark-cache] Failed to read bookmark cache:', error)
    return null
  }
}
