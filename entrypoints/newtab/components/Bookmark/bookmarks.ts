import { defineStore } from 'pinia'

import i18next from 'i18next'

import { browser, type Browser } from 'wxt/browser'

import { getCachedBookmarkTree } from '@/shared/bookmarks/cacheBridge'
import { SortMode } from '@/shared/enums'
import { createExtensionWorker } from '@/shared/worker'

import bookmarkWorkerUrl from './bookmark.worker?worker&url'
import type { BookmarkResultNode } from './bookmark.worker'

let worker: Worker | null = null
let languageChangedListener: ((lang: string) => void) | null = null

const bookmarkListenerCleanups = new Map<object, () => void>()

let importingBookmarks = false
type BookmarkTreeNode = Browser.bookmarks.BookmarkTreeNode
let bookmarkNodeIndex = new Map<string, BookmarkTreeNode>()
let workerReady = false
let pendingWorkerInit: BookmarkTreeNode[] | null = null

function listenToBookmarks<T extends (...args: never[]) => unknown>(
  event: { addListener(listener: T): void; removeListener(listener: T): void },
  listener: T,
) {
  if (bookmarkListenerCleanups.has(event)) return
  event.addListener(listener)
  bookmarkListenerCleanups.set(event, () => event.removeListener(listener))
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
  let loadTask: Promise<void> | null = null
  let reloadRequested = false
  let hasNativeSnapshot = false
  let treeVersion = 0
  let latestWorkerRequest = 0
  const pendingMoves = new Set<{ id: string; receivedEvent: boolean }>()

  const applyFirstMatchPath = (path: string[], force = false) => {
    if (
      force ||
      path.length !== firstMatchPath.value.length ||
      path.some((id, index) => id !== firstMatchPath.value[index])
    ) {
      firstMatchPath.value = path
    }
  }

  const showNativeTree = () => {
    filteredResult.value = tree.value
    if (!searchQuery.value.trim() && sortMode.value === SortMode.Original) {
      // 与 Worker 的原始视图规则一致；回包无需再次改变展开路径。
      const firstFolder = tree.value.find((node) => node.children?.length)
      applyFirstMatchPath(firstFolder ? [firstFolder.id] : [])
    } else {
      // 查询/排序期间仍保留原生树先行展示的容错路径。
      firstMatchPath.value = []
    }
  }

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
    treeVersion++
    if (!workerReady) {
      pendingWorkerInit = nodes
      return
    }

    worker.postMessage({
      type: 'INIT',
      payload: {
        tree: nodes,
        ...workerQuery(),
      },
    })
  }

  const workerQuery = () => ({
    version: treeVersion,
    requestId: ++latestWorkerRequest,
    query: searchQuery.value,
    sortMode: sortMode.value,
    language: i18next.language,
  })

  const postWorkerPatch = (id: string, changes: { title?: string; url?: string }) => {
    if (!workerReady) {
      postWorkerInit(tree.value)
      return
    }
    const baseVersion = treeVersion++
    worker?.postMessage({ type: 'PATCH', payload: { id, changes, baseVersion, ...workerQuery() } })
  }

  const materializeResult = (nodes: BookmarkResultNode[]): BookmarkTreeNode[] =>
    nodes.map(({ id, children }) => {
      const node = getBookmarkNode(id)
      if (!node) throw new Error(`Unknown bookmark result: ${id}`)
      if (!node.children && !children) return node
      const fields = { ...node }
      delete fields.children
      return children ? { ...fields, children: materializeResult(children) } : fields
    })

  const postWorkerFilter = () => {
    if (!workerReady) return
    worker?.postMessage({
      type: 'FILTER',
      payload: workerQuery(),
    })
  }

  const initWorker = () => {
    if (worker) return

    workerReady = false
    worker = createExtensionWorker(bookmarkWorkerUrl)
    if (!languageChangedListener) {
      languageChangedListener = () => {
        postWorkerFilter()
      }
      i18next.on('languageChanged', languageChangedListener)
    }

    worker.onmessage = (e) => {
      const { type, nodes, firstMatchPath: path, version, requestId } = e.data
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

      if (version !== treeVersion) return
      if (type === 'RESYNC_REQUIRED') {
        postWorkerInit(tree.value)
        return
      }
      if (requestId !== latestWorkerRequest) return
      if (type === 'INIT_DONE' || type === 'FILTER_DONE' || type === 'PATCH_DONE') {
        try {
          filteredResult.value = nodes === null ? tree.value : materializeResult(nodes)
          // 显式查询/排序即使匹配路径相同，也必须保留原来的视图重置语义。
          applyFirstMatchPath(path, type === 'FILTER_DONE')
          loaded.value = true
        } catch (error) {
          console.warn('[bookmark] Invalid worker result:', error)
          reloadBookmarks('worker result')
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
    listenToBookmarks(browser.bookmarks.onCreated, () => {
      if (!importingBookmarks || !bookmarkListenerCleanups.has(browser.bookmarks.onImportEnded)) {
        reloadBookmarks('onCreated')
      }
    })
    listenToBookmarks(browser.bookmarks.onRemoved, () => reloadBookmarks('onRemoved'))
    listenToBookmarks(browser.bookmarks.onChanged, (id, changeInfo) => {
      const node = getBookmarkNode(id)
      const fields = Object.keys(changeInfo)
      if (
        !(import.meta.env.CHROME || import.meta.env.EDGE) ||
        !hasNativeSnapshot ||
        loadTask ||
        importingBookmarks ||
        !node ||
        !fields.length ||
        fields.some((key) => key !== 'title' && key !== 'url') ||
        ('title' in changeInfo && typeof changeInfo.title !== 'string') ||
        ('url' in changeInfo && (typeof changeInfo.url !== 'string' || !node.url))
      ) {
        reloadBookmarks('onChanged')
        return
      }
      Object.assign(node, changeInfo)
      triggerRef(tree)
      showNativeTree()
      postWorkerPatch(id, changeInfo)
    })
    listenToBookmarks(browser.bookmarks.onMoved, (id) => {
      let deferred = false
      for (const move of pendingMoves) {
        if (move.id !== id) continue
        move.receivedEvent = true
        deferred = true
      }
      // 同一节点在移动完成前的事件由完成后的原生快照覆盖，不推断事件内容。
      if (!deferred) reloadBookmarks('onMoved')
    })
    if (browser.bookmarks.onChildrenReordered) {
      listenToBookmarks(browser.bookmarks.onChildrenReordered, () =>
        reloadBookmarks('onChildrenReordered'),
      )
    }
    if (browser.bookmarks.onImportBegan) {
      listenToBookmarks(browser.bookmarks.onImportBegan, () => {
        importingBookmarks = true
      })
    }
    if (browser.bookmarks.onImportEnded) {
      listenToBookmarks(browser.bookmarks.onImportEnded, () => {
        importingBookmarks = false
        reloadBookmarks('onImportEnded')
      })
    }
  }

  const readBookmarks = async (forceNative: boolean) => {
    const request = ++latestLoadRequest
    const cachedTree = forceNative ? null : await getCachedBookmarkTree()
    const useCachedTree = cachedTree !== null && hasBookmarkContent(cachedTree)
    const children =
      useCachedTree && cachedTree
        ? cachedTree
        : ((await browser.bookmarks.getTree())[0]?.children ?? [])
    if (request !== latestLoadRequest || reloadRequested) return

    tree.value = children
    hasNativeSnapshot = !useCachedTree
    buildBookmarkNodeIndex(children)
    ensureBookmarkListeners()

    if (!hasBookmarkContent(children)) {
      showNativeTree()
      if (worker) postWorkerInit([])
      else loaded.value = true
      return
    }

    // 搜索 Worker 仅负责筛选与排序；已有原始树时先渲染，避免其启动失败或延迟使面板误显示为空。
    showNativeTree()
    initWorker()

    postWorkerInit(children)
  }

  const loadBookmarks = (forceNative = false): Promise<void> => {
    if (loadTask) {
      if (forceNative) reloadRequested = true
      return loadTask
    }
    hasNativeSnapshot = false
    const task = Promise.resolve()
      .then(async () => {
        if (loadTask !== task) return
        forceNative ||= reloadRequested
        do {
          reloadRequested = false
          try {
            await readBookmarks(forceNative)
          } catch (error) {
            // 读取失败期间若又收到变更，仍完成已请求的原生刷新。
            if (!reloadRequested || loadTask !== task) throw error
          }
          forceNative = true
        } while (reloadRequested && loadTask === task)
      })
      .finally(() => {
        if (loadTask === task) loadTask = null
      })
    loadTask = task
    return task
  }

  const moveBookmark = async (
    id: string,
    destination: Parameters<typeof browser.bookmarks.move>[1],
  ) => {
    const move = { id, receivedEvent: false }
    pendingMoves.add(move)
    try {
      await browser.bookmarks.move(id, destination)
    } catch (error) {
      if (pendingMoves.delete(move) && move.receivedEvent) reloadBookmarks('failed move')
      throw error
    }
    // 面板关闭后不再重新启动加载；关闭前已收到的事件也随 Store 一起失效。
    if (!pendingMoves.delete(move)) return
    // move 返回值缺少父文件夹修改时间，使用原生快照保持排序元数据完整。
    await loadBookmarks(true)
  }

  const _setSortMode = (mode: SortMode) => {
    if (sortMode.value === mode) return
    sortMode.value = mode
  }

  const setSortMode = (mode: SortMode) => {
    if (sortMode.value === mode) return
    sortMode.value = mode
    postWorkerFilter()
  }

  const terminateWorker = () => {
    if (languageChangedListener) {
      i18next.off('languageChanged', languageChangedListener)
      languageChangedListener = null
    }

    for (const cleanup of bookmarkListenerCleanups.values()) {
      try {
        cleanup()
      } catch (error) {
        console.warn('[bookmark] Failed to remove listener:', error)
      }
    }
    bookmarkListenerCleanups.clear()
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
    loadTask = null
    reloadRequested = false
    pendingMoves.clear()
    terminateWorker()
    hasNativeSnapshot = false
    tree.value = []
    filteredResult.value = []
    firstMatchPath.value = []
    bookmarkNodeIndex.clear()
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
    loadBookmarks,
    moveBookmark,
    getBookmarkNode,
    getBookmarkChildrenCount,
    isBookmarkSelfOrDescendant,
    _setSortMode,
    setSortMode,
    updateFilteredResult: postWorkerFilter,
    dispose,
  }
})
