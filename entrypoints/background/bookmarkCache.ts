import { browser, type Browser } from 'wxt/browser'

import { isBookmarkCacheMessage } from '@/shared/bookmarks/cacheBridge'
import {
  idbDeleteMany,
  idbGet,
  idbSetMany,
  type BookmarkCacheEntry,
  type BookmarkCacheMetadata,
} from '@/shared/storage/idb'

const CACHE_SCHEMA_VERSION = 1
const CACHE_METADATA_KEY = 'metadata'
const CACHE_TREE_KEY = 'tree'
const MAX_CACHE_BYTES = 16 * 1024 * 1024
const CACHE_SPACE_RESERVE = 2 * 1024 * 1024
const NODE_OVERHEAD_BYTES = 192

type BookmarkTreeNode = Browser.bookmarks.BookmarkTreeNode

let pendingLoad: Promise<BookmarkTreeNode[]> | null = null
let generation = 0
let cacheInvalidated = false
let importing = false
let canObserveImportEnd = false

function isCacheMetadata(value: BookmarkCacheEntry | undefined): value is BookmarkCacheMetadata {
  return (
    !!value &&
    !Array.isArray(value) &&
    value.schemaVersion === CACHE_SCHEMA_VERSION &&
    (value.state === 'ready' || value.state === 'oversize')
  )
}

function estimateStringBytes(value: string | undefined) {
  // UTF-16 code units can become up to six bytes after JSON escaping.
  return (value?.length ?? 0) * 6
}

function hasBookmarkContent(nodes: BookmarkTreeNode[]) {
  return nodes.some((node) => Boolean(node.url) || Boolean(node.children?.length))
}

function normalizeAndEstimateTree(nodes: BookmarkTreeNode[]) {
  const stack = nodes.slice()
  let estimatedBytes = 0
  const allowedKeys = new Set([
    'id',
    'parentId',
    'index',
    'title',
    'url',
    'dateAdded',
    'dateGroupModified',
    'children',
  ])

  while (stack.length) {
    const node = stack.pop()!
    const rawNode = node as unknown as Record<string, unknown>
    for (const key of Object.keys(rawNode)) {
      if (!allowedKeys.has(key)) delete rawNode[key]
    }

    estimatedBytes +=
      NODE_OVERHEAD_BYTES +
      estimateStringBytes(node.id) +
      estimateStringBytes(node.parentId) +
      estimateStringBytes(node.title) +
      estimateStringBytes(node.url)

    if (node.children?.length) stack.push(...node.children)
  }

  return estimatedBytes
}

async function clearSnapshot() {
  try {
    await idbDeleteMany('bookmarkCache', [CACHE_METADATA_KEY, CACHE_TREE_KEY])
  } catch (error) {
    console.warn('[bookmark-cache] Failed to clear bookmark cache:', error)
  }
}

function invalidateBookmarkCache() {
  generation += 1
  if (cacheInvalidated) return
  cacheInvalidated = true
  void clearSnapshot()
}

async function getCacheMetadata() {
  if (cacheInvalidated) return null

  try {
    const value = await idbGet('bookmarkCache', CACHE_METADATA_KEY)
    if (value === undefined || isCacheMetadata(value)) return value ?? null

    await clearSnapshot()
    return null
  } catch (error) {
    console.warn('[bookmark-cache] Failed to read bookmark cache metadata:', error)
    await clearSnapshot()
    return null
  }
}

async function hasEnoughStorage(estimatedBytes: number) {
  try {
    const { quota, usage } = await navigator.storage.estimate()
    if (quota === undefined || usage === undefined) return false
    return quota - usage >= estimatedBytes + CACHE_SPACE_RESERVE
  } catch (error) {
    console.warn('[bookmark-cache] Failed to estimate available storage:', error)
    return false
  }
}

async function writeMetadata(state: BookmarkCacheMetadata['state']) {
  const metadata: BookmarkCacheMetadata = { schemaVersion: CACHE_SCHEMA_VERSION, state }
  try {
    await idbSetMany('bookmarkCache', [[CACHE_METADATA_KEY, metadata]])
    return true
  } catch (error) {
    console.warn('[bookmark-cache] Failed to write bookmark cache metadata:', error)
    return false
  }
}

