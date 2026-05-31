// shared/media/faviconFetch.ts
import { browser } from '#imports'

import {
  clearFaviconCacheEntries,
  deleteFaviconCacheEntry,
  FAVICON_CACHE_TTL,
  getFaviconCacheEntry,
  setFaviconCacheEntry,
  type FaviconCacheEntry,
} from './faviconCache'

const isChromium = import.meta.env.CHROME || import.meta.env.EDGE || import.meta.env.OPERA

// ---------------------------------------------------------------------------
// 图标缓存总开关（由设置控制，默认关闭）
// ---------------------------------------------------------------------------
let _cacheEnabled = false
let cacheGeneration = 0

/** 由 newtab main.ts 在设置加载后调用以初始化缓存行为，并在设置变更时再次调用。 */
export function setFaviconCacheEnabled(enabled: boolean): void {
  _cacheEnabled = enabled
}

/** 清空 favicon 的内存缓存与持久化缓存。 */
export async function clearFaviconCache(): Promise<void> {
  cacheGeneration += 1

  for (const timer of cleanupTimers.values()) {
    clearTimeout(timer)
  }

  cleanupTimers.clear()
  refCounts.clear()
  l1Cache.clear()

  await clearFaviconCacheEntries()
}

// ---------------------------------------------------------------------------
// L1 内存缓存（会话生命周期），带简单 LRU 驱逐策略
// ---------------------------------------------------------------------------
const L1_MAX_SIZE = 200
const l1Cache = new Map<string, FaviconCacheEntry>()

// 去重：防止对同一 origin 发起多个并发请求
const pendingFetches = new Map<string, Promise<string | null>>()

// ---------------------------------------------------------------------------
// 引用计数（会话生命周期）
// ---------------------------------------------------------------------------
const refCounts = new Map<string, number>()
// 引用计数降到零后安排的清理定时器（避免立即对 L2 造成抖动）
const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()
// 在最后一次 release 后真正移除 L1/L2 条目的延迟（毫秒）
const CLEANUP_DELAY_MS = 10_000

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
/** 写入 L1 缓存，超过上限时驱逐无引用的最旧条目 */
function l1Set(key: string, entry: FaviconCacheEntry): void {
  // Map 的插入顺序就是 LRU 顺序，删后重插可刷新位置
  l1Cache.delete(key)
  l1Cache.set(key, entry)
  if (l1Cache.size <= L1_MAX_SIZE) return
  // 驱逐最早插入且无引用的条目
  for (const [k] of l1Cache) {
    if ((refCounts.get(k) ?? 0) > 0) continue
    l1Cache.delete(k)
    if (l1Cache.size <= L1_MAX_SIZE) return
  }
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

/** 策略 _：使用 Chromium 内部的 /_favicon/ API（返回 base64） */
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
  const origin = toOrigin(pageUrl)
  if (!origin) return null

  // 缓存未启用 → 直接抓取，结果仅写入 L1（会话级）以避免翻页时图标闪烁，不持久化到 L2
  if (!_cacheEnabled) {
    // L1 命中（会话内缓存）
    const l1 = l1Cache.get(origin)
    if (l1) return l1.data

    // 去重：防止对同一 origin 发起多个并发请求
    const existing = pendingFetches.get(origin)
    if (existing) return existing

    const promise = (async (): Promise<string | null> => {
      let data: string | null = null
      let type: FaviconCacheEntry['type'] = 'base64'
      if (isChromium) {
        data = await fetchViaChromeFaviconApi(pageUrl)
      }
      if (!data) {
        data = await fetchViaThirdPartyServices(pageUrl)
      }
      // 最后回退到 Image 探测（仅返回 URL）
      if (!data) {
        data = await probeViaImageElement(pageUrl)
        if (data) type = 'url'
      }
      // 写入 L1，供翻页等场景避免图标重复闪烁（不持久化到 L2）
      if (data) {
        l1Set(origin, { data, type, fetchedAt: Date.now() })
      }
      return data
    })()

    pendingFetches.set(origin, promise)
    try {
      return await promise
    } finally {
      pendingFetches.delete(origin)
    }
  }

  // L1 hit
  const l1 = l1Cache.get(origin)
  if (l1) {
    const expired = Date.now() - l1.fetchedAt > FAVICON_CACHE_TTL
    if (!expired) return l1.data
    // 已过期 → 立即返回旧值，同时在后台刷新
    refreshInBackground(pageUrl, origin)
    return l1.data
  }

  // L2 hit
  const l2 = await getFaviconCacheEntry(origin)
  if (l2) {
    l1Set(origin, l2)
    const expired = Date.now() - l2.fetchedAt > FAVICON_CACHE_TTL
    if (!expired) return l2.data
    refreshInBackground(pageUrl, origin)
    return l2.data
  }

  // 缓存未命中 → 立即抓取（已去重）
  return doFetch(pageUrl, origin)
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

    // 不可信，会返回空的默认图标
    // 策略 _：Chromium 内部的 /_favicon/ API（不需要主机权限）
    // if (isChromium) {
    //   data = await fetchViaChromeFaviconApi(pageUrl)
    // }

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
      // 始终保留到 L1（会话）；仅当该 origin 有引用时才持久化到 L2
      l1Set(origin, entry)
      const refCount = refCounts.get(origin) ?? 0
      if (refCount > 0) {
        await setFaviconCacheEntry(origin, entry).catch(() => {})
      }
    }

    return data
  })()

  pendingFetches.set(origin, promise)
  try {
    return await promise
  } finally {
    pendingFetches.delete(origin)
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
  if (l1 && Date.now() - l1.fetchedAt <= FAVICON_CACHE_TTL) return null
  const l2 = await getFaviconCacheEntry(origin)
  if (l2 && Date.now() - l2.fetchedAt <= FAVICON_CACHE_TTL) {
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
    l1Set(origin, entry)
    const refCount = refCounts.get(origin) ?? 0
    if (refCount > 0) {
      await setFaviconCacheEntry(origin, entry).catch(() => {})
    }
  }
  if (finalType === 'base64') return finalData
  return null
}

