import type { TopSites } from 'webextension-polyfill'

import { getTopSites } from '@newtab/components/Shortcut/utils/topSites'

interface UseTopSitesMergeOptions {
  shortcuts: { url: string }[]
  columns?: number
  maxRows?: number
  force?: boolean
  /** 不截断结果，返回所有去重后的 top sites */
  noCap?: boolean
}

const WWW_RE = /^www\./

function normalizeUrlForDedup(url: string): string {
  return url.replace(/\/+$/, '')
}

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

export async function useTopSitesMerge(
  options: UseTopSitesMergeOptions,
): Promise<TopSites.MostVisitedURL[]> {
  // 如果 getTopSites() 返回 undefined，则默认空数组
  const topSites = (await getTopSites(options.force)) ?? []

  // 构建 URL Set 用于快速去重
  const { shortcuts } = options
  const shortcutUrlsSet = new Set<string>()
  for (let i = 0, len = shortcuts.length; i < len; i++) {
    shortcutUrlsSet.add(normalizeUrlForDedup(shortcuts[i]!.url))
  }

  const dedup: TopSites.MostVisitedURL[] = []
  for (let i = 0, len = topSites.length; i < len; i++) {
    const site = topSites[i]
    if (!site?.url || shortcutUrlsSet.has(normalizeUrlForDedup(site.url))) continue
    const rawTitle = site.title
    // 仅当 title 为空或全空白时才计算 fallback
    const title = rawTitle?.trim() ? rawTitle : getFallbackTitle(site.url)
    dedup.push({ ...site, title })
  }

  // 如果启用 noCap，直接返回所有去重后的结果
  if (options.noCap) {
    return dedup
  }

  // 计算容量（优先使用 columns + maxRows，上限为列*行 - 1，预留"添加按钮"）
  let remain = Infinity
  const { columns, maxRows } = options
  const hasCapacityInfo = typeof columns === 'number' && typeof maxRows === 'number'
  if (hasCapacityInfo) {
    const capacity = Math.max(0, columns * maxRows - 1)
    remain = Math.max(0, capacity - options.shortcuts.length)
    if (remain === 0) {
      return []
    }
  }

  if (remain === Infinity) {
    return dedup
  }

  return dedup.slice(0, remain)
}
