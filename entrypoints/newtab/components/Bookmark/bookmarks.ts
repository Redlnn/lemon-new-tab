import { defineStore } from 'pinia'

import i18next from 'i18next'

import { browser, type Browser } from 'wxt/browser'

import { SortMode } from '@/shared/enums'

import BookmarkWorker from './bookmark.worker?worker'

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
  importEnded?: () => void
} = {}

type BookmarkListenerKey = keyof typeof bookmarkListeners

const suppressedMoveReloadIds = new Set<string>()
type BookmarkTreeNode = Browser.bookmarks.BookmarkTreeNode
let bookmarkNodeIndex = new Map<string, BookmarkTreeNode>()

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
  const tree = ref<Browser.bookmarks.BookmarkTreeNode[]>([])
  const loaded = ref(false)
  const sortMode = ref<SortMode>(SortMode.Original)
  const searchQuery = ref('')
  // 根据查询/排序计算后的树结果
  const filteredResult = ref<Browser.bookmarks.BookmarkTreeNode[]>([])
  // 首个匹配路径（按照排序/展示顺序），空数组表示无匹配
  const firstMatchPath = ref<string[]>([])

  // 根据 `searchQuery` 过滤后的树。如果查询为空则返回完整的排序树。
  const filteredTree = computed(() => filteredResult.value)
  const reloadBookmarks = (reason: string) => {
    void loadBookmarks().catch((error) => {
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
    worker?.postMessage({
      type: 'INIT',
      payload: {
        tree: nodes,
        language: i18next.language,
        sortMode: sortMode.value,
      },
    })
  }

  const postWorkerFilter = () => {
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
    worker = new BookmarkWorker()
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
        filteredResult.value = result
        firstMatchPath.value = path
        if (type === 'INIT_DONE') loaded.value = true
      }
    }

    worker.onerror = (event) => {
      const message = event.message || 'Unknown worker runtime error'
      console.error('Bookmark worker runtime error:', event)
      ElNotification.error({
        title: i18next.t('bookmark.title'),
        message,
      })
    }

    // 添加书签变更监听，变更时重新加载书签并刷新 worker 缓存
    setBookmarkListener('created', () => reloadBookmarks('onCreated'), (listener) =>
      browser.bookmarks.onCreated.addListener(listener),
    )
    setBookmarkListener('removed', () => reloadBookmarks('onRemoved'), (listener) =>
      browser.bookmarks.onRemoved.addListener(listener),
    )
    setBookmarkListener('changed', () => reloadBookmarks('onChanged'), (listener) =>
      browser.bookmarks.onChanged.addListener(listener),
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
      'importEnded',
      () => reloadBookmarks('onImportEnded'),
      (listener) => browser.bookmarks.onImportEnded.addListener(listener),
      'onImportEnded listener is unavailable in this browser',
    )
  }

  const loadBookmarks = async () => {
    const _tree = await browser.bookmarks.getTree()
    const children = _tree[0]?.children ?? []
    tree.value = children
    buildBookmarkNodeIndex(children)

    if (!hasBookmarkContent(children)) {
      filteredResult.value = []
      firstMatchPath.value = []
      loaded.value = true
      return
    }

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
        await loadBookmarks()
        return
      }

      const [node] = source.siblings.splice(source.index, 1)
      if (!node) {
        await loadBookmarks()
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
    } finally {
      globalThis.setTimeout(() => suppressedMoveReloadIds.delete(id), 1000)
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
      'importEnded',
      (listener) => browser.bookmarks.onImportEnded.removeListener(listener),
      'onImportEnded',
    )

    if (worker) {
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
      worker = null
    }
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
  }
})
