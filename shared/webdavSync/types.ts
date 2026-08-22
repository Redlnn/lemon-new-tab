export type JsonPrimitive = boolean | null | number | string
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export interface JsonObject {
  [key: string]: JsonValue
}

export type ColorModePreference = 'auto' | 'dark' | 'light'

export interface SyncQuickLinkV1 {
  id: string
  url: string
  title: string
  favicon?: string
  faviconHash?: string
}

export interface SyncQuickLinkGroupV1 {
  id: string
  name: string
  itemIds: string[]
}

export interface SyncQuickLinksDataV1 {
  items: SyncQuickLinkV1[]
  rootOrder: string[]
  groups: SyncQuickLinkGroupV1[]
  groupOrder: string[]
}

export interface SyncCustomSearchEngineV1 {
  id: string
  name: string
  url: string
  icon?: string
  iconHash?: string
}

export interface SyncCustomSearchEngineDataV1 {
  items: SyncCustomSearchEngineV1[]
  order: string[]
}

export interface SyncBlockedTopSitesV1 {
  urls: string[]
}

export interface SyncWallpaperV1 {
  assetId: string
  size: number
  mimeType: string
  sha256: string
}

export interface SyncWallpapersV1 {
  light?: SyncWallpaperV1
  dark?: SyncWallpaperV1
}

export interface SyncSnapshotV1 {
  scope: SyncScopePreferences
  settings?: JsonObject
  quickLinks?: SyncQuickLinksDataV1
  customSearchEngines?: SyncCustomSearchEngineDataV1
  ui?: {
    language: string
    colorMode: ColorModePreference
  }
  inlineImages?: Record<string, string>
  optional?: {
    blockedTopSites?: SyncBlockedTopSitesV1
    wallpapers?: SyncWallpapersV1
    onlineWallpaperUrl?: string
  }
}

export interface AssetReferenceV1 {
  id: string
  path: string
  role: 'wallpaper-dark' | 'wallpaper-light'
  size: number
  mimeType: string
  sha256: string
}

export interface TombstoneV1 {
  entityType: string
  entityId: string
  deletedByRevisionId: string
  deletedAt: string
  expiresAt: string
}

export interface CommitRecordV1 {
  formatVersion: 1
  vaultId: string
  generationId: string
  revisionId: string
  payloadPath: string
  payloadHash: string
  payloadSize: number
  encrypted: boolean
  scope: SyncScopePreferences
  complete: true
}

export interface VaultMetadataV1 {
  product: 'lemon-new-tab'
  formatVersion: 1
  vaultId: string
  generationId: string
  encrypted: boolean
  encryption?: VaultEncryptionMetadataV1
}

export interface VaultEncryptionMetadataV1 {
  algorithm: 'AES-256-GCM'
  kdf: 'PBKDF2-HMAC-SHA-256'
  iterations: number
  salt: string
  keyCheck: string
}

export type SyncRevisionReason =
  | 'initial'
  | 'local-change'
  | 'merge'
  | 'restore'
  | 'repair'
  | 'import'

export interface SyncRevisionV1 {
  formatVersion: 1
  settingsSchemaVersion: number
  vaultId: string
  generationId: string
  revisionId: string
  parentRevisionIds: string[]
  operationId: string
  device: {
    id: string
    name: string
  }
  createdAt: string
  reason: SyncRevisionReason
  snapshot: SyncSnapshotV1
  tombstones: TombstoneV1[]
  assets: AssetReferenceV1[]
  snapshotHash: string
}

export interface SyncDeviceRecordV1 {
  deviceId: string
  firstSeenAt: string
  formatVersion: 1
  generationId: string
  lastRevisionId: string
  lastSeenAt: string
  name: string
  vaultId: string
}

export interface SyncScopePreferences {
  settings: boolean
  quickLinks: boolean
  customSearchEngines: boolean
  uiPreferences: boolean
  blockedTopSites: boolean
  wallpapers: boolean
  onlineWallpaperUrl: boolean
  userIcons: boolean
}

export type LocalResourceOmission =
  | {
      kind: 'quick-link-icon' | 'search-engine-icon'
      id: string
      reason: 'aggregate-too-large' | 'item-too-large'
    }
  | {
      kind: 'wallpaper'
      variant: 'dark' | 'light'
      reason: 'storage-full' | 'too-large' | 'unavailable' | 'unsupported'
    }

export type SyncPauseReason =
  | 'authentication'
  | 'conflict'
  | 'corrupted-remote'
  | 'encryption-password'
  | 'format-too-new'
  | 'remote-deleted'
  | 'storage-full'

export type PendingSyncPhase =
  | 'captured'
  | 'assets-uploaded'
  | 'committed'
  | 'applying-local'

export interface PendingSyncOperation {
  operationId: string
  phase: PendingSyncPhase
  revisionId?: string
  startedAt: string
}

export interface SanitizedSyncError {
  category: string
  operationId: string
  occurredAt: string
  phase: PendingSyncPhase | 'scan' | 'unknown'
  status?: number
  pathKind?: 'asset' | 'commit' | 'control' | 'revision' | 'vault'
}

export interface LocalSyncStateV1 {
  configured: boolean
  paused: boolean
  pauseReason?: SyncPauseReason
  vaultId?: string
  generationId?: string
  deviceId: string
  deviceFirstSeenAt?: string
  deviceName: string
  deviceRecordAt?: string
  baseRevisionId?: string
  lastSuccessAt?: string
  pending?: PendingSyncOperation
  lastError?: SanitizedSyncError
  resourceOmissions: readonly LocalResourceOmission[]
  scope: SyncScopePreferences
  encrypted: boolean
}

export type SyncAvailability =
  | { state: 'included' }
  | { state: 'excluded-by-design'; reasonKey: string }
  | { state: 'excluded-by-user'; reasonKey: string }
  | { state: 'pending-permission'; reasonKey: string }
  | { state: 'unsupported-resource'; reasonKey: string }
  | { state: 'too-large'; reasonKey: string }
  | { state: 'failed'; reasonKey: string }

export type SyncConflictKind =
  | 'delete-vs-modify'
  | 'field'
  | 'order'
  | 'simultaneous-create'

export interface SyncConflict {
  id: string
  category:
    | 'settings'
    | 'quick-links'
    | 'search-engines'
    | 'blocked-top-sites'
    | 'wallpaper'
    | 'scope'
    | 'ui'
  kind: SyncConflictKind
  path: string
  base?: JsonValue
  local?: JsonValue
  remote?: JsonValue
  canKeepBoth: boolean
}

export interface ThreeWayMergeResult {
  status: 'conflict' | 'merged' | 'unchanged' | 'use-local' | 'use-remote'
  snapshot: SyncSnapshotV1
  conflicts: SyncConflict[]
}

export interface SyncConflictResolution {
  choice: 'both' | 'local' | 'remote'
  conflictId: string
  duplicateId?: string
}
