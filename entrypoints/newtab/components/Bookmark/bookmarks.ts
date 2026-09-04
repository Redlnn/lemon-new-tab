import { defineStore } from 'pinia'

import i18next from 'i18next'

import { browser, type Browser } from 'wxt/browser'

import { getCachedBookmarkTree } from '@/shared/bookmarks/cacheBridge'
import { SortMode } from '@/shared/enums'
import { createExtensionWorker } from '@/shared/worker'

import bookmarkWorkerUrl from './bookmark.worker?worker&url'

let worker: Worker | null = null
let languageChangedListener: ((lang: string) => void) | null = null

const bookmarkListeners: {
  created?: (id: string, bookmark: Browser.bookmarks.BookmarkTreeNode) => void
  removed?: (
    id: string,
    removeInfo: {
      parentId: string
      index: number
      node: Browser.bookmarks.BookmarkTreeNode
    },
  ) => void
  changed?: (
    id: string,
    changeInfo: {
      title: string
      url?: string | undefined
    },
  ) => void
  moved?: (
    id: string,
    moveInfo: {
      parentId: string
      index: number
      oldParentId: string
      oldIndex: number
    },
  ) => void
  childrenReordered?: (id: string, reorderInfo: { childIds: string[] }) => void
  importBegan?: () => void
  importEnded?: () => void
} = {}

type BookmarkListenerKey = keyof typeof bookmarkListeners

const suppressedMoveReloadIds = new Set<string>()
let importingBookmarks = false
type BookmarkTreeNode = Browser.bookmarks.BookmarkTreeNode
let bookmarkNodeIndex = new Map<string, BookmarkTreeNode>()
let workerReady = false
let pendingWorkerInit: BookmarkTreeNode[] | null = null

function setBookmarkListener<K extends BookmarkListenerKey>(
  key: K,
  listener: NonNullable<(typeof bookmarkListeners)[K]>,
  addListener: (listener: NonNullable<(typeof bookmarkListeners)[K]>) => void,
  errorLabel?: string,
) {
  if (bookmarkListeners[key]) return
  bookmarkListeners[key] = listener
  try {
    addListener(listener)
  } catch (error) {
    if (errorLabel) {
      console.warn(`[bookmark] ${errorLabel}:`, error)
      delete bookmarkListeners[key]
      return
    }

    delete bookmarkListeners[key]
    throw error
  }
}

function unsetBookmarkListener<K extends BookmarkListenerKey>(
  key: K,
  removeListener: (listener: NonNullable<(typeof bookmarkListeners)[K]>) => void,
  eventName: string,
) {
  const listener = bookmarkListeners[key]
  if (!listener) return

  try {
    removeListener(listener as NonNullable<(typeof bookmarkListeners)[K]>)
  } catch (error) {
    console.warn(`[bookmark] Failed to remove ${eventName} listener:`, error)
  }

  delete bookmarkListeners[key]
}

function cloneBookmarkTree(nodes: BookmarkTreeNode[]): BookmarkTreeNode[] {
  return nodes.map((node) => ({
    ...node,
    children: node.children ? cloneBookmarkTree(node.children) : undefined,
  }))
}

function updateSiblingIndexes(nodes: BookmarkTreeNode[]) {
  for (let index = 0; index < nodes.length; index++) {
    nodes[index]!.index = index
  }
}

function findBookmarkLocation(
  nodes: BookmarkTreeNode[],
  id: string,
): { node: BookmarkTreeNode; siblings: BookmarkTreeNode[]; index: number } | null {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!
    if (node.id === id) return { node, siblings: nodes, index }

    if (node.children) {
      const matched = findBookmarkLocation(node.children, id)
      if (matched) return matched
    }
  }
  return null
}

function findBookmarkChildren(nodes: BookmarkTreeNode[], parentId: string) {
  const parent = findBookmarkLocation(nodes, parentId)?.node
  return parent?.children ?? null
}

function hasBookmarkContent(nodes: BookmarkTreeNode[]) {
  return nodes.some((node) => Boolean(node.url) || Boolean(node.children?.length))
}

function buildBookmarkNodeIndex(nodes: BookmarkTreeNode[]) {
  const nextIndex = new Map<string, BookmarkTreeNode>()
  const stack = nodes.slice()

  while (stack.length) {
    const node = stack.pop()!
    nextIndex.set(node.id, node)
    if (node.children?.length) {
      for (let i = 0, len = node.children.length; i < len; i++) {
        stack.push(node.children[i]!)
      }
    }
  }

  bookmarkNodeIndex = nextIndex
}

