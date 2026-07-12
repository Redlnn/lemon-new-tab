// shared/media/faviconFetch.ts
import { browser } from '#imports'
import { ref } from 'vue'

import {
  clearFaviconCacheEntries,
  FAVICON_CACHE_TTL,
  getAllFaviconCacheEntries,
  getFaviconCacheEntry,
  pruneFaviconCacheEntries,
  setFaviconCacheEntries,
  setFaviconCacheEntry,
  type FaviconCacheEntry,
} from './faviconCache'

const isChromium = import.meta.env.CHROME || import.meta.env.EDGE || import.meta.env.OPERA

// ---------------------------------------------------------------------------
// 图标缓存总开关（由设置控制，默认关闭）
// ---------------------------------------------------------------------------
let _cacheEnabled = false
let cacheGeneration = 0
let cleanupTimer: ReturnType<typeof setTimeout> | null = null
let l2MutationQueue = Promise.resolve()
let faviconHydrationTask: Promise<unknown> | null = null
let startupFaviconRequestCount = 0
let faviconRevealVersion = 0

/** 持久化缓存完成整批预热后再挂载含动态图标的首屏区域。 */
export const faviconCacheReady = ref(true)

function scheduleFaviconReveal(): void {
  const version = ++faviconRevealVersion
  queueMicrotask(() => {
    if (
      version === faviconRevealVersion &&
      !faviconHydrationTask &&
      startupFaviconRequestCount === 0
    ) {
      faviconCacheReady.value = true
    }
  })
}

function queueL2Mutation(task: () => Promise<void>): Promise<void> {
  const next = l2MutationQueue.then(task, task)
  l2MutationQueue = next.catch(() => {})
  return next
}

function cancelScheduledCleanup(): void {
  if (cleanupTimer) clearTimeout(cleanupTimer)
  cleanupTimer = null
}

function schedulePersistentCleanup(generation: number): void {
  if (cleanupTimer) return
  cleanupTimer = setTimeout(() => {
    cleanupTimer = null
    void queueL2Mutation(async () => {
      if (!_cacheEnabled || generation !== cacheGeneration) return
      await pruneFaviconCacheEntries()
    })
  }, 250)
}

async function persistL1Cache(generation: number): Promise<void> {
  const entries = [...l1Cache.entries()]
  await queueL2Mutation(async () => {
    if (!_cacheEnabled || generation !== cacheGeneration) return
    await setFaviconCacheEntries(entries)
  })
  if (_cacheEnabled && generation === cacheGeneration) schedulePersistentCleanup(generation)
}

/** 由 newtab main.ts 在设置加载后调用以初始化缓存行为，并在设置变更时再次调用。 */
export function setFaviconCacheEnabled(enabled: boolean): void {
  if (_cacheEnabled === enabled) return
  _cacheEnabled = enabled
  cacheGeneration += 1
  cancelScheduledCleanup()
  if (enabled) void persistL1Cache(cacheGeneration)
}

/**
 * 在 UI 挂载前将持久缓存一次性提升到 L1，避免每个图标分别等待 IndexedDB 后逐个出现。
 * 读取期间若缓存开关或 generation 变化，则直接丢弃本次结果。
 */
export async function hydrateFaviconCache(enabled: boolean): Promise<void> {
  setFaviconCacheEnabled(enabled)
  faviconCacheReady.value = !enabled
  if (!enabled) return

  const generationAtStart = cacheGeneration
  const entriesTask = getAllFaviconCacheEntries()
  faviconHydrationTask = entriesTask
  try {
    const entries = await entriesTask
    if (!_cacheEnabled || generationAtStart !== cacheGeneration) return

    entries.sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)
    for (const [origin, entry] of entries) l1Set(origin, entry)
    schedulePersistentCleanup(generationAtStart)
  } finally {
    if (faviconHydrationTask === entriesTask) faviconHydrationTask = null
    scheduleFaviconReveal()
  }
}

