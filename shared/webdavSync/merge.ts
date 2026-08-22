import { canonicalize, jsonEquals } from './canonical.ts'
import {
  normalizeRemoteSyncSettings,
  pickSyncSettings,
  preserveUnknownSyncSettings,
} from './settingsWhitelist.ts'
import type {
  JsonObject,
  JsonValue,
  SyncConflict,
  SyncConflictKind,
  SyncCustomSearchEngineV1,
  SyncQuickLinkGroupV1,
  SyncQuickLinkV1,
  SyncSnapshotV1,
  ThreeWayMergeResult,
} from './types.ts'

const MISSING = Symbol('missing')
type MaybeJson = JsonValue | typeof MISSING

function conflictValue(value: MaybeJson): JsonValue | undefined {
  return value === MISSING ? undefined : value
}

function addConflict(
  conflicts: SyncConflict[],
  category: SyncConflict['category'],
  kind: SyncConflictKind,
  path: string,
  base: MaybeJson,
  local: MaybeJson,
  remote: MaybeJson,
  canKeepBoth = false,
) {
  conflicts.push({
    id: `${category}:${path}:${kind}`,
    category,
    kind,
    path,
    base: conflictValue(base),
    local: conflictValue(local),
    remote: conflictValue(remote),
    canKeepBoth,
  })
}

function isObject(value: MaybeJson): value is JsonObject {
  return value !== MISSING && value !== null && typeof value === 'object' && !Array.isArray(value)
}

function maybeEquals(left: MaybeJson, right: MaybeJson): boolean {
  if (left === MISSING || right === MISSING) return left === right
  return jsonEquals(left, right)
}

function mergeJson(
  category: SyncConflict['category'],
  path: string,
  base: MaybeJson,
  local: MaybeJson,
  remote: MaybeJson,
  conflicts: SyncConflict[],
): MaybeJson {
  if (maybeEquals(local, remote)) return local
  if (maybeEquals(local, base)) return remote
  if (maybeEquals(remote, base)) return local

  if (isObject(base) && isObject(local) && isObject(remote)) {
    const result: JsonObject = {}
    const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])
    for (const key of [...keys].sort()) {
      const merged = mergeJson(
        category,
        path ? `${path}.${key}` : key,
        key in base ? base[key]! : MISSING,
        key in local ? local[key]! : MISSING,
        key in remote ? remote[key]! : MISSING,
        conflicts,
      )
      if (merged !== MISSING) result[key] = merged
    }
    return result
  }

  addConflict(conflicts, category, 'field', path, base, local, remote)
  return local
}

type Entity = { id: string }

function toEntityMap<T extends Entity>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]))
}

function mergeEntities<T extends Entity>(
  category: SyncConflict['category'],
  path: string,
  baseItems: readonly T[],
  localItems: readonly T[],
  remoteItems: readonly T[],
  conflicts: SyncConflict[],
  canKeepBoth = true,
): T[] {
  const base = toEntityMap(baseItems)
  const local = toEntityMap(localItems)
  const remote = toEntityMap(remoteItems)
  const ids = new Set([...base.keys(), ...local.keys(), ...remote.keys()])
  const result: T[] = []

  for (const id of [...ids].sort()) {
    const baseItem = base.get(id)
    const localItem = local.get(id)
    const remoteItem = remote.get(id)
    const itemPath = `${path}.${id}`

    if (!baseItem) {
      if (localItem && remoteItem) {
        if (jsonEquals(localItem, remoteItem)) result.push(localItem)
        else {
          addConflict(
            conflicts,
            category,
            'simultaneous-create',
            itemPath,
            MISSING,
            localItem as unknown as JsonValue,
            remoteItem as unknown as JsonValue,
            canKeepBoth,
          )
          result.push(localItem)
        }
      } else if (localItem) result.push(localItem)
      else if (remoteItem) result.push(remoteItem)
      continue
    }

    if (!localItem && !remoteItem) continue
    if (!localItem && remoteItem) {
      if (!jsonEquals(baseItem, remoteItem)) {
        addConflict(
          conflicts,
          category,
          'delete-vs-modify',
          itemPath,
          baseItem as unknown as JsonValue,
          MISSING,
          remoteItem as unknown as JsonValue,
          canKeepBoth,
        )
        result.push(remoteItem)
      }
      continue
    }
    if (localItem && !remoteItem) {
      if (!jsonEquals(baseItem, localItem)) {
        addConflict(
          conflicts,
          category,
          'delete-vs-modify',
          itemPath,
          baseItem as unknown as JsonValue,
          localItem as unknown as JsonValue,
          MISSING,
          canKeepBoth,
        )
        result.push(localItem)
      }
      continue
    }

    const merged = mergeJson(
      category,
      itemPath,
      canonicalize(baseItem),
      canonicalize(localItem!),
      canonicalize(remoteItem!),
      conflicts,
    )
    if (merged !== MISSING) result.push(merged as T)
  }

  return result
}

