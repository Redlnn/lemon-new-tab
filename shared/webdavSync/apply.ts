import type { QuickLink, QuickLinksData } from '@/shared/quickLinks'

import type {
  JsonObject,
  SearchHistoryEntryV1,
  SyncCustomSearchEngineV1,
  SyncQuickLinkV1,
  SyncScopePreferences,
  SyncSnapshotV1,
} from './types.ts'

function defineSafe(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  })
}

export function mergeSyncSettings<T>(current: T, incoming: JsonObject): T {
  function merge(currentValue: unknown, incomingValue: unknown): unknown {
    if (
      !currentValue ||
      !incomingValue ||
      typeof currentValue !== 'object' ||
      typeof incomingValue !== 'object' ||
      Array.isArray(currentValue) ||
      Array.isArray(incomingValue)
    ) {
      return structuredClone(incomingValue)
    }
    const result = structuredClone(currentValue) as Record<string, unknown>
    for (const [key, value] of Object.entries(incomingValue)) {
      defineSafe(result, key, merge(result[key], value))
    }
    return result
  }

  return merge(current, incoming) as T
}

function appendMissing(order: readonly string[], fallback: readonly string[], excluded: ReadonlySet<string>) {
  return [...order, ...fallback.filter((id) => !excluded.has(id))]
}

function mergeEntities<T extends { id: string }>(
  current: readonly T[],
  incoming: readonly T[],
): T[] {
  const incomingIds = new Set(incoming.map((item) => item.id))
  return [
    ...structuredClone(incoming),
    ...structuredClone(current.filter((item) => !incomingIds.has(item.id))),
  ]
}

function mergeQuickLinkImport(
  current: SyncSnapshotV1['quickLinks'],
  incoming: SyncSnapshotV1['quickLinks'],
): SyncSnapshotV1['quickLinks'] {
  const incomingItemIds = new Set(incoming.items.map((item) => item.id))
  const currentGroups = new Map(current.groups.map((group) => [group.id, group]))
  const incomingGroupIds = new Set(incoming.groups.map((group) => group.id))
  const groups = incoming.groups.map((group) => {
    const previous = currentGroups.get(group.id)
    return {
      ...structuredClone(group),
      itemIds: appendMissing(
        group.itemIds,
        previous?.itemIds ?? [],
        incomingItemIds,
      ),
    }
  })
  groups.push(
    ...current.groups
      .filter((group) => !incomingGroupIds.has(group.id))
      .map((group) => ({
        ...structuredClone(group),
        itemIds: group.itemIds.filter((id) => !incomingItemIds.has(id)),
      })),
  )
  const items = mergeEntities<SyncQuickLinkV1>(current.items, incoming.items)
  const availableIcons = { ...current.icons, ...incoming.icons }
  const usedIconHashes = new Set(items.map((item) => item.faviconHash).filter(Boolean))
  const icons = Object.fromEntries(
    Object.entries(availableIcons).filter(([hash]) => usedIconHashes.has(hash)),
  )
  return {
    items,
    rootOrder: appendMissing(incoming.rootOrder, current.rootOrder, incomingItemIds),
    groups,
    groupOrder: appendMissing(incoming.groupOrder, current.groupOrder, incomingGroupIds),
    ...(Object.keys(icons).length ? { icons } : {}),
  }
}

export function mergeImportedSnapshot(
  current: SyncSnapshotV1,
  incoming: SyncSnapshotV1,
): SyncSnapshotV1 {
  const incomingEngineIds = new Set(incoming.customSearchEngines.items.map((item) => item.id))
  const searchHistory = incoming.optional?.searchHistory
    ? {
        items: mergeEntities<SearchHistoryEntryV1>(
          current.optional?.searchHistory?.items ?? [],
          incoming.optional.searchHistory.items,
        ),
        order: appendMissing(
          incoming.optional.searchHistory.order,
          current.optional?.searchHistory?.order ?? [],
          new Set(incoming.optional.searchHistory.items.map((item) => item.id)),
        ),
      }
    : structuredClone(current.optional?.searchHistory)
  const blockedTopSites = incoming.optional?.blockedTopSites
    ? {
        urls: [...new Set([
          ...incoming.optional.blockedTopSites.urls,
          ...(current.optional?.blockedTopSites?.urls ?? []),
        ])],
      }
    : structuredClone(current.optional?.blockedTopSites)
  const wallpapers = incoming.optional?.wallpapers
    ? { ...structuredClone(current.optional?.wallpapers), ...structuredClone(incoming.optional.wallpapers) }
    : structuredClone(current.optional?.wallpapers)
  const optional = searchHistory || blockedTopSites || wallpapers
    ? { searchHistory, blockedTopSites, wallpapers }
    : undefined

  return {
    settings: mergeSyncSettings(current.settings, incoming.settings),
    quickLinks: mergeQuickLinkImport(current.quickLinks, incoming.quickLinks),
    customSearchEngines: {
      items: mergeEntities<SyncCustomSearchEngineV1>(
        current.customSearchEngines.items,
        incoming.customSearchEngines.items,
      ),
      order: appendMissing(
        incoming.customSearchEngines.order,
        current.customSearchEngines.order,
        incomingEngineIds,
      ),
    },
    ui: structuredClone(incoming.ui),
    optional,
  }
}

