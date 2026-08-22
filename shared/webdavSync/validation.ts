import { jsonByteLength } from './canonical.ts'
import {
  MAX_SYNC_INLINE_IMAGE_BYTES,
  MAX_SYNC_INLINE_IMAGES_BYTES,
  MAX_SYNC_SNAPSHOT_BYTES,
  MAX_SYNC_WALLPAPER_BYTES,
} from './catalog.ts'
import type {
  AssetReferenceV1,
  CommitRecordV1,
  LocalSyncStateV1,
  SyncRevisionReason,
  SyncRevisionV1,
  SyncScopePreferences,
  SyncSnapshotV1,
  TombstoneV1,
} from './types.ts'

export const MAX_METADATA_BYTES = 256 * 1024
export const MAX_REVISION_BYTES = MAX_SYNC_SNAPSHOT_BYTES
const MAX_STORED_REVISION_BYTES = MAX_REVISION_BYTES + 64 * 1024

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string }

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH_PATTERN = /^[0-9a-f]{64}$/i
const REVISION_REASONS = new Set<SyncRevisionReason>([
  'initial',
  'local-change',
  'merge',
  'restore',
  'repair',
  'import',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function isEntityId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && HASH_PATTERN.test(value)
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function hasJsonSizeAtMost(value: unknown, maximum: number): boolean {
  try {
    return jsonByteLength(value) <= maximum
  } catch {
    return false
  }
}

function isSafeRelativePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    !value.startsWith('/') &&
    !value.startsWith('\\') &&
    !value.split(/[\\/]/).includes('..')
  )
}

function hasExactOrder(value: unknown, ids: ReadonlySet<string>): value is string[] {
  if (!Array.isArray(value) || !value.every(isEntityId)) return false
  const order = new Set(value)
  return order.size === value.length && order.size === ids.size && value.every((id) => ids.has(id))
}

function isUniqueIdList(value: unknown, ids: ReadonlySet<string>): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(isEntityId) &&
    new Set(value).size === value.length &&
    value.every((id) => ids.has(id))
  )
}

function hasUniqueIds(items: readonly { id: string }[]): boolean {
  return new Set(items.map((item) => item.id)).size === items.length
}

function isQuickLinks(value: unknown, images: Readonly<Record<string, string>>): boolean {
  if (!isRecord(value) || !Array.isArray(value.items) || !Array.isArray(value.groups)) return false
  const items = value.items
  if (
    !items.every(
      (item) =>
        isRecord(item) &&
        isEntityId(item.id) &&
        typeof item.url === 'string' &&
        typeof item.title === 'string' &&
        (item.faviconHash === undefined ||
          (typeof item.faviconHash === 'string' &&
            Object.hasOwn(images, item.faviconHash))) &&
        item.favicon === undefined,
    )
  ) {
    return false
  }
  const typedItems = items as Array<{ id: string }>
  if (!hasUniqueIds(typedItems)) return false
  const itemIds = new Set(typedItems.map((item) => item.id))

  const groups = value.groups
  if (
    !groups.every(
      (group) =>
        isRecord(group) &&
        isEntityId(group.id) &&
        typeof group.name === 'string' &&
        Array.isArray(group.itemIds) &&
        group.itemIds.every(isEntityId) &&
        new Set(group.itemIds).size === group.itemIds.length &&
        group.itemIds.every((id) => itemIds.has(id)),
    )
  ) {
    return false
  }
  const typedGroups = groups as Array<{ id: string; itemIds: string[] }>
  if (!hasUniqueIds(typedGroups)) return false
  const groupIds = new Set(typedGroups.map((group) => group.id))
  if (!hasExactOrder(value.groupOrder, groupIds)) return false

  if (!isUniqueIdList(value.rootOrder, itemIds)) return false
  const referencedItems = [
    ...value.rootOrder,
    ...typedGroups.flatMap((group) => group.itemIds),
  ]
  return (
    referencedItems.length === itemIds.size &&
    new Set(referencedItems).size === itemIds.size
  )
}

function isCustomSearchEngines(value: unknown, images: Readonly<Record<string, string>>): boolean {
  if (!isRecord(value) || !Array.isArray(value.items)) return false
  const items = value.items
  if (
    !items.every(
      (item) =>
        isRecord(item) &&
        isEntityId(item.id) &&
        typeof item.name === 'string' &&
        typeof item.url === 'string' &&
        item.icon === undefined &&
        (item.iconHash === undefined ||
          (typeof item.iconHash === 'string' && Object.hasOwn(images, item.iconHash))),
    )
  ) {
    return false
  }
  const typedItems = items as Array<{ id: string }>
  return hasUniqueIds(typedItems) && hasExactOrder(value.order, new Set(typedItems.map(({ id }) => id)))
}