function normalizeOrder(order: readonly string[], validIds: ReadonlySet<string>): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const id of order) {
    if (validIds.has(id) && !seen.has(id)) {
      seen.add(id)
      result.push(id)
    }
  }
  for (const id of [...validIds].sort()) {
    if (!seen.has(id)) result.push(id)
  }
  return result
}

function mergeOrder(
  category: SyncConflict['category'],
  path: string,
  base: readonly string[],
  local: readonly string[],
  remote: readonly string[],
  validIds: ReadonlySet<string>,
  conflicts: SyncConflict[],
): string[] {
  const baseOrder = normalizeOrder(base, validIds)
  const localOrder = normalizeOrder(local, validIds)
  const remoteOrder = normalizeOrder(remote, validIds)
  if (jsonEquals(localOrder, remoteOrder)) return localOrder
  if (jsonEquals(localOrder, baseOrder)) return remoteOrder
  if (jsonEquals(remoteOrder, baseOrder)) return localOrder

  addConflict(conflicts, category, 'order', path, baseOrder, localOrder, remoteOrder)
  return localOrder
}

function mergeQuickLinks(
  base: NonNullable<SyncSnapshotV1['quickLinks']>,
  local: NonNullable<SyncSnapshotV1['quickLinks']>,
  remote: NonNullable<SyncSnapshotV1['quickLinks']>,
  conflicts: SyncConflict[],
): NonNullable<SyncSnapshotV1['quickLinks']> {
  const items = mergeEntities<SyncQuickLinkV1>(
    'quick-links',
    'quickLinks.items',
    base.items,
    local.items,
    remote.items,
    conflicts,
  )
  const itemIds = new Set(items.map((item) => item.id))
  type GroupMetadata = Pick<SyncQuickLinkGroupV1, 'id' | 'name'>
  const groups = mergeEntities<GroupMetadata>(
    'quick-links',
    'quickLinks.groups',
    base.groups.map(({ id, name }) => ({ id, name })),
    local.groups.map(({ id, name }) => ({ id, name })),
    remote.groups.map(({ id, name }) => ({ id, name })),
    conflicts,
    false,
  )
  const groupIds = new Set(groups.map((group) => group.id))
  const locations = new Map<string, string>()
  const locationMap = (value: NonNullable<SyncSnapshotV1['quickLinks']>) => {
    const result = new Map(value.rootOrder.map((id) => [id, 'root']))
    for (const group of value.groups) {
      for (const id of group.itemIds) result.set(id, group.id)
    }
    return result
  }
  const baseLocations = locationMap(base)
  const localLocations = locationMap(local)
  const remoteLocations = locationMap(remote)
  for (const id of itemIds) {
    const baseLocation = baseLocations.get(id) ?? MISSING
    const localLocation = localLocations.get(id) ?? MISSING
    const remoteLocation = remoteLocations.get(id) ?? MISSING
    let location = mergeJson(
      'quick-links',
      `quickLinks.location.${id}`,
      baseLocation,
      localLocation,
      remoteLocation,
      conflicts,
    )
    if (location === MISSING || typeof location !== 'string' || !groupIds.has(location)) {
      location = 'root'
    }
    locations.set(id, location)
  }
  const idsAt = (location: string) =>
    new Set([...locations].filter(([, value]) => value === location).map(([id]) => id))
  const orderAt = (value: NonNullable<SyncSnapshotV1['quickLinks']>, location: string) =>
    location === 'root'
      ? value.rootOrder
      : (value.groups.find((group) => group.id === location)?.itemIds ?? [])
  const rootIds = idsAt('root')
  const rootOrder = mergeOrder(
    'quick-links',
    'quickLinks.rootOrder',
    orderAt(base, 'root'),
    orderAt(local, 'root'),
    orderAt(remote, 'root'),
    rootIds,
    conflicts,
  )
  const mergedGroups: SyncQuickLinkGroupV1[] = groups.map((group) => {
    const ids = idsAt(group.id)
    return {
      ...group,
      itemIds: mergeOrder(
        'quick-links',
        `quickLinks.groups.${group.id}.itemIds`,
        orderAt(base, group.id),
        orderAt(local, group.id),
        orderAt(remote, group.id),
        ids,
        conflicts,
      ),
    }
  })
  return {
    items,
    rootOrder,
    groups: mergedGroups,
    groupOrder: mergeOrder(
      'quick-links',
      'quickLinks.groupOrder',
      base.groupOrder,
      local.groupOrder,
      remote.groupOrder,
      groupIds,
      conflicts,
    ),
  }
}

