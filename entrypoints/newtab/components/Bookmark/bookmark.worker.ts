/// <reference lib="webworker" />
import type { Browser } from 'wxt/browser'

import { SortMode } from '@/shared/enums'

type BookmarkTreeNode = Browser.bookmarks.BookmarkTreeNode

let tree: BookmarkTreeNode[] = []
// 扁平索引：id -> { node, parents, titleLower, urlLower }
let indexMap: Record<
  string,
  {
    node: BookmarkTreeNode
    parents: string[]
    titleLower: string
    urlLower: string
    isFolder: boolean
  }
> = {}

let cachedAllIds: string[] = []
const collatorCache = new Map<string, Intl.Collator>()

function getCollator(language: string) {
  if (!collatorCache.has(language)) {
    collatorCache.set(language, new Intl.Collator(language))
  }
  return collatorCache.get(language)!
}

//缓存排序树及其 sortMode 以避免重新计算
let cachedSortedTree: BookmarkTreeNode[] | null = null
let cachedSortedTreeKey: SortMode | null = null
let currentLanguage = 'zh-CN'

// 缓存最近一次查询的结果 id 列表（用于前缀查询优化）
let lastQuery = ''
let lastResultIds: string[] = []

// --------------------------------------------------------------------------
// 辅助函数
// --------------------------------------------------------------------------

function createComparator(mode: SortMode, origIndexMap: Map<string, number>, language: string) {
  const collator = getCollator(language)
  return (a: BookmarkTreeNode, b: BookmarkTreeNode) => {
    const aIsFolder = Array.isArray(a.children)
    const bIsFolder = Array.isArray(b.children)

    // 将文件夹强制排在最前
    if (aIsFolder !== bIsFolder && mode !== SortMode.Original) return aIsFolder ? -1 : 1

    const bothFolders = aIsFolder && bIsFolder
    const bothLinks = !aIsFolder && !bIsFolder

    const titleA = a.title || ''
    const titleB = b.title || ''

    // 按本地化名称排序
    const compareName = () => collator.compare(titleA, titleB)

    // 按创建时间排序
    const compareCreated = () =>
      mode === SortMode.CreatedAsc
        ? (a.dateAdded ?? 0) - (b.dateAdded ?? 0)
        : (b.dateAdded ?? 0) - (a.dateAdded ?? 0)

    // 按修改时间排序（仅文件夹）
    const modA = a.dateGroupModified ?? 0
    const modB = b.dateGroupModified ?? 0
    const compareModified = () => (mode === SortMode.ModifiedAsc ? modA - modB : modB - modA)

    switch (mode) {
      case SortMode.NameAsc:
        return compareName()
      case SortMode.NameDesc:
        return -compareName()
      case SortMode.Original:
        return (origIndexMap.get(a.id) ?? 0) - (origIndexMap.get(b.id) ?? 0)
      case SortMode.CreatedAsc:
      case SortMode.CreatedDesc:
        return compareCreated()
      case SortMode.ModifiedAsc:
      case SortMode.ModifiedDesc:
        if (bothFolders) return compareModified()
        else if (bothLinks) return 0
    }
    return 0
  }
}

/**
 * 复制并按层排序书签树节点。
 * @param nodes 当前层节点
 * @param depth 当前深度（根为0）
 * @param mode 排序模式
 * @returns 排序后的节点树
 */
function cloneAndSortTree(
  nodes: BookmarkTreeNode[] | undefined,
  depth: number,
  mode: SortMode,
  language: string,
): BookmarkTreeNode[] {
  if (!nodes || nodes.length === 0) return []

  const origIndexMap = new Map<string, number>()
  for (let i = 0; i < nodes.length; i++) origIndexMap.set(nodes[i]!.id, i)

  const copied: BookmarkTreeNode[] = Array.from({ length: nodes.length })
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!
    const c: BookmarkTreeNode = { ...n }
    if (n.children !== undefined) {
      c.children = cloneAndSortTree(n.children, depth + 1, mode, language)
    }
    copied[i] = c
  }

  // 仅对子层进行排序（保留根的原始顺序以便稳定性）
  if (depth > 0) {
    const comparator = createComparator(mode, origIndexMap, language)
    copied.sort(comparator)
  }

  return copied
}

// rebuild 会根据 matchedIds/keepIds 重建分支，
// 在首次发现匹配路径时调用 onFirstPath 回调传回路径。
function createRebuild(
  matchedIds: Set<string>,
  keepIds: Set<string>,
  onFirstPath: (p: string[]) => void,
) {
  let foundFirst = false
  return function rebuild(node: BookmarkTreeNode, parents: string[]): BookmarkTreeNode | null {
    if (!keepIds.has(node.id)) return null

    const isFolder = !!node.children

    if (!foundFirst && matchedIds.has(node.id)) {
      foundFirst = true
      onFirstPath(isFolder ? [...parents, node.id] : parents)
    }

    const copy: BookmarkTreeNode = { ...node }
    if (isFolder && node.children!.length) {
      const nextParents = [...parents, node.id]
      const nodeChildren = node.children!
      const children: BookmarkTreeNode[] = []
      for (let i = 0; i < nodeChildren.length; i++) {
        const c = rebuild(nodeChildren[i]!, nextParents)
        if (c) children.push(c)
      }
      if (children.length) copy.children = children
      else delete copy.children
    }

    return copy
  }
}

// --------------------------------------------------------------------------
// 主逻辑
// --------------------------------------------------------------------------

