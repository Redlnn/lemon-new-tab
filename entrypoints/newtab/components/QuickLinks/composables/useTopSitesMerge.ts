import type { TopSites } from 'webextension-polyfill'

import { normalizeUrlForDedup } from '@/shared/url'

export interface TopSitesMergeOptions {
  quickLinks: readonly { url: string }[]
  columns?: number
  maxRows?: number
  limit?: number
  /** 不截断结果，返回所有去重后的 top sites */
  noCap?: boolean
}

const WWW_RE = /^www\./

function getFallbackTitle(url: string): string {
  try {
    let host = new URL(url).hostname
    host = host.replace(WWW_RE, '')
    if (host.split('.').length <= 2) {
      host = host.charAt(0).toUpperCase() + host.slice(1)
    }
    return host
  } catch {
    return url
  }
}

export function mergeTopSites(
  topSites: TopSites.MostVisitedURL[],
  options: TopSitesMergeOptions,
): TopSites.MostVisitedURL[] {
  // 构建 URL Set 用于快速去重
  const { quickLinks, columns, maxRows, noCap } = options
  const limit =
    options.limit ??
    (!noCap && typeof columns === 'number' && typeof maxRows === 'number'
      ? Math.max(0, Math.trunc(columns * maxRows - 1 - quickLinks.length))
      : Infinity)
  if (!limit || !topSites.length) return []
  const quickLinkUrlsSet = new Set<string>()
  for (let i = 0, len = quickLinks.length; i < len; i++) {
    quickLinkUrlsSet.add(normalizeUrlForDedup(quickLinks[i]!.url))
  }

  const dedup: TopSites.MostVisitedURL[] = []
  for (let i = 0, len = topSites.length; i < len; i++) {
    const site = topSites[i]
    if (!site?.url || quickLinkUrlsSet.has(normalizeUrlForDedup(site.url))) continue
    const rawTitle = site.title
    // 仅当 title 为空或全空白时才计算 fallback
    const title = rawTitle?.trim() ? rawTitle : getFallbackTitle(site.url)
    dedup.push({ ...site, title })
    if (dedup.length >= limit) break
  }
  return dedup
}