async function cacheTree(tree: BookmarkTreeNode[], generationAtStart: number) {
  if (!hasBookmarkContent(tree)) {
    await clearSnapshot()
    return false
  }

  const estimatedBytes = normalizeAndEstimateTree(tree)
  if (generationAtStart !== generation) return false

  if (estimatedBytes > MAX_CACHE_BYTES) {
    await clearSnapshot()
    if (generationAtStart !== generation) return false
    if (!(await hasEnoughStorage(NODE_OVERHEAD_BYTES))) return false
    const saved = await writeMetadata('oversize')
    if (saved && generationAtStart === generation) cacheInvalidated = false
    return saved
  }

  if (!(await hasEnoughStorage(estimatedBytes)) || generationAtStart !== generation) {
    await clearSnapshot()
    return false
  }

  const metadata: BookmarkCacheMetadata = { schemaVersion: CACHE_SCHEMA_VERSION, state: 'ready' }
  try {
    await idbSetMany('bookmarkCache', [
      [CACHE_TREE_KEY, tree],
      [CACHE_METADATA_KEY, metadata],
    ])
  } catch (error) {
    console.warn('[bookmark-cache] Failed to write bookmark cache:', error)
    await clearSnapshot()
    return false
  }

  if (generationAtStart !== generation) {
    await clearSnapshot()
    return false
  }

  cacheInvalidated = false
  return true
}

async function readBrowserTree() {
  try {
    const tree = await browser.bookmarks.getTree()
    return tree[0]?.children ?? []
  } catch (error) {
    await clearSnapshot()
    throw error
  }
}

async function loadBookmarkTree(): Promise<BookmarkTreeNode[]> {
  while (true) {
    const generationAtStart = generation
    const metadata = await getCacheMetadata()
    if (generationAtStart !== generation) continue

    if (metadata?.state === 'ready') {
      try {
        const cachedTree = await idbGet('bookmarkCache', CACHE_TREE_KEY)
        if (generationAtStart !== generation) continue
        if (Array.isArray(cachedTree) && hasBookmarkContent(cachedTree)) {
          return cachedTree as BookmarkTreeNode[]
        }
      } catch (error) {
        console.warn('[bookmark-cache] Failed to read bookmark cache:', error)
      }
      invalidateBookmarkCache()
      continue
    }

    if (metadata?.state === 'oversize') return readBrowserTree()

    const tree = await readBrowserTree()
    if (generationAtStart !== generation) continue
    await cacheTree(tree, generationAtStart)
    if (generationAtStart !== generation) continue
    return tree
  }
}

function getBookmarkTree() {
  if (!pendingLoad) {
    const task = loadBookmarkTree()
    pendingLoad = task
    void task
      .finally(() => {
        if (pendingLoad === task) pendingLoad = null
      })
      .catch(() => {})
  }
  return pendingLoad
}

async function warmBookmarkCache() {
  const metadata = await getCacheMetadata()
  if (metadata) return
  await getBookmarkTree()
}

function registerBookmarkCacheListeners() {
  const invalidate = () => invalidateBookmarkCache()
  browser.bookmarks.onCreated.addListener(() => {
    if (!importing || !canObserveImportEnd) invalidate()
  })
  browser.bookmarks.onRemoved.addListener(invalidate)
  browser.bookmarks.onChanged.addListener(invalidate)
  browser.bookmarks.onMoved.addListener(invalidate)
  try {
    browser.bookmarks.onChildrenReordered.addListener(invalidate)
  } catch (error) {
    console.warn(
      '[bookmark-cache] onChildrenReordered listener is unavailable in this browser:',
      error,
    )
  }

  try {
    browser.bookmarks.onImportBegan.addListener(() => {
      importing = true
      invalidate()
    })
  } catch (error) {
    console.warn('[bookmark-cache] onImportBegan listener is unavailable in this browser:', error)
  }

  try {
    browser.bookmarks.onImportEnded.addListener(() => {
      importing = false
      invalidate()
    })
    canObserveImportEnd = true
  } catch (error) {
    console.warn('[bookmark-cache] onImportEnded listener is unavailable in this browser:', error)
  }
}

export function initializeBookmarkCache() {
  registerBookmarkCacheListeners()

  browser.runtime.onMessage.addListener(async (message, sender) => {
    if (sender.id && sender.id !== browser.runtime.id) return undefined
    if (!isBookmarkCacheMessage(message)) return undefined

    if (message.type === 'bookmark-cache:warm') {
      await warmBookmarkCache()
      return undefined
    }

    return getBookmarkTree()
  })
}
