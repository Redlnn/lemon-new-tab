import type { TopSites } from 'webextension-polyfill'

import type { QuickLink, QuickLinkGroup } from '@/shared/quickLinks'

export interface QuickLinkDisplayItem {
  id?: string
  url: string
  title: string
  favicon?: string
  icon?: QuickLink['icon']
  appId?: QuickLink['appId']
  isPinned: boolean
  originalIndex: number
  groupId?: string
}

export function buildQuickLinkDisplayItems(
  quickLinks: QuickLink[],
  topSites: TopSites.MostVisitedURL[],
  start = 0,
  end = quickLinks.length + topSites.length,
): QuickLinkDisplayItem[] {
  const quickLinksLen = quickLinks.length
  const result: QuickLinkDisplayItem[] = []

  for (let i = start; i < Math.min(end, quickLinksLen); i++) {
    const site = quickLinks[i]!
    result.push({
      id: site.id,
      url: site.url,
      title: site.title,
      favicon: site.favicon,
      icon: site.icon,
      appId: site.appId,
      isPinned: true,
      originalIndex: i,
    })
  }

  for (
    let i = Math.max(0, start - quickLinksLen);
    i < Math.min(end - quickLinksLen, topSites.length);
    i++
  ) {
    const site = topSites[i]!
    result.push({
      url: site.url,
      title: site.title || '',
      favicon: site.favicon,
      isPinned: false,
      originalIndex: i,
    })
  }

  return result
}

export function buildQuickLinkGroupItems(group: QuickLinkGroup): QuickLinkDisplayItem[] {
  const result: QuickLinkDisplayItem[] = Array.from({ length: group.items.length })

  for (let i = 0, len = group.items.length; i < len; i++) {
    const item = group.items[i]!
    result[i] = {
      id: item.id,
      url: item.url,
      title: item.title,
      favicon: item.favicon,
      icon: item.icon,
      appId: item.appId,
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
