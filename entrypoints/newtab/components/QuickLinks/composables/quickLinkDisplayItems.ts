import type { TopSites } from 'webextension-polyfill'

import type { QuickLink, QuickLinkGroup } from '@/shared/quickLinks'

export interface QuickLinkDisplayItem {
  url: string
  title: string
  favicon?: string
  isPinned: boolean
  originalIndex: number
  groupId?: string
}

export function buildQuickLinkDisplayItems(
  quickLinks: QuickLink[],
  topSites: TopSites.MostVisitedURL[],
): QuickLinkDisplayItem[] {
  const quickLinksLen = quickLinks.length
  const topSitesLen = topSites.length
  const result: QuickLinkDisplayItem[] = Array.from({ length: quickLinksLen + topSitesLen })

  for (let i = 0; i < quickLinksLen; i++) {
    const site = quickLinks[i]!
    result[i] = {
      url: site.url,
      title: site.title,
      favicon: site.favicon,
      isPinned: true,
      originalIndex: i,
    }
  }

  for (let i = 0; i < topSitesLen; i++) {
    const site = topSites[i]!
    result[quickLinksLen + i] = {
      url: site.url,
      title: site.title || '',
      favicon: site.favicon,
      isPinned: false,
      originalIndex: i,
    }
  }

  return result
}

export function buildQuickLinkGroupItems(group: QuickLinkGroup): QuickLinkDisplayItem[] {
  const result: QuickLinkDisplayItem[] = Array.from({ length: group.items.length })

  for (let i = 0, len = group.items.length; i < len; i++) {
    const item = group.items[i]!
    result[i] = {
      url: item.url,
      title: item.title,
      favicon: item.favicon,
      isPinned: true,
      originalIndex: i,
      groupId: group.id,
    }
  }

  return result
}

export function buildTopSiteDisplayItems(
  topSites: TopSites.MostVisitedURL[],
  groupId?: string,
): QuickLinkDisplayItem[] {
  const result: QuickLinkDisplayItem[] = Array.from({ length: topSites.length })

  for (let i = 0, len = topSites.length; i < len; i++) {
    const site = topSites[i]!
    result[i] = {
      url: site.url,
      title: site.title || '',
      favicon: site.favicon,
      isPinned: false,
      originalIndex: i,
      groupId,
    }
  }

  return result
}

export function withSortableIndexes<T extends QuickLinkDisplayItem>(items: T[]) {
  const sortableStoreIndexes: number[] = []
  const nextItems: Array<T & { sortableIndex?: number }> = Array.from({ length: items.length })

  for (let i = 0, len = items.length; i < len; i++) {
    const item = items[i]!
    if (!item.isPinned) {
      nextItems[i] = item
      continue
    }

    const sortableIndex = sortableStoreIndexes.length
    sortableStoreIndexes.push(item.originalIndex)
    nextItems[i] = { ...item, sortableIndex }
  }

  return {
    items: nextItems,
    sortableStoreIndexes,
  }
}