/** 清空 favicon 的内存缓存与持久化缓存。 */
export async function clearFaviconCache(): Promise<void> {
  cacheGeneration += 1
  cancelScheduledCleanup()
  pendingFetches.clear()
  l1Cache.clear()
  await queueL2Mutation(clearFaviconCacheEntries)
}

// ---------------------------------------------------------------------------
// L1 内存缓存（会话生命周期），带简单 LRU 驱逐策略
// ---------------------------------------------------------------------------
const L1_MAX_SIZE = 200
const l1Cache = new Map<string, FaviconCacheEntry>()

// 去重：防止对同一 origin 发起多个并发请求
const pendingFetches = new Map<string, Promise<string | null>>()

// ---------------------------------------------------------------------------
// 常见 favicon 路径（策略 B/D 共用）
// ---------------------------------------------------------------------------
const COMMON_FAVICON_PATHS = [
  '/favicon.ico',
  '/favicon.png',
  '/favicon.svg',
  '/favicon.webp',
  '/apple-touch-icon.png',
] as const

const PAGE_LINK_ICON_SCAN_LIMIT = 256 * 1024
const LINK_TAG_RE = /<link\b[^>]*>/gi
const HTML_ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

// ---------------------------------------------------------------------------
// L1 缓存 LRU 辅助
// ---------------------------------------------------------------------------
/** 写入 L1 缓存，超过上限时驱逐最旧条目。 */
function l1Set(key: string, entry: FaviconCacheEntry): void {
  l1Cache.delete(key)
  l1Cache.set(key, entry)
  while (l1Cache.size > L1_MAX_SIZE) {
    const oldestKey = l1Cache.keys().next().value
    if (oldestKey === undefined) break
    l1Cache.delete(oldestKey)
  }
}

function l1Get(key: string): FaviconCacheEntry | undefined {
  const entry = l1Cache.get(key)
  if (!entry) return undefined
  l1Cache.delete(key)
  l1Cache.set(key, entry)
  return entry
}

function isFreshFaviconEntry(entry: FaviconCacheEntry): boolean {
  return Date.now() - entry.fetchedAt <= FAVICON_CACHE_TTL
}

async function writeFaviconCacheEntry(
  origin: string,
  entry: FaviconCacheEntry,
  generation: number,
): Promise<void> {
  if (generation !== cacheGeneration) return
  l1Set(origin, entry)
  if (!_cacheEnabled) return

  await queueL2Mutation(async () => {
    if (!_cacheEnabled || generation !== cacheGeneration) return
    await setFaviconCacheEntry(origin, entry)
  })
  if (_cacheEnabled && generation === cacheGeneration) schedulePersistentCleanup(generation)
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/** 将 Blob 转换为 base64 数据 URL */
function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/** 从任意 URL 字符串中提取规范化的 origin（例如 https://example.com）。若解析失败则返回 null。 */
function toOrigin(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** 从 <link> 标签字符串中解析出属性键值对。 */
function parseHtmlAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const source = tag.replace(/^<link\b/i, '').replace(/\/?\s*>$/, '')

  for (const match of source.matchAll(HTML_ATTR_RE)) {
    const name = match[1]?.toLowerCase()
    if (!name) continue
    attrs[name] = (match[2] ?? match[3] ?? match[4] ?? '').trim()
  }

  return attrs
}

/** 给定图标 URL，尝试获取其内容并转换为 base64 数据 URL。失败时返回 null。 */
async function fetchIconAsDataUrl(iconUrl: string): Promise<string | null> {
  if (iconUrl.startsWith('data:')) return iconUrl

  try {
    const resp = await fetch(iconUrl, { signal: AbortSignal.timeout(5000) })
    if (!resp.ok) return null
    const contentType = resp.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) return null
    const blob = await resp.blob()
    if (blob.size === 0) return null
    return await blobToDataURL(blob)
  } catch {
    return null
  }
}

