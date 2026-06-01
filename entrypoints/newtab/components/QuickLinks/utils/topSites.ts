import i18next from 'i18next'
// 由于 wxt/browser 缺少火狐的 topSites 类型定义，直接用官方的 webextension-polyfill
import type { TopSites } from 'webextension-polyfill'
import browser from 'webextension-polyfill'

import {
  acquireFaviconRef,
  fetchFaviconWithCache,
  releaseFaviconRef,
  warmFaviconCache,
} from '@/shared/media'

import { blockedTopSitesStorage } from '@newtab/shared/storages/topSitesStorage'

const TOP_SITES_TTL = 30_000 // 30 秒
let cachedTopSites: { value: TopSites.MostVisitedURL[]; ts: number } | null = null
let pendingTopSitesPromise: Promise<TopSites.MostVisitedURL[]> | null = null

function shouldUseCache(force = false) {
  if (force) return false
  if (!cachedTopSites) return false
  return Date.now() - cachedTopSites.ts <= TOP_SITES_TTL
}

async function cacheBrowserFavicons(sites: TopSites.MostVisitedURL[]): Promise<void> {
  // Firefox 可能会直接返回 favicon；预热缓存以便在列表旋转时仍能保留它们。
  // 对于没有 favicon 的站点，触发后台获取。
  const tasks = sites
    .filter((s) => s.url)
    .map(async (s) => {
      if (s.favicon) {
        // 实际上 Firefox 返回的好像总是为空
        await warmFaviconCache(s.url, s.favicon).catch(() => {})
      } else {
        await fetchFaviconWithCache(s.url).catch(() => {})
      }
    })
  await Promise.allSettled(tasks)
}

async function fetchTopSites(): Promise<TopSites.MostVisitedURL[]> {
  let topSites
  if (import.meta.env.CHROME || import.meta.env.EDGE || import.meta.env.OPERA) {
    topSites = await browser.topSites.get()
  } else if (import.meta.env.FIREFOX) {
    topSites = await browser.topSites.get({ includeFavicon: true })
  } else {
    throw new Error('Unsupported browser')
  }
  const blockedTopStites = new Set(await blockedTopSitesStorage.getValue())
  return topSites.filter((site) => !blockedTopStites.has(site.url))
}

async function getTopSites(force = false): Promise<TopSites.MostVisitedURL[]> {
  if (shouldUseCache(force)) {
    return cachedTopSites!.value
  }

  if (pendingTopSitesPromise && !force) {
    return pendingTopSitesPromise
  }

  pendingTopSitesPromise = fetchTopSites()

  try {
    const previousUrls = cachedTopSites?.value.map((s) => s.url) ?? []
    const value = await pendingTopSitesPromise
    const newUrls = value.map((s) => s.url)

    // 更新引用计数：新出现的站点 acquire，消失的站点 release
    const disappeared = previousUrls.filter((u) => !newUrls.includes(u))
    const appeared = newUrls.filter((u) => !previousUrls.includes(u))
    disappeared.forEach((u) => releaseFaviconRef(u))
    appeared.forEach((u) => acquireFaviconRef(u))

    // 在已更新引用计数后，再预热浏览器提供或自行抓取的 favicon，
    // 这样 `warmFaviconCache` 有机会将条目持久化到 L2。预热异步，不阻塞渲染。
    cacheBrowserFavicons(value).catch(() => {})

    cachedTopSites = { value, ts: Date.now() }
    return value
  } finally {
    pendingTopSitesPromise = null
  }
}

function invalidateTopSitesCache() {
  cachedTopSites = null
}

function showBlockedMessage(url: string, reloadFunc: () => Promise<void>) {
  ElMessage.success({
    message: h('p', null, [
      h(
        'span',
        { style: { color: 'var(--el-color-success)' } },
        i18next.t('newtab:quickLinks.hideTopMessage.content'),
      ),
      h(
        'span',
        {
          style: { marginLeft: '20px', color: 'var(--el-color-primary)', cursor: 'pointer' },
          onClick: async () => {
            await restoreBlockedSite(url)
            await reloadFunc()
          },
        },
        i18next.t('newtab:common.undo'),
      ),
      h(
        'span',
        {
          style: { marginLeft: '20px', color: 'var(--el-color-primary)', cursor: 'pointer' },
          onClick: async () => {
            invalidateTopSitesCache()
            await blockedTopSitesStorage.setValue([])
            await reloadFunc()
            ElMessage.success({
              message: i18next.t('newtab:quickLinks.hideTopMessage.restoreSuccess'),
            })
          },
        },
        i18next.t('newtab:quickLinks.hideTopMessage.restoreDefault'),
      ),
    ]),
  })
}

async function blockSite(url: string, reloadFunc: () => Promise<void>) {
  const list = await blockedTopSitesStorage.getValue()
  if (list.includes(url)) {
    return
  }
  await blockedTopSitesStorage.setValue([...list, url])
  invalidateTopSitesCache()
  showBlockedMessage(url, reloadFunc)
}

async function restoreBlockedSite(url: string) {
  const list = await blockedTopSitesStorage.getValue()
  const index = list.indexOf(url)
  if (index !== -1) {
    const next = list.slice()
    next.splice(index, 1)
    await blockedTopSitesStorage.setValue(next)
    invalidateTopSitesCache()
  }
}

export { blockSite, getTopSites, invalidateTopSitesCache }