/** 增加 pageUrl 对应 origin 的引用计数。 */
export function acquireFaviconRef(pageUrl: string): void {
  if (!_cacheEnabled) return
  const origin = toOrigin(pageUrl)
  if (!origin) return

  // 取消该 origin 上任何挂起的清理定时器
  const timer = cleanupTimers.get(origin)
  if (timer) {
    clearTimeout(timer)
    cleanupTimers.delete(origin)
  }

  refCounts.set(origin, (refCounts.get(origin) ?? 0) + 1)
}

/**
 * 减少 pageUrl 对应 origin 的引用计数。
 * 当计数降为 0 时，会在短延迟后安排清理 L1/L2 缓存。
 * 若该 origin 有正在进行的抓取，会先等待抓取结束再执行最终删除。
 */
export function releaseFaviconRef(pageUrl: string): void {
  if (!_cacheEnabled) return
  const origin = toOrigin(pageUrl)
  if (!origin) return
  const next = (refCounts.get(origin) ?? 0) - 1
  if (next <= 0) {
    refCounts.delete(origin)

    // 安排延迟清理，避免与并发抓取或短暂的 UI 变化发生竞态
    const performCleanup = async () => {
      try {
        // 如果该 origin 有正在进行的抓取，先等待其完成
        const pending = pendingFetches.get(origin)
        if (pending) {
          await pending.catch(() => {})
        }

        // 若期间获取到新引用，则取消清理
        if ((refCounts.get(origin) ?? 0) > 0) return

        l1Cache.delete(origin)
        await deleteFaviconCacheEntry(origin).catch(() => {})
      } finally {
        cleanupTimers.delete(origin)
      }
    }

    const timer = setTimeout(performCleanup, CLEANUP_DELAY_MS)
    cleanupTimers.set(origin, timer)
  } else {
    refCounts.set(origin, next)
  }
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