/** 在给定 HTML 片段中扫描 <link> 标签，尝试获取其中声明的 favicon 图标。会跳过已尝试过的 URL。 */
async function tryFetchIconFromDiscoveredLinkTags(
  pageUrl: string,
  html: string,
  state: { processedIndex: number; attemptedIconUrls: Set<string> },
): Promise<string | null> {
  LINK_TAG_RE.lastIndex = state.processedIndex

  const fluidIconCandidates: string[] = []
  const appleTouchCandidates: string[] = []
  const genericIconCandidates: string[] = []

  let match: RegExpExecArray | null
  while ((match = LINK_TAG_RE.exec(html)) !== null) {
    state.processedIndex = LINK_TAG_RE.lastIndex

    const linkTag = match[0]
    const attrs = parseHtmlAttributes(linkTag)
    const rel = attrs.rel?.toLowerCase() ?? ''
    const href = attrs.href?.trim() ?? ''
    if (!rel || !href) continue

    let iconUrl: string | null = null
    try {
      const u = new URL(href, pageUrl)
      if (!['http:', 'https:', 'data:', 'blob:'].includes(u.protocol)) continue
      iconUrl = u.toString()
    } catch {
      continue
    }

    if (!iconUrl || state.attemptedIconUrls.has(iconUrl)) continue
    state.attemptedIconUrls.add(iconUrl)

    if (rel.includes('fluid-icon')) {
      fluidIconCandidates.push(iconUrl)
      continue
    }

    if (rel.includes('apple-touch-icon')) {
      appleTouchCandidates.push(iconUrl)
      continue
    }

    if (rel.includes('icon')) {
      genericIconCandidates.push(iconUrl)
    }
  }

  for (const candidateGroup of [fluidIconCandidates, appleTouchCandidates]) {
    for (const iconUrl of candidateGroup) {
      const data = await fetchIconAsDataUrl(iconUrl)
      if (data) return data
    }
  }

  const svgCandidates = genericIconCandidates.filter((str) => str.toLowerCase().endsWith('.svg'))
  const genericFallbackCandidates =
    svgCandidates.length > 0
      ? genericIconCandidates.filter((str) => !str.toLowerCase().endsWith('.svg'))
      : genericIconCandidates

  for (const iconUrl of svgCandidates) {
    const data = await fetchIconAsDataUrl(iconUrl)
    if (data) return data
  }

  for (const iconUrl of genericFallbackCandidates) {
    const data = await fetchIconAsDataUrl(iconUrl)
    if (data) return data
  }

  return null
}

/** 已知的无效 SVG 特征字符串（第三方 favicon 服务在找不到图标时返回的占位图）
 *  - favicon.so：代码图标（path 浮点坐标，误判风险极低）
 */
const KNOWN_INVALID_SVG_SIGNATURES = ['M5.719 14.75'] as const

/** 判断 SVG 文本是否是已知的无效占位 SVG */
function isKnownInvalidSvg(text: string): boolean {
  // favicon.so：使用路径特征字符串（浮点坐标极具唯一性，误判风险极低）
  if (KNOWN_INVALID_SVG_SIGNATURES.some((sig) => text.includes(sig))) return true
  // favicon.im：灰色圆形 + 斜体 "f" 占位图（不依赖属性顺序，分别检测）
  if (
    text.includes('cx="50" cy="50" r="40" fill="#808080"') &&
    text.includes('font-style="italic"') &&
    text.includes('>f<')
  )
    return true
  return false
}

/** 使用 HTMLImageElement 试探给定 URL 是否可用（无需 CORS，基于加载结果判断）。 */
function probeImageUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image()

    let settled = false
    const done = (result: boolean) => {
      if (settled) return
      settled = true

      clearTimeout(timer)
      img.onload = null
      img.onerror = null

      // 尝试中断加载（有些浏览器有效）
      img.src = ''

      resolve(result)
    }

    const timer = setTimeout(() => done(false), 5000)

    img.onload = () => done(true)
    img.onerror = () => done(false)

    img.src = url
  })
}

// ---------------------------------------------------------------------------
// 获取策略
// ---------------------------------------------------------------------------

