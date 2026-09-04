import type { QuickLink, QuickLinksData } from '@/shared/quickLinks'

import {
  applySyncSettings,
  preserveUnknownSyncSettings,
  stripExcludedSyncSettings,
} from './settingsWhitelist.ts'
import type {
  JsonObject,
  SyncCustomSearchEngineDataV1,
  SyncCustomSearchEngineV1,
  SyncQuickLinkV1,
  SyncQuickLinksDataV1,
  SyncScopePreferences,
  SyncSnapshotV1,
} from './types.ts'

export function mergeSyncSettings<T>(current: T, incoming: JsonObject): T {
  return applySyncSettings(current, incoming)
}

function appendMissing(
  order: readonly string[],
  fallback: readonly string[],
  excluded: ReadonlySet<string>,
) {
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

function emptyQuickLinks(): SyncQuickLinksDataV1 {
  return { items: [], rootOrder: [], groups: [], groupOrder: [] }
}

function emptySearchEngines(): SyncCustomSearchEngineDataV1 {
  return { items: [], order: [] }
}

function mergeQuickLinkImport(
  current = emptyQuickLinks(),
  incoming = emptyQuickLinks(),
): SyncQuickLinksDataV1 {
  const incomingItemIds = new Set(incoming.items.map((item) => item.id))
  const currentGroups = new Map(current.groups.map((group) => [group.id, group]))
  const incomingGroupIds = new Set(incoming.groups.map((group) => group.id))
  const groups = incoming.groups.map((group) => ({
    ...structuredClone(group),
    itemIds: appendMissing(
      group.itemIds,
      currentGroups.get(group.id)?.itemIds ?? [],
      incomingItemIds,
    ),
  }))
  groups.push(
    ...current.groups
      .filter((group) => !incomingGroupIds.has(group.id))
      .map((group) => ({
        ...structuredClone(group),
        itemIds: group.itemIds.filter((id) => !incomingItemIds.has(id)),
      })),
  )
  return {
    items: mergeEntities<SyncQuickLinkV1>(current.items, incoming.items),
    rootOrder: appendMissing(incoming.rootOrder, current.rootOrder, incomingItemIds),
    groups,
    groupOrder: appendMissing(incoming.groupOrder, current.groupOrder, incomingGroupIds),
  }
}

function mergeSearchEngineImport(
  current = emptySearchEngines(),
  incoming = emptySearchEngines(),
): SyncCustomSearchEngineDataV1 {
  const incomingIds = new Set(incoming.items.map((item) => item.id))
  return {
    items: mergeEntities<SyncCustomSearchEngineV1>(current.items, incoming.items),
    order: appendMissing(incoming.order, current.order, incomingIds),
  }
}

export function mergeImportedSnapshot(
  current: SyncSnapshotV1,
  incoming: SyncSnapshotV1,
): SyncSnapshotV1 {
  const blockedTopSites = incoming.optional?.blockedTopSites
    ? {
        urls: [
          ...new Set([
            ...incoming.optional.blockedTopSites.urls,
            ...(current.optional?.blockedTopSites?.urls ?? []),
          ]),
        ],
      }
    : structuredClone(current.optional?.blockedTopSites)
  const wallpapers = incoming.optional?.wallpapers
    ? {
        ...structuredClone(current.optional?.wallpapers),
        ...structuredClone(incoming.optional.wallpapers),
      }
    : structuredClone(current.optional?.wallpapers)
  const onlineWallpaperUrl =
    incoming.optional?.onlineWallpaperUrl ?? current.optional?.onlineWallpaperUrl
  const optional =
    blockedTopSites || wallpapers || onlineWallpaperUrl !== undefined
      ? { blockedTopSites, wallpapers, onlineWallpaperUrl }
      : undefined
  const result: SyncSnapshotV1 = {
    scope: { ...current.scope },
    settings: incoming.settings
      ? mergeSyncSettings(current.settings ?? {}, incoming.settings)
      : structuredClone(current.settings),
    quickLinks: mergeQuickLinkImport(current.quickLinks, incoming.quickLinks),
    customSearchEngines: mergeSearchEngineImport(
      current.customSearchEngines,
      incoming.customSearchEngines,
    ),
    ui: structuredClone(incoming.ui ?? current.ui),
    inlineImages: { ...current.inlineImages, ...incoming.inlineImages },
    optional,
  }
  if (!result.settings) delete result.settings
  if (!result.ui) delete result.ui
  if (!result.optional) delete result.optional
  pruneInlineImages(result)
  return result
}

function toLocalQuickLink(
  incoming: SyncQuickLinkV1,
  current: QuickLink | undefined,
  includeIcons: boolean,
  images: Readonly<Record<string, string>>,
): QuickLink {
  const result: QuickLink = { id: incoming.id, url: incoming.url, title: incoming.title }
  const syncedIcon = incoming.faviconHash ? images[incoming.faviconHash] : undefined
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
  snapshot: SyncQuickLinksDataV1,
  current: QuickLinksData,
  includeIcons: boolean,
  images: Readonly<Record<string, string>> = {},
): QuickLinksData {
  const currentItems = current.groups?.length
    ? current.groups.flatMap((group) => group.items)
    : current.items
  const currentById = new Map(currentItems.flatMap((item) => (item.id ? [[item.id, item]] : [])))
  const incomingById = new Map(
    snapshot.items.map((item) => [
      item.id,
      toLocalQuickLink(item, currentById.get(item.id), includeIcons, images),
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

function copyCategory<K extends keyof SyncSnapshotV1>(
  target: SyncSnapshotV1,
  baseline: SyncSnapshotV1,
  key: K,
): void {
  const value = baseline[key]
  if (value === undefined) delete target[key]
  else target[key] = structuredClone(value) as SyncSnapshotV1[K]
}

function preserveEntityIcons(result: SyncSnapshotV1, baseline: SyncSnapshotV1): void {
  const baselineLinks = new Map(baseline.quickLinks?.items.map((item) => [item.id, item]))
  for (const item of result.quickLinks?.items ?? []) {
    item.faviconHash = baselineLinks.get(item.id)?.faviconHash
    if (!item.faviconHash) delete item.faviconHash
  }
  const baselineEngines = new Map(
    baseline.customSearchEngines?.items.map((item) => [item.id, item]),
  )
  for (const item of result.customSearchEngines?.items ?? []) {
    item.iconHash = baselineEngines.get(item.id)?.iconHash
    if (!item.iconHash) delete item.iconHash
  }
}

function pruneInlineImages(snapshot: SyncSnapshotV1, baseline?: SyncSnapshotV1): void {
  const used = new Set(
    [
      ...(snapshot.quickLinks?.items.map((item) => item.faviconHash) ?? []),
      ...(snapshot.customSearchEngines?.items.map((item) => item.iconHash) ?? []),
    ].filter((hash): hash is string => Boolean(hash)),
  )
  const available = { ...baseline?.inlineImages, ...snapshot.inlineImages }
  const images = Object.fromEntries(Object.entries(available).filter(([hash]) => used.has(hash)))
  if (Object.keys(images).length) snapshot.inlineImages = images
  else delete snapshot.inlineImages
}

export function preserveExcludedScope(
  captured: SyncSnapshotV1,
  baseline: SyncSnapshotV1,
  scope: SyncScopePreferences,
): SyncSnapshotV1 {
  const result = structuredClone(captured)
  result.scope = { ...scope }
  if (!scope.settings) copyCategory(result, baseline, 'settings')
  else if (result.settings && baseline.settings) {
    result.settings = preserveUnknownSyncSettings(result.settings, baseline.settings)
  }
  if (result.settings) result.settings = stripExcludedSyncSettings(result.settings)
  if (!scope.quickLinks) copyCategory(result, baseline, 'quickLinks')
  if (!scope.customSearchEngines) copyCategory(result, baseline, 'customSearchEngines')
  if (!scope.uiPreferences) copyCategory(result, baseline, 'ui')
  if (!scope.userIcons || (!scope.quickLinks && !scope.customSearchEngines)) {
    preserveEntityIcons(result, baseline)
  }
  preserveOptionalField(result, baseline, 'blockedTopSites', !scope.blockedTopSites)
  preserveOptionalField(result, baseline, 'wallpapers', !scope.wallpapers)
  preserveOptionalField(result, baseline, 'onlineWallpaperUrl', !scope.onlineWallpaperUrl)
  pruneInlineImages(result, baseline)
  return result
}

/** 生成应用远端快照后的校验目标，保留远端未携带的本机字段。 */
export function expectedAppliedSnapshot(
  beforeApply: SyncSnapshotV1,
  target: SyncSnapshotV1,
): SyncSnapshotV1 {
  const result = preserveExcludedScope(beforeApply, target, target.scope)
  if (target.scope.settings) {
    const targetSettings = target.settings ?? {}
    const settings = preserveUnknownSyncSettings(
      mergeSyncSettings(beforeApply.settings ?? {}, targetSettings),
      targetSettings,
    )
    if (Object.keys(settings).length) result.settings = settings
    else delete result.settings
  }
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
  target.optional[key] = structuredClone(value) as never
}
