import type { QuickLink, QuickLinksData } from '@/shared/quickLinks'

import type {
  JsonObject,
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

function toLocalQuickLink(
  incoming: SyncQuickLinkV1,
  current: QuickLink | undefined,
  includeIcons: boolean,
): QuickLink {
  const result: QuickLink = { id: incoming.id, url: incoming.url, title: incoming.title }
  if (includeIcons && incoming.favicon) {
    result.favicon = incoming.favicon
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
      toLocalQuickLink(item, currentById.get(item.id), includeIcons),
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
      const favicon = baselineById.get(item.id)?.favicon
      return favicon ? { ...item, favicon } : item
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