function mergeSearchEngines(
  base: NonNullable<SyncSnapshotV1['customSearchEngines']>,
  local: NonNullable<SyncSnapshotV1['customSearchEngines']>,
  remote: NonNullable<SyncSnapshotV1['customSearchEngines']>,
  conflicts: SyncConflict[],
): NonNullable<SyncSnapshotV1['customSearchEngines']> {
  const items = mergeEntities<SyncCustomSearchEngineV1>(
    'search-engines',
    'customSearchEngines.items',
    base.items,
    local.items,
    remote.items,
    conflicts,
  )
  return {
    items,
    order: mergeOrder(
      'search-engines',
      'customSearchEngines.order',
      base.order,
      local.order,
      remote.order,
      new Set(items.map((item) => item.id)),
      conflicts,
    ),
  }
}

function mergeOptional(
  base: SyncSnapshotV1['optional'],
  local: SyncSnapshotV1['optional'],
  remote: SyncSnapshotV1['optional'],
  conflicts: SyncConflict[],
): SyncSnapshotV1['optional'] {
  const result: NonNullable<SyncSnapshotV1['optional']> = {}
  if (local?.blockedTopSites && remote?.blockedTopSites) {
    const baseUrls = new Set(base?.blockedTopSites?.urls ?? [])
    const localUrls = new Set(local.blockedTopSites.urls)
    const remoteUrls = new Set(remote.blockedTopSites.urls)
    const urls = new Set<string>()
    for (const url of new Set([...baseUrls, ...localUrls, ...remoteUrls])) {
      const inBase = baseUrls.has(url)
      const inLocal = localUrls.has(url)
      const inRemote = remoteUrls.has(url)
      if (inLocal === inRemote ? inLocal : inLocal === inBase ? inRemote : inLocal) urls.add(url)
    }
    result.blockedTopSites = { urls: [...urls].sort() }
  } else {
    result.blockedTopSites = local?.blockedTopSites ?? remote?.blockedTopSites
  }

  if (local?.wallpapers && remote?.wallpapers) {
    result.wallpapers = mergeJson(
      'wallpaper',
      'optional.wallpapers',
      canonicalize(base?.wallpapers ?? {}) as JsonObject,
      canonicalize(local.wallpapers) as JsonObject,
      canonicalize(remote.wallpapers) as JsonObject,
      conflicts,
    ) as NonNullable<SyncSnapshotV1['optional']>['wallpapers']
  } else {
    result.wallpapers = local?.wallpapers ?? remote?.wallpapers
  }

  const onlineWallpaperUrl = mergeJson(
    'settings',
    'optional.onlineWallpaperUrl',
    base?.onlineWallpaperUrl ?? MISSING,
    local?.onlineWallpaperUrl ?? MISSING,
    remote?.onlineWallpaperUrl ?? MISSING,
    conflicts,
  )
  if (onlineWallpaperUrl !== MISSING && typeof onlineWallpaperUrl === 'string') {
    result.onlineWallpaperUrl = onlineWallpaperUrl
  }

  return result.blockedTopSites || result.wallpapers || result.onlineWallpaperUrl !== undefined
    ? result
    : undefined
}

