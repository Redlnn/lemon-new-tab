import { storage } from '#imports'
import { browser } from 'wxt/browser'

import {
  idbClear,
  idbDelete,
  idbGet,
  idbSet,
} from '@/shared/storage/idb'

import type {
  LocalSyncStateV1,
  SyncScopePreferences,
  SyncSnapshotV1,
} from './types.ts'
import type { WebDavConnection } from './webdav.ts'

export const DEFAULT_SYNC_SCOPE: Readonly<SyncScopePreferences> = {
  searchHistory: false,
  blockedTopSites: false,
  wallpapers: false,
  onlineWallpaperUrl: true,
  quickLinkIcons: true,
}

export interface WebDavSyncConfigV1 {
  version: 1
  connection: Omit<WebDavConnection, 'password' | 'username'>
  username: string
  directory: string
  rememberPassword: boolean
}

interface StoredWebDavSecretV1 {
  version: 1
  password: string
}

export interface PendingApplyV1 {
  version: 1
  operationId: string
  revisionId: string
  phase:
    | 'validated'
    | 'wallpapers'
    | 'settings'
    | 'quick-links'
    | 'search-engines'
    | 'ui'
    | 'optional'
  snapshot: SyncSnapshotV1
  wallpapers?: Partial<Record<'dark' | 'light', PendingWallpaperApplyV1>>
}

export interface PendingWallpaperApplyV1 {
  assetId: string
  mimeType: string
  previousId: string
  sha256: string
  size: number
  temporaryKey: string
}

export interface StoredSyncConflictV1 {
  version: 1
  base: SyncSnapshotV1
  local: SyncSnapshotV1
  remote: SyncSnapshotV1
  remoteRevisionIds: string[]
}

const BASELINE_KEY = 'baseline-v1'
const PENDING_SNAPSHOT_KEY = 'pending-snapshot-v1'
const PENDING_APPLY_KEY = 'pending-apply-v1'
const CONFLICT_KEY = 'conflict-v1'
const ENCRYPTION_KEY_PREFIX = 'encryption-key-v1:'
const SESSION_SECRET_KEY = 'webdavSyncSecret'

export const webDavSyncConfigStorage = storage.defineItem<WebDavSyncConfigV1 | null>(
  'local:webdavSyncConfig',
  { fallback: null },
)

const webDavSyncSecretStorage = storage.defineItem<StoredWebDavSecretV1 | null>(
  'local:webdavSyncSecret',
  { fallback: null },
)

export const webDavSyncStateStorage = storage.defineItem<LocalSyncStateV1>(
  'local:webdavSyncState',
  {
    fallback: {
      configured: false,
      paused: false,
      deviceId: '',
      deviceName: '',
      historyLimit: 10,
      scope: { ...DEFAULT_SYNC_SCOPE },
      encrypted: false,
    },
  },
)

export async function getOrCreateSyncState(): Promise<LocalSyncStateV1> {
  const current = await webDavSyncStateStorage.getValue()
  const state: LocalSyncStateV1 = {
    ...current,
    deviceId: current.deviceId || crypto.randomUUID(),
    historyLimit: Math.min(20, Math.max(2, current.historyLimit || 10)),
    scope: { ...DEFAULT_SYNC_SCOPE, ...current.scope },
  }
  if (canonicalState(current) !== canonicalState(state)) await webDavSyncStateStorage.setValue(state)
  return state
}

export async function patchSyncState(
  patch: Partial<LocalSyncStateV1>,
): Promise<LocalSyncStateV1> {
  const current = await getOrCreateSyncState()
  const next = { ...current, ...patch }
  await webDavSyncStateStorage.setValue(next)
  return next
}

export async function saveWebDavPassword(password: string, remember: boolean): Promise<void> {
  const value: StoredWebDavSecretV1 = { version: 1, password }
  if (remember) {
    await webDavSyncSecretStorage.setValue(value)
    await browser.storage.session.remove(SESSION_SECRET_KEY).catch(() => undefined)
  } else {
    await webDavSyncSecretStorage.setValue(null)
    await browser.storage.session.set({ [SESSION_SECRET_KEY]: value })
  }
}

