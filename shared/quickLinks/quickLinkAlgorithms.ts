import { normalizeUrlForDedup } from '@/shared/url'

import type { QuickLink, QuickLinkGroup } from './quickLinksStorage'

export function flattenQuickLinkGroups(
  groups: readonly QuickLinkGroup[],
  options?: { dedupe?: boolean },
): QuickLink[] {
  if (!options?.dedupe) return groups.flatMap((group) => group.items)

  const seen = new Set<string>()
  const result: QuickLink[] = []
  for (const group of groups) {
    for (const item of group.items) {
      const key = normalizeUrlForDedup(item.url)
      if (seen.has(key)) continue
      seen.add(key)
      result.push(item)
    }
  }
  return result
}

export function moveQuickLinkArrayItem<T>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number,
): T[] | null {
  if (fromIndex === toIndex) return null
  const nextItems = items.slice()
  const [item] = nextItems.splice(fromIndex, 1)
  if (!item) return null
  nextItems.splice(Math.max(0, Math.min(toIndex, nextItems.length)), 0, item)
  return nextItems
}