export const useBookmarkStore = defineStore('bookmark', () => {
  const tree = shallowRef<Browser.bookmarks.BookmarkTreeNode[]>([])
  const loaded = ref(false)
  const sortMode = ref<SortMode>(SortMode.Original)
  const searchQuery = ref('')
  // 根据查询/排序计算后的树结果
  const filteredResult = shallowRef<Browser.bookmarks.BookmarkTreeNode[]>([])
  // 首个匹配路径（按照排序/展示顺序），空数组表示无匹配
  const firstMatchPath = ref<string[]>([])
  let latestLoadRequest = 0

  // 根据 `searchQuery` 过滤后的树。如果查询为空则返回完整的排序树。
  const filteredTree = computed(() => filteredResult.value)
  const reloadBookmarks = (reason: string) => {
    void loadBookmarks(true).catch((error) => {
      console.error(`[bookmark] Failed to reload bookmarks after ${reason}:`, error)
    })
  }

  const getBookmarkNode = (id: string) => bookmarkNodeIndex.get(id) ?? null

  const getBookmarkChildrenCount = (parentId: string) => {
    return getBookmarkNode(parentId)?.children?.length ?? null
  }

  const isBookmarkSelfOrDescendant = (id: string, maybeDescendantId: string) => {
    if (id === maybeDescendantId) return true

    const node = getBookmarkNode(id)
    if (!node?.children?.length) return false

    const stack = node.children.slice()
    while (stack.length) {
      const current = stack.pop()!
      if (current.id === maybeDescendantId) return true
      if (current.children?.length) {
        for (let i = 0, len = current.children.length; i < len; i++) {
          stack.push(current.children[i]!)
        }
      }
    }

    return false
  }

  const postWorkerInit = (nodes: BookmarkTreeNode[]) => {
    if (!worker) return
    if (!workerReady) {
      pendingWorkerInit = nodes
      return
    }

    worker.postMessage({
      type: 'INIT',
      payload: {
        tree: nodes,
        language: i18next.language,
        sortMode: sortMode.value,
      },
    })
  }

  const postWorkerFilter = () => {
    if (!workerReady) return
    worker?.postMessage({
      type: 'FILTER',
      payload: {
        query: searchQuery.value,
        sortMode: sortMode.value,
        language: i18next.language,
      },
    })
  }

  const initWorker = () => {
    if (worker) return

    workerReady = false
    worker = createExtensionWorker(bookmarkWorkerUrl)
    if (!languageChangedListener) {
      languageChangedListener = (lang) => {
        worker?.postMessage({
          type: 'UPDATE_SETTINGS',
          payload: {
            language: lang,
          },
        })
        triggerFilter()
      }
      i18next.on('languageChanged', languageChangedListener)
    }

    worker.onmessage = (e) => {
      const { type, filteredResult: result, firstMatchPath: path } = e.data
      if (type === 'READY') {
        workerReady = true
        const nodes = pendingWorkerInit
        pendingWorkerInit = null
        if (nodes) postWorkerInit(nodes)
        return
      }
      if (type === 'ERROR') {
        const workerError =
          typeof e.data.error === 'string' && e.data.error ? e.data.error : 'Unknown worker error'
        console.error('Bookmark worker error:', workerError)
        ElNotification.error({
          title: i18next.t('bookmark.title'),
          message: workerError,
        })
        return
      }

      if (type === 'INIT_DONE' || type === 'FILTER_DONE') {
        if (Array.isArray(result)) filteredResult.value = result
        firstMatchPath.value = path
        if (type === 'INIT_DONE') {
          loaded.value = true
          if (searchQuery.value) postWorkerFilter()
        }
      }
    }

    worker.onerror = (event) => {
      workerReady = false
      const message = event.message || 'Unknown worker runtime error'
      console.error('Bookmark worker runtime error:', event)
      ElNotification.error({
        title: i18next.t('bookmark.title'),
        message,
      })
    }
  }

  const ensureBookmarkListeners = () => {
    setBookmarkListener(
      'created',
      () => {
        if (!importingBookmarks || !bookmarkListeners.importEnded) {
          reloadBookmarks('onCreated')
        }
      },
      (listener) => browser.bookmarks.onCreated.addListener(listener),
    )
    setBookmarkListener(
      'removed',
      () => reloadBookmarks('onRemoved'),
      (listener) => browser.bookmarks.onRemoved.addListener(listener),
    )
    setBookmarkListener(
      'changed',
      () => reloadBookmarks('onChanged'),
      (listener) => browser.bookmarks.onChanged.addListener(listener),
    )
    setBookmarkListener(
      'moved',
      (id) => {
        if (suppressedMoveReloadIds.delete(id)) return
        reloadBookmarks('onMoved')
      },
      (listener) => browser.bookmarks.onMoved.addListener(listener),
    )
    setBookmarkListener(
      'childrenReordered',
      () => reloadBookmarks('onChildrenReordered'),
      (listener) => browser.bookmarks.onChildrenReordered.addListener(listener),
      'onChildrenReordered listener is unavailable in this browser',
    )
    setBookmarkListener(
      'importBegan',
      () => {
        importingBookmarks = true
      },
      (listener) => browser.bookmarks.onImportBegan.addListener(listener),
      'onImportBegan listener is unavailable in this browser',
    )
    setBookmarkListener(
      'importEnded',
      () => {
        importingBookmarks = false
        reloadBookmarks('onImportEnded')
      },
      (listener) => browser.bookmarks.onImportEnded.addListener(listener),
      'onImportEnded listener is unavailable in this browser',
    )
  }

  const loadBookmarks = async (forceNative = false) => {
    const request = ++latestLoadRequest
    const cachedTree = forceNative ? null : await getCachedBookmarkTree()
    const useCachedTree = cachedTree !== null && hasBookmarkContent(cachedTree)
    const children =
      useCachedTree && cachedTree
        ? cachedTree
        : ((await browser.bookmarks.getTree())[0]?.children ?? [])
    if (request !== latestLoadRequest) return

    tree.value = children
    buildBookmarkNodeIndex(children)
    ensureBookmarkListeners()

    if (!hasBookmarkContent(children)) {
      filteredResult.value = []
      firstMatchPath.value = []
      if (worker) postWorkerInit([])
      else loaded.value = true
      return
    }

    // 搜索 Worker 仅负责筛选与排序；已有原始树时先渲染，避免其启动失败或延迟使面板误显示为空。
    filteredResult.value = children
    firstMatchPath.value = []
    initWorker()

    postWorkerInit(children)
  }

  const moveBookmark = async (
    id: string,
    destination: Parameters<typeof browser.bookmarks.move>[1],
  ) => {
    suppressedMoveReloadIds.add(id)
    try {
      const movedNode = await browser.bookmarks.move(id, destination)
      const nextTree = cloneBookmarkTree(tree.value)
      const source = findBookmarkLocation(nextTree, id)
      const targetSiblings = movedNode.parentId
        ? findBookmarkChildren(nextTree, movedNode.parentId)
        : nextTree

      if (!source || !targetSiblings) {
        await loadBookmarks(true)
        return
      }

      const [node] = source.siblings.splice(source.index, 1)
      if (!node) {
        await loadBookmarks(true)
        return
      }

      Object.assign(node, { ...movedNode, children: node.children })
      const targetIndex = Math.min(
        Math.max(0, movedNode.index ?? targetSiblings.length),
        targetSiblings.length,
      )
      targetSiblings.splice(targetIndex, 0, node)

      updateSiblingIndexes(source.siblings)
      if (source.siblings !== targetSiblings) updateSiblingIndexes(targetSiblings)

      tree.value = nextTree
      buildBookmarkNodeIndex(nextTree)
      filteredResult.value = nextTree
      postWorkerInit(nextTree)
    } catch (error) {
      suppressedMoveReloadIds.delete(id)
      throw error
    }
  }

  const _setSortMode = (mode: SortMode) => {
    if (sortMode.value === mode) return
    sortMode.value = mode
  }

  const setSortMode = (mode: SortMode) => {
    if (sortMode.value === mode) return
    sortMode.value = mode
    triggerFilter()
  }

  const updateFilteredResult = () => {
    triggerFilter()
  }

  const triggerFilter = () => {
    postWorkerFilter()
  }

  const terminateWorker = () => {
    if (languageChangedListener) {
      i18next.off('languageChanged', languageChangedListener)
      languageChangedListener = null
    }

    // 移除书签事件监听
    unsetBookmarkListener(
      'created',
      (listener) => browser.bookmarks.onCreated.removeListener(listener),
      'onCreated',
    )
    unsetBookmarkListener(
      'removed',
      (listener) => browser.bookmarks.onRemoved.removeListener(listener),
      'onRemoved',
    )
    unsetBookmarkListener(
      'changed',
      (listener) => browser.bookmarks.onChanged.removeListener(listener),
      'onChanged',
    )
    unsetBookmarkListener(
      'moved',
      (listener) => browser.bookmarks.onMoved.removeListener(listener),
      'onMoved',
    )
    unsetBookmarkListener(
      'childrenReordered',
      (listener) => browser.bookmarks.onChildrenReordered.removeListener(listener),
      'onChildrenReordered',
    )
    unsetBookmarkListener(
      'importBegan',
      (listener) => browser.bookmarks.onImportBegan.removeListener(listener),
      'onImportBegan',
    )
    unsetBookmarkListener(
      'importEnded',
      (listener) => browser.bookmarks.onImportEnded.removeListener(listener),
      'onImportEnded',
    )
    importingBookmarks = false

    if (worker) {
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
      worker = null
    }
    workerReady = false
    pendingWorkerInit = null
  }

  const dispose = () => {
    // 让尚未完成的缓存/原生读取结果失效，并释放 Pinia 单例持有的大对象。
    latestLoadRequest++
    terminateWorker()
    tree.value = []
    filteredResult.value = []
    firstMatchPath.value = []
    bookmarkNodeIndex.clear()
    suppressedMoveReloadIds.clear()
    searchQuery.value = ''
    loaded.value = false
  }

  return {
    tree,
    loaded,
    sortMode,
    searchQuery,
    filteredResult,
    firstMatchPath,
    filteredTree,
    initWorker,
    loadBookmarks,
    moveBookmark,
    getBookmarkNode,
    getBookmarkChildrenCount,
    isBookmarkSelfOrDescendant,
    _setSortMode,
    setSortMode,
    updateFilteredResult,
    triggerFilter,
    terminateWorker,
    dispose,
  }
})