function isBlockedTopSites(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.urls) || !value.urls.every((url) => typeof url === 'string')) {
    return false
  }
  if (new Set(value.urls).size !== value.urls.length) return false
  return value.urls.every((value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  })
}

function isWallpaper(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.assetId === 'string' &&
    /^sha256-[0-9a-f]{64}$/i.test(value.assetId) &&
    typeof value.size === 'number' &&
    Number.isSafeInteger(value.size) &&
    value.size >= 0 &&
    value.size <= MAX_SYNC_WALLPAPER_BYTES &&
    typeof value.mimeType === 'string' &&
    value.mimeType.startsWith('image/') &&
    isHash(value.sha256)
  )
}

function isWallpapers(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.light === undefined || isWallpaper(value.light)) &&
    (value.dark === undefined || isWallpaper(value.dark))
  )
}

export function isSyncScope(value: unknown): value is SyncScopePreferences {
  if (!isRecord(value)) return false
  const keys: Array<keyof SyncScopePreferences> = [
    'settings', 'quickLinks', 'customSearchEngines', 'uiPreferences',
    'blockedTopSites', 'wallpapers', 'onlineWallpaperUrl', 'userIcons',
  ]
  return keys.every((key) => typeof value[key] === 'boolean')
    && keys.some((key) => value[key] === true)
}

export function parseLocalSyncState(value: unknown): LocalSyncStateV1 {
  if (
    !isRecord(value) ||
    typeof value.configured !== 'boolean' ||
    typeof value.paused !== 'boolean' ||
    typeof value.deviceId !== 'string' ||
    typeof value.deviceName !== 'string' ||
    !Array.isArray(value.resourceOmissions) ||
    !isSyncScope(value.scope) ||
    typeof value.encrypted !== 'boolean'
  ) {
    throw new TypeError('Invalid sync state response')
  }
  return value as unknown as LocalSyncStateV1
}

function isInlineImages(value: unknown): value is Record<string, string> {
  if (value === undefined) return true
  if (!isRecord(value)) return false
  let total = 0
  for (const [hash, image] of Object.entries(value)) {
    if (!HASH_PATTERN.test(hash) || typeof image !== 'string') return false
    const size = new TextEncoder().encode(image).byteLength
    if (size > MAX_SYNC_INLINE_IMAGE_BYTES) return false
    total += size
  }
  return total <= MAX_SYNC_INLINE_IMAGES_BYTES
}

function isSyncSnapshot(value: unknown): boolean {
  if (!isRecord(value) || !isSyncScope(value.scope) || !isInlineImages(value.inlineImages)) return false
  const images = (value.inlineImages ?? {}) as Record<string, string>
  if (value.settings !== undefined && !isRecord(value.settings)) return false
  if (value.ui !== undefined && (
    !isRecord(value.ui) ||
    typeof value.ui.language !== 'string' ||
    value.ui.language.length === 0 ||
    !['auto', 'dark', 'light'].includes(String(value.ui.colorMode))
  )) return false
  if (value.quickLinks !== undefined && !isQuickLinks(value.quickLinks, images)) return false
  if (
    value.customSearchEngines !== undefined &&
    !isCustomSearchEngines(value.customSearchEngines, images)
  ) return false
  if (value.optional === undefined) return true
  if (!isRecord(value.optional)) return false
  return (
    (value.optional.blockedTopSites === undefined ||
      isBlockedTopSites(value.optional.blockedTopSites)) &&
    (value.optional.wallpapers === undefined || isWallpapers(value.optional.wallpapers)) &&
    (value.optional.onlineWallpaperUrl === undefined ||
      typeof value.optional.onlineWallpaperUrl === 'string')
  )
}

export function validateSyncSnapshot(value: unknown): ValidationResult<SyncSnapshotV1> {
  if (!isSyncSnapshot(value)) return invalid('Sync snapshot is invalid')
  if (!hasJsonSizeAtMost(value, MAX_REVISION_BYTES)) return invalid('Sync snapshot is too large')
  return { ok: true, value: value as unknown as SyncSnapshotV1 }
}

function isTombstone(value: unknown): value is TombstoneV1 {
  if (
    !isRecord(value) ||
    !isEntityId(value.entityType) ||
    !isEntityId(value.entityId) ||
    !isUuid(value.deletedByRevisionId) ||
    !isDate(value.deletedAt) ||
    !isDate(value.expiresAt)
  ) {
    return false
  }
  return Date.parse(value.expiresAt) > Date.parse(value.deletedAt)
}

