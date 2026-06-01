import type { TopSites } from 'webextension-polyfill'

import type { QuickLink } from '@/shared/quickLinks'

export interface QuickLinkDisplayItem {
  url: string
  title: string
  favicon?: string
  isPinned: boolean
  originalIndex: number
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
