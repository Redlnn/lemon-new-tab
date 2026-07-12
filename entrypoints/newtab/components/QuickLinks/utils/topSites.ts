import i18next from 'i18next'
// 由于 wxt/browser 缺少火狐的 topSites 类型定义，直接用官方的 webextension-polyfill
import type { TopSites } from 'webextension-polyfill'
import browser from 'webextension-polyfill'

import { fetchFaviconWithCache, warmFaviconCache } from '@/shared/media'

import { blockedTopSitesStorage } from '@newtab/shared/storages/topSitesStorage'

import { createSingleFlightCache } from './singleFlightCache'

const TOP_SITES_TTL = 30_000 // 30 秒
export const rawTopSites = shallowRef<TopSites.MostVisitedURL[]>([])

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

const topSitesCache = createSingleFlightCache({
  ttl: TOP_SITES_TTL,
  fetchValue: fetchTopSites,
  onValue: async (value) => {
    await cacheBrowserFavicons(value)
    rawTopSites.value = value
  },
})

const getTopSites = (force = false) => topSitesCache.load(force)

function invalidateTopSitesCache() {
  topSitesCache.invalidate()
  rawTopSites.value = []
}

blockedTopSitesStorage.watch(() => {
  invalidateTopSitesCache()
  void getTopSites()
})

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