/** 使用 Chromium 内部 favicon API 快速读取浏览器已有图标。 */
async function fetchViaChromeFaviconApi(pageUrl: string): Promise<string | null> {
  try {
    const apiUrl = new URL(chrome.runtime.getURL('/_favicon/'))
    apiUrl.searchParams.set('pageUrl', pageUrl)
    apiUrl.searchParams.set('size', '128')
    const resp = await fetch(apiUrl.toString())
    if (!resp.ok) return null
    const blob = await resp.blob()
    if (blob.size === 0) return null
    return blobToDataURL(blob)
  } catch {
    return null
  }
}

/** 策略 C：并行请求第三方 favicon 服务（favicon.so & favicon.im），取最快且有效的一个，返回 base64 */
async function fetchViaThirdPartyServices(pageUrl: string): Promise<string | null> {
  try {
    const { hostname } = new URL(pageUrl)
    if (!hostname) return null

    const endpoints = [`https://favicon.so/${hostname}`, `https://favicon.im/${hostname}`]

    // 为每个请求创建一个可中断的 controller，并配合定时器实现超时
    const controllers = endpoints.map(() => new AbortController())
    const timers: ReturnType<typeof setTimeout>[] = controllers.map((c) =>
      // 5s 超时后中止对应请求
      setTimeout(() => c.abort(), 5000),
    )

    const attempts = endpoints.map((u, idx) =>
      (async (): Promise<string> => {
        const controller = controllers[idx]
        const resp = await fetch(u, { signal: controller.signal })
        if (!resp.ok) throw new Error('bad status')
        const contentType = resp.headers.get('content-type') ?? ''
        if (contentType.startsWith('text/') || contentType.includes('html'))
          throw new Error('invalid content-type')
        const blob = await resp.blob()
        if (blob.size === 0) throw new Error('empty')
        if (contentType.includes('svg') || blob.type.includes('svg')) {
          const text = await blob.text()
          if (isKnownInvalidSvg(text)) throw new Error('known invalid svg')
        }
        return await blobToDataURL(blob)
      })(),
    )

    try {
      const result = await Promise.any(attempts)
      // 成功后中断所有剩余请求
      controllers.forEach((c) => {
        try {
          c.abort()
        } catch {}
      })
      return result
    } catch {
      // 所有请求都失败
      return null
    } finally {
      timers.forEach(clearTimeout)
    }
  } catch {
    return null
  }
}

/** 策略 B：尝试常见的 favicon 路径并获取 base64。
 *  需要授予泛域名主机权限（允许访问任意域名）。 */
async function fetchViaDirectUrls(pageUrl: string): Promise<string | null> {
  const { origin } = new URL(pageUrl)
  try {
    return await Promise.any(
      COMMON_FAVICON_PATHS.map(async (path) => {
        const resp = await fetch(origin + path, { signal: AbortSignal.timeout(5000) })
        if (!resp.ok) throw new Error('not ok')
        const contentType = resp.headers.get('content-type') ?? ''
        if (contentType.startsWith('text/') || contentType.includes('html')) throw new Error('html')
        const blob = await resp.blob()
        if (blob.size === 0) throw new Error('empty')
        return blobToDataURL(blob)
      }),
    )
  } catch {
    return null
  }
}

/** 策略 A：通过读取目标页面的 <link rel="icon"> 标签获取 favicon
 * 需要授予泛域名主机权限（允许访问任意域名）。 */
async function fetchViaPageLinkIcon(pageUrl: string): Promise<string | null> {
  // 只扫描前一小段 HTML / head，避免为找 favicon 读取整页内容。
  try {
    const resp = await fetch(pageUrl, { signal: AbortSignal.timeout(5000) })
    if (!resp.ok) return null
    const contentType = resp.headers.get('content-type') ?? ''
    if (!contentType.includes('html') && !contentType.startsWith('text/')) return null

    const reader = resp.body?.getReader()
    if (!reader) return null

    const decoder = new TextDecoder()
    let html = ''
    const state = {
      processedIndex: 0,
      attemptedIconUrls: new Set<string>(),
    }

    try {
      while (html.length < PAGE_LINK_ICON_SCAN_LIMIT) {
        const { value, done } = await reader.read()
        if (done) break

        html += decoder.decode(value, { stream: true })

        const data = await tryFetchIconFromDiscoveredLinkTags(pageUrl, html, state)
        if (data) return data

        if (/<\/head>/i.test(html)) break
      }

      html += decoder.decode()
      return await tryFetchIconFromDiscoveredLinkTags(pageUrl, html, state)
    } finally {
      try {
        await reader.cancel()
      } catch {}
    }
  } catch {
    return null
  }
}