function toLocalQuickLink(
  incoming: SyncQuickLinkV1,
  current: QuickLink | undefined,
  includeIcons: boolean,
  icons: Readonly<Record<string, string>>,
): QuickLink {
  const result: QuickLink = { id: incoming.id, url: incoming.url, title: incoming.title }
  const syncedIcon = incoming.favicon ?? (incoming.faviconHash ? icons[incoming.faviconHash] : undefined)
  if (includeIcons && syncedIcon) {
    result.favicon = syncedIcon
    result.faviconSource = 'user-selected'
    return result
  }

  const preserveAnyIcon = !includeIcons
  const preserveLocalOnlyIcon =
    current?.faviconSource !== 'user-selected' && current?.url === incoming.url
  if (current?.favicon && (preserveAnyIcon || preserveLocalOnlyIcon)) {
    result.favicon = current.favicon
    result.faviconSource = current.faviconSource
  }
  return result
}

export function materializeQuickLinks(
  snapshot: SyncSnapshotV1['quickLinks'],
  current: QuickLinksData,
  includeIcons: boolean,
): QuickLinksData {
  const currentItems = current.groups?.length
    ? current.groups.flatMap((group) => group.items)
    : current.items
  const currentById = new Map<string, QuickLink>()
  for (const item of currentItems) {
    if (item.id) currentById.set(item.id, item)
  }
  const incomingById = new Map(
    snapshot.items.map((item) => [
      item.id,
        toLocalQuickLink(item, currentById.get(item.id), includeIcons, snapshot.icons ?? {}),
    ]),
  )
  const groups = snapshot.groupOrder.map((groupId) => {
    const group = snapshot.groups.find((item) => item.id === groupId)
    if (!group) throw new Error('Validated Quick Link group is missing')
    return {
      id: group.id,
      name: group.name,
      items: group.itemIds.map((id) => incomingById.get(id)!),
    }
  })
  const items = groups.length
    ? groups.flatMap((group) => group.items)
    : snapshot.rootOrder.map((id) => incomingById.get(id)!)
  return { items, groups }
}

export function preserveExcludedScope(
  captured: SyncSnapshotV1,
  baseline: SyncSnapshotV1,
  scope: SyncScopePreferences,
): SyncSnapshotV1 {
  const result = structuredClone(captured)
  if (!scope.quickLinkIcons) {
    const baselineById = new Map(baseline.quickLinks.items.map((item) => [item.id, item]))
    result.quickLinks.items = result.quickLinks.items.map((item) => {
      const baselineItem = baselineById.get(item.id)
      if (baselineItem?.faviconHash) {
        const icon = baseline.quickLinks.icons?.[baselineItem.faviconHash]
        if (icon) {
          result.quickLinks.icons ??= {}
          result.quickLinks.icons[baselineItem.faviconHash] = icon
          return { ...item, faviconHash: baselineItem.faviconHash }
        }
      }
      return baselineItem?.favicon ? { ...item, favicon: baselineItem.favicon } : item
    })
  }
  if (!scope.onlineWallpaperUrl) {
    const baselineBackground = baseline.settings.background
    const capturedBackground = result.settings.background
    if (
      baselineBackground &&
      capturedBackground &&
      typeof baselineBackground === 'object' &&
      typeof capturedBackground === 'object' &&
      !Array.isArray(baselineBackground) &&
      !Array.isArray(capturedBackground)
    ) {
      const baselineOnline = baselineBackground.online
      const capturedOnline = capturedBackground.online
      if (
        baselineOnline &&
        capturedOnline &&
        typeof baselineOnline === 'object' &&
        typeof capturedOnline === 'object' &&
        !Array.isArray(baselineOnline) &&
        !Array.isArray(capturedOnline) &&
        Object.hasOwn(baselineOnline, 'url')
      ) {
        defineSafe(
          capturedOnline as Record<string, unknown>,
          'url',
          structuredClone((baselineOnline as Record<string, unknown>).url),
        )
      }
    }
  }
  preserveOptionalField(result, baseline, 'searchHistory', !scope.searchHistory)
  preserveOptionalField(result, baseline, 'blockedTopSites', !scope.blockedTopSites)
  preserveOptionalField(result, baseline, 'wallpapers', !scope.wallpapers)
  return result
}

export function preserveBaselineWallpapers(
  snapshot: SyncSnapshotV1,
  baseline?: SyncSnapshotV1,
): SyncSnapshotV1 {
  const result = structuredClone(snapshot)
  const wallpapers = baseline?.optional?.wallpapers
  if (wallpapers) {
    result.optional ??= {}
    result.optional.wallpapers = structuredClone(wallpapers)
  } else if (result.optional?.wallpapers) {
    delete result.optional.wallpapers
    if (Object.keys(result.optional).length === 0) delete result.optional
  }
  return result
}

function preserveOptionalField(
  target: SyncSnapshotV1,
  baseline: SyncSnapshotV1,
  key: keyof NonNullable<SyncSnapshotV1['optional']>,
  preserve: boolean,
): void {
  if (!preserve) return
  const value = baseline.optional?.[key]
  if (value === undefined) {
    if (target.optional) delete target.optional[key]
    return
  }
  target.optional ??= {}
  defineSafe(target.optional as Record<string, unknown>, key, structuredClone(value))
}
