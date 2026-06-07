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

const suppressedMoveReloadIds = new Set<string>()
type BookmarkTreeNode = Browser.bookmarks.BookmarkTreeNode

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
    if (!bookmarkListeners.created) {
      bookmarkListeners.created = () => {
        reloadBookmarks('onCreated')
      }
      browser.bookmarks.onCreated.addListener(bookmarkListeners.created)
    }

    if (!bookmarkListeners.removed) {
      bookmarkListeners.removed = () => {
        reloadBookmarks('onRemoved')
      }
      browser.bookmarks.onRemoved.addListener(bookmarkListeners.removed)
    }

    if (!bookmarkListeners.changed) {
      bookmarkListeners.changed = () => {
        reloadBookmarks('onChanged')
      }
      browser.bookmarks.onChanged.addListener(bookmarkListeners.changed)
    }

    if (!bookmarkListeners.moved) {
      bookmarkListeners.moved = (id) => {
        if (suppressedMoveReloadIds.delete(id)) return
        reloadBookmarks('onMoved')
      }
      browser.bookmarks.onMoved.addListener(bookmarkListeners.moved)
    }

    if (!bookmarkListeners.importEnded) {
      bookmarkListeners.importEnded = () => {
        reloadBookmarks('onImportEnded')
      }
      // importEnded 在导入书签完成时触发（可选）
      try {
        browser.bookmarks.onImportEnded.addListener(bookmarkListeners.importEnded)
      } catch (error) {
        // 某些浏览器/环境可能不支持该事件
        console.warn('[bookmark] onImportEnded listener is unavailable in this browser:', error)
      }
    }
  }

  const loadBookmarks = async () => {
    initWorker()
    const _tree = await browser.bookmarks.getTree()
    const children = _tree[0]?.children ?? []
    tree.value = children

    worker?.postMessage({
      type: 'INIT',
      payload: {
        tree: children,
        language: i18next.language,
        sortMode: sortMode.value,
      },
    })
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
      filteredResult.value = nextTree
      worker?.postMessage({
        type: 'INIT',
        payload: {
          tree: nextTree,
          language: i18next.language,
          sortMode: sortMode.value,
        },
      })
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
    worker?.postMessage({
      type: 'FILTER',
      payload: {
        query: searchQuery.value,
        sortMode: sortMode.value,
        language: i18next.language,
      },
    })
  }

  const terminateWorker = () => {
    if (languageChangedListener) {
      i18next.off('languageChanged', languageChangedListener)
      languageChangedListener = null
    }

    // 移除书签事件监听
    if (bookmarkListeners.created) {
      try {
        browser.bookmarks.onCreated.removeListener(bookmarkListeners.created)
      } catch (error) {
        console.warn('[bookmark] Failed to remove onCreated listener:', error)
      }
      delete bookmarkListeners.created
    }
    if (bookmarkListeners.removed) {
      try {
        browser.bookmarks.onRemoved.removeListener(bookmarkListeners.removed)
      } catch (error) {
        console.warn('[bookmark] Failed to remove onRemoved listener:', error)
      }
      delete bookmarkListeners.removed
    }
    if (bookmarkListeners.changed) {
      try {
        browser.bookmarks.onChanged.removeListener(bookmarkListeners.changed)
      } catch (error) {
        console.warn('[bookmark] Failed to remove onChanged listener:', error)
      }
      delete bookmarkListeners.changed
    }
    if (bookmarkListeners.moved) {
      try {
        browser.bookmarks.onMoved.removeListener(bookmarkListeners.moved)
      } catch (error) {
        console.warn('[bookmark] Failed to remove onMoved listener:', error)
      }
      delete bookmarkListeners.moved
    }
    if (bookmarkListeners.importEnded) {
      try {
        browser.bookmarks.onImportEnded.removeListener(bookmarkListeners.importEnded)
      } catch (error) {
        console.warn('[bookmark] Failed to remove onImportEnded listener:', error)
      }
      delete bookmarkListeners.importEnded
    }

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
    _setSortMode,
    setSortMode,
    updateFilteredResult,
    triggerFilter,
    terminateWorker,
  }
})