export async function getWebDavPassword(): Promise<string | null> {
  const stored = await webDavSyncSecretStorage.getValue()
  if (stored?.version === 1) return stored.password
  const session = (await browser.storage.session
    .get(SESSION_SECRET_KEY)
    .catch(() => ({}))) as Record<string, unknown>
  const value = session[SESSION_SECRET_KEY] as StoredWebDavSecretV1 | undefined
  return value?.version === 1 ? value.password : null
}

export async function clearWebDavConnection(): Promise<void> {
  await Promise.all([
    webDavSyncConfigStorage.setValue(null),
    webDavSyncSecretStorage.setValue(null),
    browser.storage.session.remove(SESSION_SECRET_KEY).catch(() => undefined),
  ])
  await webDavSyncStateStorage.setValue({
    configured: false,
    paused: false,
    deviceId: crypto.randomUUID(),
    deviceName: '',
    historyLimit: 10,
    scope: { ...DEFAULT_SYNC_SCOPE },
    encrypted: false,
  })
  await idbClear('webdavSync')
}

function encryptionKeyId(vaultId: string, generationId: string): string {
  return `${ENCRYPTION_KEY_PREFIX}${vaultId}:${generationId}`
}

function isStoredEncryptionKey(value: unknown): value is CryptoKey {
  if (!value || typeof value !== 'object') return false
  const key = value as CryptoKey
  return (
    key.type === 'secret' &&
    key.extractable === false &&
    key.algorithm?.name === 'AES-GCM' &&
    key.usages.includes('decrypt') &&
    key.usages.includes('encrypt')
  )
}

export async function getStoredEncryptionKey(
  vaultId: string,
  generationId: string,
): Promise<CryptoKey | undefined> {
  const value = await idbGet('webdavSync', encryptionKeyId(vaultId, generationId))
  return isStoredEncryptionKey(value) ? value : undefined
}

export function setStoredEncryptionKey(
  vaultId: string,
  generationId: string,
  key: CryptoKey,
): Promise<void> {
  if (!isStoredEncryptionKey(key)) throw new TypeError('Encryption key is not a safe AES key')
  return idbSet('webdavSync', encryptionKeyId(vaultId, generationId), key)
}

export function clearStoredEncryptionKey(vaultId: string, generationId: string): Promise<void> {
  return idbDelete('webdavSync', encryptionKeyId(vaultId, generationId))
}

export function getBaseline(): Promise<SyncSnapshotV1 | undefined> {
  return idbGet('webdavSync', BASELINE_KEY) as Promise<SyncSnapshotV1 | undefined>
}

export function setBaseline(snapshot: SyncSnapshotV1): Promise<void> {
  return idbSet('webdavSync', BASELINE_KEY, snapshot)
}

export function getPendingSnapshot(): Promise<SyncSnapshotV1 | undefined> {
  return idbGet('webdavSync', PENDING_SNAPSHOT_KEY) as Promise<SyncSnapshotV1 | undefined>
}

export function setPendingSnapshot(snapshot: SyncSnapshotV1): Promise<void> {
  return idbSet('webdavSync', PENDING_SNAPSHOT_KEY, snapshot)
}

export function clearPendingSnapshot(): Promise<void> {
  return idbDelete('webdavSync', PENDING_SNAPSHOT_KEY)
}

export function getPendingApply(): Promise<PendingApplyV1 | undefined> {
  return idbGet('webdavSync', PENDING_APPLY_KEY) as Promise<PendingApplyV1 | undefined>
}

export function setPendingApply(value: PendingApplyV1): Promise<void> {
  return idbSet('webdavSync', PENDING_APPLY_KEY, value)
}

export function clearPendingApply(): Promise<void> {
  return idbDelete('webdavSync', PENDING_APPLY_KEY)
}

export function getStoredConflict(): Promise<StoredSyncConflictV1 | undefined> {
  return idbGet('webdavSync', CONFLICT_KEY) as Promise<StoredSyncConflictV1 | undefined>
}

export function setStoredConflict(value: StoredSyncConflictV1): Promise<void> {
  return idbSet('webdavSync', CONFLICT_KEY, value)
}

export function clearStoredConflict(): Promise<void> {
  return idbDelete('webdavSync', CONFLICT_KEY)
}

function canonicalState(value: LocalSyncStateV1): string {
  return JSON.stringify(value)
}