/** 策略 D：通过 Image 元素探测常见路径（无需 CORS，仅返回 URL）。 */
async function probeViaImageElement(pageUrl: string): Promise<string | null> {
  const { origin } = new URL(pageUrl)
  try {
    return await Promise.any(
      COMMON_FAVICON_PATHS.map(async (path) => {
        const url = origin + path
        if (await probeImageUrl(url)) return url
        throw new Error('probe failed')
      }),
    )
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 主要对外接口
// ---------------------------------------------------------------------------

/**
 * 返回 pageUrl 的 favicon，优先查询 L1（内存）→ L2（持久化）缓存。
 * 若命中但已过期，会在后台异步刷新并更新缓存；函数会立即返回当前（可能已过期或默认的）值，避免阻塞 UI。
 *
 * 返回值为 base64 数据 URL 或普通 URL（可通过前缀 'data:' 判断）。
 * 若完全不可用则返回 null（调用方应展示兜底图标）。
 */
export async function fetchFaviconWithCache(pageUrl: string): Promise<string | null> {
  const belongsToStartupBatch = !faviconCacheReady.value
  if (belongsToStartupBatch) startupFaviconRequestCount += 1

  try {
    // 启动预热期间的所有消费者共用同一个批量读取，避免退化为逐条 IndexedDB 查询。
    if (faviconHydrationTask) await faviconHydrationTask

    const origin = toOrigin(pageUrl)
    if (!origin) return null

    const l1 = l1Get(origin)
    if (l1) {
      if (isFreshFaviconEntry(l1)) return l1.data
      refreshInBackground(pageUrl, origin)
      return l1.data
    }

    if (_cacheEnabled) {
      const generationAtRead = cacheGeneration
      const l2 = await getFaviconCacheEntry(origin)
      if (_cacheEnabled && generationAtRead === cacheGeneration && l2) {
        l1Set(origin, l2)
        if (isFreshFaviconEntry(l2)) return l2.data
        refreshInBackground(pageUrl, origin)
        return l2.data
      }
    }

    return await doFetch(pageUrl, origin)
  } finally {
    if (belongsToStartupBatch) {
      startupFaviconRequestCount = Math.max(0, startupFaviconRequestCount - 1)
      scheduleFaviconReveal()
    }
  }
}

/** 后台异步刷新（不等待结果） */
function refreshInBackground(pageUrl: string, origin: string): void {
  doFetch(pageUrl, origin).catch(() => {})
}

/** 对指定 origin 执行完整抓取（已去重）。 */
async function doFetch(pageUrl: string, origin: string): Promise<string | null> {
  // 去重处理
  const existing = pendingFetches.get(origin)
  if (existing) return existing

  const generationAtStart = cacheGeneration

  const promise = (async (): Promise<string | null> => {
    let data: string | null = null
    let type: 'base64' | 'url' = 'base64'
    const hasHostPerm = await browser.permissions
      .contains({ origins: ['*://*/*'] })
      .catch(() => false)

    // 缓存关闭时优先复用浏览器已经拥有的图标，避免每次新标签页都访问外部服务。
    if (!_cacheEnabled && isChromium) {
      data = await fetchViaChromeFaviconApi(pageUrl)
    }

    // 策略 A：读取页面声明的 icon 链接（需要主机权限）
    if (!data && hasHostPerm) {
      data = await fetchViaPageLinkIcon(pageUrl)
    }

    // 策略 B：常见直接路径抓取（需要主机权限，适用于所有浏览器）
    if (!data && hasHostPerm) {
      data = await fetchViaDirectUrls(pageUrl)
    }

    // 策略 B：尝试第三方 favicon 服务（并行请求 favicon.so & favicon.im）
    if (!data) {
      data = await fetchViaThirdPartyServices(pageUrl)
    }

    // 策略 D：通过 Image 探测（无需 CORS，仅返回 URL）
    if (!data) {
      data = await probeViaImageElement(pageUrl)
      if (data) type = 'url'
    }

    if (data && generationAtStart === cacheGeneration) {
      const entry: FaviconCacheEntry = { data, type, fetchedAt: Date.now() }
      await writeFaviconCacheEntry(origin, entry, generationAtStart)
    }

    return data
  })()

  pendingFetches.set(origin, promise)
  try {
    return await promise
  } finally {
    if (pendingFetches.get(origin) === promise) pendingFetches.delete(origin)
  }
}

/**
 * 将已知 favicon 直接写入 L1/L2 缓存，跳过网络请求。
 * 若已有未过期条目则不做任何修改。
 * 只会存进 base64，获取失败则不会缓存。
 * 目前用处：
 * - 注入浏览器提供的 favicon（例如 Firefox 的 topSites 可能为 base64）。
 * - Popup 在获取到 favicon 图片的有效 URL 后，尝试抓取并升级为 base64（需要主机权限）。
 */
export async function warmFaviconCache(
  pageUrl: string,
  faviconData: string,
  type: FaviconCacheEntry['type'] = 'url',
): Promise<string | null> {
  if (!_cacheEnabled) return null
  const origin = toOrigin(pageUrl)
  if (!origin) return null
  const generationAtStart = cacheGeneration

  const l1 = l1Cache.get(origin)
  if (l1 && isFreshFaviconEntry(l1)) return null
  const l2 = await getFaviconCacheEntry(origin)
  if (!_cacheEnabled || generationAtStart !== cacheGeneration) return null
  if (l2 && isFreshFaviconEntry(l2)) {
    // L2 命中但 L1 未命中 → 提升到 L1 避免下次重复 IDB 读取
    l1Set(origin, l2)
    return null
  }

  // 决定最终要写入缓存的数据：优先尝试将 URL 转为 base64（需要泛域名主机权限）
  let finalData = faviconData
  let finalType: FaviconCacheEntry['type'] = type

  // 已经是 base64 数据则直接使用
  if (type === 'base64' || (typeof faviconData === 'string' && faviconData.startsWith('data:'))) {
    finalType = 'base64'
  } else {
    // 对于 URL 类型，优先尝试抓取传入的 faviconData（它通常是具体图片的 URL），
    // 将其转换为 base64 后再存储。不要调用 fetchViaDirectUrls 去尝试常见路径。
    try {
      const hasHostPerm = await browser.permissions
        .contains({ origins: ['*://*/*'] })
        .catch(() => false)

      if (hasHostPerm) {
        try {
          const targetUrl = new URL(faviconData, pageUrl)
          const resp = await fetch(targetUrl, { signal: AbortSignal.timeout(5000) })
          if (resp.ok) {
            const contentType = resp.headers.get('content-type') ?? ''
            if (!contentType.startsWith('text/') && !contentType.includes('html')) {
              const blob = await resp.blob()
              if (blob.size > 0) {
                finalData = await blobToDataURL(blob)
                finalType = 'base64'
              }
            }
          }
        } catch {
          // 直接抓取失败则忽略，回落使用传入的 URL
        }
      }
    } catch {
      // 忽略任何错误，回落到传入的 faviconData
    }
  }

  if (generationAtStart === cacheGeneration) {
    const entry: FaviconCacheEntry = { data: finalData, type: finalType, fetchedAt: Date.now() }
    await writeFaviconCacheEntry(origin, entry, generationAtStart)
  }
  if (finalType === 'base64') return finalData
  return null
}

/**
 * 同步查询 L1 内存缓存，命中则返回已有数据，否则返回 null。
 * 不检查过期时间，仅供「避免翻页闪烁」等需要快速同步取值的场景使用。
 */
export function peekFaviconFromL1(pageUrl: string): string | null {
  const origin = toOrigin(pageUrl)
  if (!origin) return null
  return l1Cache.get(origin)?.data ?? null
}