function buildIndex() {
  const map: typeof indexMap = {}

  const stack: Array<{ nodes: BookmarkTreeNode[]; parents: string[] }> = [
    { nodes: tree, parents: [] },
  ]

  while (stack.length) {
    const { nodes, parents } = stack.pop()!
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!
      const isFolder = node.children !== undefined
      map[node.id] = {
        node,
        parents,
        titleLower: (node.title || '').toLowerCase(),
        urlLower: node.url ? node.url.toLowerCase() : '',
        isFolder,
      }

      if (isFolder && node.children!.length) {
        stack.push({ nodes: node.children!, parents: [...parents, node.id] })
      }
    }
  }

  indexMap = map
  cachedAllIds = Object.keys(map)

  // 重置缓存
  lastQuery = ''
  lastResultIds = []
  // 使已排序缓存无效
  cachedSortedTree = null
  cachedSortedTreeKey = null
}

// 只读获取排序树。优先返回已缓存版本（如果存在并匹配 sortMode），
function getSortedTree(mode: SortMode): BookmarkTreeNode[] {
  if (mode === SortMode.Original) return tree

  // 检查缓存
  if (cachedSortedTree && cachedSortedTreeKey === mode) {
    return cachedSortedTree
  }

  const sorted = cloneAndSortTree(tree, 0, mode, currentLanguage)

  // 缓存按当前排序/语言生成的结果
  cachedSortedTree = sorted
  cachedSortedTreeKey = mode

  return sorted
}

function filter(query: string, mode: SortMode) {
  const q = query.trim().toLowerCase()
  const source = getSortedTree(mode)

  if (!q) {
    // 如果没有查询，返回完整排序树并默认展开第一个有内容的顶层目录
    let firstMatchPath: string[] = []
    for (let i = 0; i < source.length; i++) {
      const n = source[i]!
      if (n.children && n.children.length) {
        firstMatchPath = [n.id]
        break
      }
    }

    return {
      filteredResult: source,
      firstMatchPath,
    }
  }

  // 1) 确定候选 id 集（若为前缀查询则使用上次缓存减少扫描）
  let candidateIds: string[] = cachedAllIds
  if (lastQuery && q.startsWith(lastQuery) && lastResultIds?.length) {
    candidateIds = lastResultIds
  }

  // 2) 在候选中找出直接匹配的节点 id
  const matchedIds = new Set<string>()
  for (const id of candidateIds) {
    const entry = indexMap[id]
    if (!entry) continue
    if (entry.titleLower.includes(q) || (entry.urlLower && entry.urlLower.includes(q))) {
      matchedIds.add(id)
    }
  }

  if (matchedIds.size === 0) {
    lastQuery = q
    lastResultIds = []
    return {
      filteredResult: [],
      firstMatchPath: [],
    }
  }

  // 3) 扩展结果集以包含匹配节点的所有祖先（以便能在树结构中展示匹配路径）
  const keepIds = new Set<string>(matchedIds)

  // 先收集所有祖先
  for (const id of matchedIds) {
    const parents = indexMap[id]?.parents
    if (parents) {
      for (let i = 0; i < parents.length; i++) keepIds.add(parents[i]!)
    }
  }

  // 再为匹配到的文件夹添加所有后代
  for (const id of matchedIds) {
    const entry = indexMap[id]
    if (!entry?.isFolder || !entry.node.children?.length) continue

    const stack = entry.node.children.slice()
    while (stack.length) {
      const current = stack.pop()!
      if (keepIds.has(current.id)) continue
      keepIds.add(current.id)
      if (current.children?.length) {
        for (let i = 0; i < current.children.length; i++) stack.push(current.children[i]!)
      }
    }
  }

  // 4) 基于 keepIds 从排序树中重建仅保留需要的分支（只遍历保留分支）
  //    同时在一次遍历中确定首个匹配路径以避免重复遍历。
  let firstPath: string[] | null = null
  const onFirstPath = (p: string[]) => {
    if (!firstPath) firstPath = p
  }

  const rebuild = createRebuild(matchedIds, keepIds, onFirstPath)

  const result: BookmarkTreeNode[] = []
  for (let i = 0; i < source.length; i++) {
    const n = rebuild(source[i]!, [])
    if (n) result.push(n)
  }

  // 5) 更新缓存（用于前缀查询加速）以及首个匹配路径
  lastQuery = q
  lastResultIds = Array.from(matchedIds)

  return {
    filteredResult: result,
    firstMatchPath: firstPath ?? [],
  }
}

// --------------------------------------------------------------------------
// 消息处理
// --------------------------------------------------------------------------

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data

  try {
    switch (type) {
      case 'INIT':
        tree = payload.tree
        if (payload.language) currentLanguage = payload.language
        // 构建扁平索引，供后续搜索使用
        buildIndex()
        // 初始过滤（空查询）
        const initialSortMode = payload.sortMode || SortMode.NameAsc
        const initRes = filter('', initialSortMode)
        self.postMessage({
          type: 'INIT_DONE',
          ...initRes,
          // 主线程已经持有原始树，无需再结构化克隆并回传一份。
          filteredResult: initialSortMode === SortMode.Original ? null : initRes.filteredResult,
        })
        break

      case 'UPDATE_SETTINGS':
        if (payload.language) currentLanguage = payload.language
        // 语言改变使缓存失效
        // 目前，如果语言影响排序，清空缓存是最安全的做法
        cachedSortedTree = null
        cachedSortedTreeKey = null
        break

      case 'FILTER':
        const { query, sortMode } = payload as {
          query: string
          sortMode: SortMode
          language: string
        }
        const res = filter(query, sortMode)
        self.postMessage({ type: 'FILTER_DONE', ...res })
        break
    }
  } catch (err) {
    console.error('Worker error:', err)
    self.postMessage({ type: 'ERROR', error: String(err) })
  }
}

self.postMessage({ type: 'READY' })