function isAsset(value: unknown): value is AssetReferenceV1 {
  return (
    isRecord(value) &&
    isEntityId(value.id) &&
    isSafeRelativePath(value.path) &&
    (value.role === 'wallpaper-dark' || value.role === 'wallpaper-light') &&
    typeof value.size === 'number' &&
    Number.isSafeInteger(value.size) &&
    value.size >= 0 &&
    value.size <= MAX_SYNC_WALLPAPER_BYTES &&
    typeof value.mimeType === 'string' &&
    value.mimeType.startsWith('image/') &&
    isHash(value.sha256)
  )
}

function invalid<T>(error: string): ValidationResult<T> {
  return { ok: false, error }
}

export function validateCommitRecord(value: unknown): ValidationResult<CommitRecordV1> {
  if (!isRecord(value)) return invalid('Commit record must be an object')
  if (value.formatVersion !== 1) return invalid('Unsupported commit format')
  if (!hasJsonSizeAtMost(value, MAX_METADATA_BYTES)) return invalid('Commit record is too large or invalid')
  if (!isUuid(value.vaultId) || !isUuid(value.generationId) || !isUuid(value.revisionId)) {
    return invalid('Commit record contains an invalid ID')
  }
  if (!isSafeRelativePath(value.payloadPath)) return invalid('Commit payload path is unsafe')
  if (!isHash(value.payloadHash)) return invalid('Commit payload hash is invalid')
  const payloadSize = value.payloadSize
  if (typeof payloadSize !== 'number' || !Number.isSafeInteger(payloadSize) || payloadSize < 0) {
    return invalid('Commit payload size is invalid')
  }
  if (payloadSize > MAX_STORED_REVISION_BYTES) return invalid('Commit payload is too large')
  if (typeof value.encrypted !== 'boolean' || value.complete !== true) {
    return invalid('Commit completion fields are invalid')
  }
  if (!isSyncScope(value.scope)) return invalid('Commit scope is invalid')
  return { ok: true, value: value as unknown as CommitRecordV1 }
}

export function validateSyncRevision(value: unknown): ValidationResult<SyncRevisionV1> {
  if (!isRecord(value)) return invalid('Revision must be an object')
  if (value.formatVersion !== 1) return invalid('Unsupported revision format')
  if (!hasJsonSizeAtMost(value, MAX_REVISION_BYTES)) return invalid('Revision is too large or invalid')
  if (
    !isUuid(value.vaultId) ||
    !isUuid(value.generationId) ||
    !isUuid(value.revisionId) ||
    !isUuid(value.operationId)
  ) {
    return invalid('Revision contains an invalid ID')
  }
  const settingsSchemaVersion = value.settingsSchemaVersion
  if (
    typeof settingsSchemaVersion !== 'number' ||
    !Number.isSafeInteger(settingsSchemaVersion) ||
    settingsSchemaVersion < 1
  ) {
    return invalid('Settings schema version is invalid')
  }
  if (
    !Array.isArray(value.parentRevisionIds) ||
    !value.parentRevisionIds.every(isUuid) ||
    new Set(value.parentRevisionIds).size !== value.parentRevisionIds.length ||
    value.parentRevisionIds.includes(value.revisionId as string)
  ) {
    return invalid('Revision parents are invalid')
  }
  if (!isRecord(value.device) || !isUuid(value.device.id) || typeof value.device.name !== 'string') {
    return invalid('Revision device is invalid')
  }
  if (value.device.name.length < 1 || value.device.name.length > 80) {
    return invalid('Revision device name is invalid')
  }
  if (!isDate(value.createdAt)) return invalid('Revision time is invalid')
  if (typeof value.reason !== 'string' || !REVISION_REASONS.has(value.reason as SyncRevisionReason)) {
    return invalid('Revision reason is invalid')
  }
  if (!isSyncSnapshot(value.snapshot)) return invalid('Revision snapshot is invalid')
  if (!Array.isArray(value.tombstones) || !value.tombstones.every(isTombstone)) {
    return invalid('Revision tombstones are invalid')
  }
  const tombstoneKeys = value.tombstones.map(
    (tombstone) => `${(tombstone as TombstoneV1).entityType}\u0000${(tombstone as TombstoneV1).entityId}`,
  )
  if (new Set(tombstoneKeys).size !== tombstoneKeys.length) {
    return invalid('Revision contains duplicate tombstones')
  }
  if (!Array.isArray(value.assets) || !value.assets.every(isAsset)) {
    return invalid('Revision assets are invalid')
  }
  const assets = value.assets as AssetReferenceV1[]
  if (
    new Set(assets.map(({ id }) => id)).size !== assets.length ||
    new Set(assets.map(({ path }) => path)).size !== assets.length
  ) {
    return invalid('Revision contains duplicate assets')
  }
  if (!isHash(value.snapshotHash)) return invalid('Revision snapshot hash is invalid')
  return { ok: true, value: value as unknown as SyncRevisionV1 }
}
