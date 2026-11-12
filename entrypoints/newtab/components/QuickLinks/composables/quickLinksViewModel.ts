import type { QuickLinkGroup } from '@/shared/quickLinks'

import {
  buildQuickLinkGroupItems,
  type QuickLinkDisplayItem,
  withSortableIndexes,
} from './quickLinkDisplayItems.ts'

export type QuickLinkViewItem = QuickLinkDisplayItem & { sortableIndex?: number }

export type QuickLinkPage = {
  key: string
  groupId: string
  pageInGroup: number
  totalPagesInGroup: number
  isTopSites: boolean
  items: QuickLinkViewItem[]
  sortableStoreIndexes: number[]
}

export type QuickLinkScrollSection = {
  key: string
  title?: string
  groupId?: string
  isTopSites: boolean
  items: QuickLinkViewItem[]
  sortableStoreIndexes: number[]
}

export function splitQuickLinkPages(
  groupId: string,
  items: QuickLinkDisplayItem[],
  isTopSites: boolean,
  slotsPerPage: number,
  hideAddButton = false,
): QuickLinkPage[] {
  const slots = Math.max(1, slotsPerPage)
  const reserveAddButton = !isTopSites && !hideAddButton
  const totalPagesInGroup = Math.max(
    1,
    Math.ceil((items.length + (reserveAddButton ? 1 : 0)) / slots),
  )

  return Array.from({ length: totalPagesInGroup }, (_, pageInGroup) => {
    const isLastPage = pageInGroup === totalPagesInGroup - 1
    const start = pageInGroup * slots
    const maxItems = isLastPage && reserveAddButton ? slots - 1 : slots
    const pageItems = withSortableIndexes(items.slice(start, start + maxItems))
    return {
      key: `${groupId}-${pageInGroup}`,
      groupId,
      pageInGroup,
      totalPagesInGroup,
      isTopSites,
      items: pageItems.items,
      sortableStoreIndexes: pageItems.sortableStoreIndexes,
    }
  })
}

export function buildQuickLinkPages(options: {
  grouping: boolean
  groups: readonly QuickLinkGroup[]
  legacyItems: QuickLinkDisplayItem[]
  topSiteItems: QuickLinkDisplayItem[]
  slotsPerPage: number
  hideAddButton: boolean
  defaultGroupId: string
  flatGroupId: string
  topSitesGroupId: string
}): QuickLinkPage[] {
  if (!options.grouping) {
    return splitQuickLinkPages(
      options.flatGroupId,
      options.legacyItems,
      false,
      options.slotsPerPage,
      options.hideAddButton,
    )
  }

  const hasQuickLinkItems = options.groups.some((group) => group.items.length > 0)
  if (!hasQuickLinkItems && options.topSiteItems.length === 0) {
    return splitQuickLinkPages(
      options.defaultGroupId,
      [],
      false,
      options.slotsPerPage,
      options.hideAddButton,
    )
  }

  const result = options.groups.flatMap((group) =>
    splitQuickLinkPages(
      group.id,
      buildQuickLinkGroupItems(group),
      false,
      options.slotsPerPage,
      options.hideAddButton,
    ),
  )
  if (options.topSiteItems.length > 0) {
    result.push(
      ...splitQuickLinkPages(
        options.topSitesGroupId,
        options.topSiteItems,
        true,
        options.slotsPerPage,
      ),
    )
  }
  return result.length > 0
    ? result
    : splitQuickLinkPages(
        options.defaultGroupId,
        [],
        false,
        options.slotsPerPage,
        options.hideAddButton,
      )
}

export function buildQuickLinkScrollSections(options: {
  grouping: boolean
  groups: readonly QuickLinkGroup[]
  legacyItems: QuickLinkDisplayItem[]
  topSiteItems: QuickLinkDisplayItem[]
  topSitesTitle: string
  defaultGroupId: string
  defaultGroupName?: string
  topSitesGroupId: string
}): QuickLinkScrollSection[] {
  if (!options.grouping) {
    const legacyItems = withSortableIndexes(options.legacyItems)
    return [
      {
        key: 'quick-links',
        isTopSites: false,
        items: legacyItems.items,
        sortableStoreIndexes: legacyItems.sortableStoreIndexes,
      },
    ]
  }

  const sections: QuickLinkScrollSection[] = options.groups.map((group) => {
    const items = withSortableIndexes(buildQuickLinkGroupItems(group))
    return {
      key: group.id,
      title: group.name,
      groupId: group.id,
      isTopSites: false,
      items: items.items,
      sortableStoreIndexes: items.sortableStoreIndexes,
    }
  })

  if (options.topSiteItems.length > 0) {
    const items = withSortableIndexes(options.topSiteItems)
    sections.push({
      key: options.topSitesGroupId,
      title: options.topSitesTitle,
      groupId: options.topSitesGroupId,
      isTopSites: true,
      items: items.items,
      sortableStoreIndexes: items.sortableStoreIndexes,
    })
  }

  return sections.length > 0
    ? sections
    : [
        {
          key: options.defaultGroupId,
          title: options.defaultGroupName,
          groupId: options.defaultGroupId,
          isTopSites: false,
          items: [],
          sortableStoreIndexes: [],
        },
      ]
}