export function mergeSyncSnapshots(
  base: SyncSnapshotV1,
  local: SyncSnapshotV1,
  remote: SyncSnapshotV1,
): ThreeWayMergeResult {
  const conflicts: SyncConflict[] = []
  const hasSettings = Boolean(base.settings || local.settings || remote.settings)
  const normalizedRemoteSettings = normalizeRemoteSyncSettings(
    base.settings ?? {},
    remote.settings ?? {},
  )
  const settings = hasSettings
    ? preserveUnknownSyncSettings(
        mergeJson(
          'settings',
          'settings',
          pickSyncSettings(base.settings ?? {}),
          pickSyncSettings(normalizeRemoteSyncSettings(base.settings ?? {}, local.settings ?? {})),
          pickSyncSettings(normalizedRemoteSettings),
          conflicts,
        ) as JsonObject,
        normalizedRemoteSettings,
      )
    : MISSING
  const ui = mergeJson(
    'ui', 'ui', base.ui ?? MISSING, local.ui ?? MISSING, remote.ui ?? MISSING, conflicts,
  )
  const scope = mergeJson(
    'scope', 'scope', canonicalize(base.scope), canonicalize(local.scope),
    canonicalize(remote.scope), conflicts,
  ) as unknown as SyncSnapshotV1['scope']
  const quickLinks = base.quickLinks && local.quickLinks && remote.quickLinks
    ? mergeQuickLinks(base.quickLinks, local.quickLinks, remote.quickLinks, conflicts)
    : mergeJson(
        'quick-links', 'quickLinks', base.quickLinks ? canonicalize(base.quickLinks) : MISSING,
        local.quickLinks ? canonicalize(local.quickLinks) : MISSING,
        remote.quickLinks ? canonicalize(remote.quickLinks) : MISSING, conflicts,
      )
  const searchEngines = base.customSearchEngines
    && local.customSearchEngines
    && remote.customSearchEngines
    ? mergeSearchEngines(
        base.customSearchEngines,
        local.customSearchEngines,
        remote.customSearchEngines,
        conflicts,
      )
    : mergeJson(
        'search-engines', 'customSearchEngines',
        base.customSearchEngines ? canonicalize(base.customSearchEngines) : MISSING,
        local.customSearchEngines ? canonicalize(local.customSearchEngines) : MISSING,
        remote.customSearchEngines ? canonicalize(remote.customSearchEngines) : MISSING,
        conflicts,
      )
  const snapshot: SyncSnapshotV1 = {
    scope,
    optional: mergeOptional(base.optional, local.optional, remote.optional, conflicts),
  }
  if (settings !== MISSING) snapshot.settings = settings as JsonObject
  if (quickLinks !== MISSING) snapshot.quickLinks = quickLinks as SyncSnapshotV1['quickLinks']
  if (searchEngines !== MISSING) {
    snapshot.customSearchEngines = searchEngines as SyncSnapshotV1['customSearchEngines']
  }
  if (ui !== MISSING) snapshot.ui = ui as SyncSnapshotV1['ui']
  const usedImages = new Set([
    ...(snapshot.quickLinks?.items.map((item) => item.faviconHash) ?? []),
    ...(snapshot.customSearchEngines?.items.map((item) => item.iconHash) ?? []),
  ].filter((hash): hash is string => Boolean(hash)))
  const images = { ...base.inlineImages, ...local.inlineImages, ...remote.inlineImages }
  snapshot.inlineImages = Object.fromEntries(
    Object.entries(images).filter(([hash]) => usedImages.has(hash)),
  )
  if (Object.keys(snapshot.inlineImages).length === 0) delete snapshot.inlineImages
  if (!snapshot.optional) delete snapshot.optional
  return {
    status: conflicts.length
      ? 'conflict'
      : jsonEquals(snapshot, local) && jsonEquals(snapshot, remote)
        ? 'unchanged'
        : jsonEquals(snapshot, local)
          ? 'use-local'
          : jsonEquals(snapshot, remote)
            ? 'use-remote'
            : 'merged',
    snapshot,
    conflicts,
  }
}
