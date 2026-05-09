import type { CURRENT_CONFIG_SCHEMA } from '@/shared/settings'
import type { Shortcuts } from '@/shared/shortcut/shortcutStorage'

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

export interface SyncEnvelopeV1 {
  _v: 1
  configVersion: number
  fromDeviceId: string
  fromDeviceName: string
  lastUpdate: number
  settings: CURRENT_CONFIG_SCHEMA
  bookmarks: Shortcuts
  customSearchEngines: SyncedCustomSearchEngineStorage
  /** Monotonically increasing version; +1 on each effective push. */
  version: number
  /** Cloud version this push was based on; used to detect stale-device overwrites. */
  baseVersion: number
}

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

export const isSyncEnvelopeV1 = (value: unknown): value is SyncEnvelopeV1 => {
  if (!isObjectRecord(value)) return false

  return (
    value._v === 1 &&
    typeof value.configVersion === 'number' &&
    typeof value.fromDeviceId === 'string' &&
    typeof value.fromDeviceName === 'string' &&
    isValidTimestamp(value.lastUpdate) &&
    isObjectRecord(value.settings) &&
    isObjectRecord(value.bookmarks) &&
    isValidCustomSearchEngineStorage(value.customSearchEngines) &&
    typeof value.version === 'number' &&
    typeof value.baseVersion === 'number'
  )
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
  payload?: SyncEnvelopeV1
}

/** newtab → bg: sanitized local data changed; bg decides whether and when to push. */
export interface SyncLocalChangedMessage {
  type: 'SYNC_LOCAL_CHANGED'
  data: SyncEnvelopeV1
}

/** newtab → bg: legacy alias for SYNC_LOCAL_CHANGED; accepted for backward compatibility. */
export interface SyncRequestMessage {
  type: 'SYNC_REQUEST'
  data: SyncEnvelopeV1
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
  data: SyncEnvelopeV1
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
