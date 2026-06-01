import type { QuickLinksData } from '@/shared/quickLinks/quickLinksStorage'
import type { CURRENT_CONFIG_SCHEMA } from '@/shared/settings'

export interface SyncedCustomSearchEngine {
  id: string
  name: string
  url: string
  icon?: string
}

export interface SyncedCustomSearchEngineStorage {
  items: SyncedCustomSearchEngine[]
}

export const defaultSyncedCustomSearchEngines: SyncedCustomSearchEngineStorage = {
  items: [],
}

interface SyncEnvelopeBase {
  configVersion: number
  fromDeviceId: string
  fromDeviceName: string
  lastUpdate: number
  settings: CURRENT_CONFIG_SCHEMA
  customSearchEngines: SyncedCustomSearchEngineStorage
  /** Monotonically increasing version; +1 on each effective push. */
  version: number
  /** Cloud version this push was based on; used to detect stale-device overwrites. */
  baseVersion: number
}

export interface SyncEnvelopeV1 extends SyncEnvelopeBase {
  _v: 1
  bookmarks: QuickLinksData
}

export interface SyncEnvelopeV2 extends SyncEnvelopeBase {
  _v: 2
  quickLinks: QuickLinksData
}

export type SyncEnvelope = SyncEnvelopeV1 | SyncEnvelopeV2

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isValidTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

const isValidCustomSearchEngineStorage = (
  value: unknown,
): value is SyncedCustomSearchEngineStorage => {
  if (!isObjectRecord(value) || !Array.isArray(value.items)) {
    return false
  }

  return value.items.every((item) => {
    if (!isObjectRecord(item)) return false
    return (
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      typeof item.url === 'string' &&
      (item.icon === undefined || typeof item.icon === 'string')
    )
  })
}

const isValidQuickLinkItem = (value: unknown): value is QuickLinksData['items'][number] => {
  if (!isObjectRecord(value)) return false
  return (
    typeof value.url === 'string' &&
    typeof value.title === 'string' &&
    (value.favicon === undefined || typeof value.favicon === 'string')
  )
}

const isValidQuickLinksData = (value: unknown): value is QuickLinksData => {
  if (!isObjectRecord(value) || !Array.isArray(value.items)) return false
  if (!value.items.every(isValidQuickLinkItem)) return false
  if (value.groups === undefined) return true
  if (!Array.isArray(value.groups)) return false

  return value.groups.every((group) => {
    if (!isObjectRecord(group)) return false
    return (
      typeof group.id === 'string' &&
      typeof group.name === 'string' &&
      Array.isArray(group.items) &&
      group.items.every(isValidQuickLinkItem)
    )
  })
}

const hasValidBaseEnvelopeFields = (value: Record<string, unknown>) =>
  typeof value.configVersion === 'number' &&
  typeof value.fromDeviceId === 'string' &&
  typeof value.fromDeviceName === 'string' &&
  isValidTimestamp(value.lastUpdate) &&
  isObjectRecord(value.settings) &&
  isValidCustomSearchEngineStorage(value.customSearchEngines) &&
  typeof value.version === 'number' &&
  typeof value.baseVersion === 'number'

export const isSyncEnvelopeV1 = (value: unknown): value is SyncEnvelopeV1 =>
  isObjectRecord(value) &&
  value._v === 1 &&
  hasValidBaseEnvelopeFields(value) &&
  isValidQuickLinksData(value.bookmarks)

export const isSyncEnvelopeV2 = (value: unknown): value is SyncEnvelopeV2 =>
  isObjectRecord(value) &&
  value._v === 2 &&
  hasValidBaseEnvelopeFields(value) &&
  isValidQuickLinksData(value.quickLinks)

export const isSyncEnvelope = (value: unknown): value is SyncEnvelope =>
  isSyncEnvelopeV1(value) || isSyncEnvelopeV2(value)

export const normalizeSyncEnvelope = (value: unknown): SyncEnvelopeV2 | null => {
  if (isSyncEnvelopeV2(value)) return value
  if (!isSyncEnvelopeV1(value)) return null

  const { bookmarks, ...rest } = value
  return {
    ...rest,
    _v: 2,
    quickLinks: bookmarks,
  }
}

export interface LocalSyncMeta {
  deviceId: string
  deviceName: string
  lastSyncedAt: number
  localModifiedAt: number
  /** The last cloud version this device successfully synced or pushed. */
  localVersion: number
}

// ─── Message types ────────────────────────────────────────────────────────────

/** newtab → bg: newtab has initialized; bg re-reads LocalSyncMeta for device info.
 *  Optional `payload` carries the current local snapshot so background has data for
 *  processSyncQueue even if watch() didn't fire after a SW restart. */
export interface SyncInitedMessage {
  type: 'SYNC_INITED'
  payload?: SyncEnvelopeV2
}

/** newtab → bg: sanitized local data changed; bg decides whether and when to push. */
export interface SyncLocalChangedMessage {
  type: 'SYNC_LOCAL_CHANGED'
  data: SyncEnvelopeV2
}

/** newtab → bg: legacy alias for SYNC_LOCAL_CHANGED; accepted for backward compatibility. */
export interface SyncRequestMessage {
  type: 'SYNC_REQUEST'
  data: SyncEnvelopeV2
}

/** newtab → bg: user chose how to resolve a conflict. */
export interface SyncConflictResolveMessage {
  type: 'SYNC_CONFLICT_RESOLVE'
  choice: 'cloud' | 'local'
}

/** newtab → bg: clear legacy envelope and re-initialize cloud sync state. */
export interface SyncClearLegacyMessage {
  type: 'SYNC_CLEAR_LEGACY'
}

/** bg → newtab: apply this cloud data to local state. */
export interface SyncApplyDataMessage {
  type: 'SYNC_APPLY_DATA'
  data: SyncEnvelopeV2
}

/** bg → newtab: version conflict detected; user must choose how to resolve. */
export interface SyncConflictMessage {
  type: 'SYNC_CONFLICT'
  payload: SyncEventPayloadMap['conflict']
}

/** bg → newtab: cloud data is in a legacy format; user must reset. */
export interface SyncLegacyDetectedMessage {
  type: 'SYNC_LEGACY_DETECTED'
}

/** bg → newtab: cloud configVersion is newer than supported; sync disabled. */
export interface SyncVersionTooNewMessage {
  type: 'SYNC_VERSION_TOO_NEW'
  cloud: number
  local: number
}

export type SyncMessage =
  | SyncInitedMessage
  | SyncLocalChangedMessage
  | SyncRequestMessage
  | SyncConflictResolveMessage
  | SyncClearLegacyMessage
  | SyncApplyDataMessage
  | SyncConflictMessage
  | SyncLegacyDetectedMessage
  | SyncVersionTooNewMessage

export type SyncEventType = 'legacy-detected' | 'version-too-new' | 'conflict' | 'sync-error'

export type SyncEventPayloadMap = {
  'legacy-detected': undefined
  'version-too-new': { cloud: number; local: number }
  conflict: {
    cloud: { lastUpdate: number; fromDeviceName: string; fromDeviceId: string }
    local: { localModifiedAt: number }
  }
  'sync-error': Error
}
