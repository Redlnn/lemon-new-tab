import type { TopSites } from 'webextension-polyfill'

import type { Shortcut } from '@/shared/shortcut'

export interface ShortcutDisplayItem {
  url: string
  title: string
  favicon?: string
  isPinned: boolean
  originalIndex: number
}

export function buildShortcutDisplayItems(
  shortcuts: Shortcut[],
  topSites: TopSites.MostVisitedURL[],
): ShortcutDisplayItem[] {
  const shortcutsLen = shortcuts.length
  const topSitesLen = topSites.length
  const result: ShortcutDisplayItem[] = Array.from({ length: shortcutsLen + topSitesLen })

  for (let i = 0; i < shortcutsLen; i++) {
    const site = shortcuts[i]!
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
    result[shortcutsLen + i] = {
      url: site.url,
      title: site.title || '',
      favicon: site.favicon,
      isPinned: false,
      originalIndex: i,
    }
  }

  return result
}
