import { storage } from '#imports'
import { browser } from 'wxt/browser'

import { getDB, idbClear, idbDelete, idbGet, idbSet } from '@/shared/storage/idb'

import { CURRENT_CONFIG_VERSION } from '../settings/current.ts'

import { SYNC_SCOPE_KEYS } from './domains.ts'
import { decodeWorkingRecord, type WorkingRecord } from './recovery.ts'
import type {
  LocalSyncStateV1,
  SyncConflict,
  SyncScopePreferences,
  SyncSnapshotV1,
  TombstoneV1,
} from './types.ts'
import type { SyncSource } from './version.ts'
import type { WebDavConnection } from './webdav.ts'

export const DEFAULT_SYNC_SCOPE: Readonly<SyncScopePreferences> = {
  settings: true,
  quickLinks: true,
  notes: true,
  customSearchEngines: true,
  uiPreferences: true,
  blockedTopSites: false,
  wallpapers: false,
  onlineWallpaperUrl: false,
  userIcons: false,
}

function normalizeScope(value: Partial<SyncScopePreferences> | undefined): SyncScopePreferences {
  return Object.fromEntries(
    SYNC_SCOPE_KEYS.map((key) => [
      key,
      typeof value?.[key] === 'boolean' ? value[key] : DEFAULT_SYNC_SCOPE[key],
    ]),
  ) as unknown as SyncScopePreferences
}

export function normalizeLocalSyncState(value: unknown): LocalSyncStateV1 {
  const current =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Partial<LocalSyncStateV1>)
      : {}
  return {
    ...Object.fromEntries(
      [
        'vaultId',
        'generationId',
        'deviceFirstSeenAt',
        'deviceRecordAt',
        'baseRevisionId',
        'lastSuccessAt',
        'pending',
        'lastError',
        'pauseReason',
        'retry',
      ]
        .filter((key) => Object.hasOwn(current, key))
        .map((key) => [key, current[key as keyof LocalSyncStateV1]]),
    ),
    configured: current.configured === true,
    enabled: current.enabled !== false,
    paused: current.paused === true,
    deviceId: typeof current.deviceId === 'string' ? current.deviceId : '',
    deviceName: typeof current.deviceName === 'string' ? current.deviceName : '',
    resourceOmissions: Array.isArray(current.resourceOmissions) ? current.resourceOmissions : [],
    scope: normalizeScope(current.scope),
    encrypted: current.encrypted === true,
  }
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
  origin: 'sync' | 'import'
  localBefore?: SyncSnapshotV1
  version: 1
  operationId: string
  wallpaperSignature?: string
  revisionId: string
  phase:
    | 'validated'
    | 'wallpapers'
    | 'settings'
    | 'quick-links'
    | 'notes'
    | 'search-engines'
    | 'ui'
    | 'optional'
  snapshot: SyncSnapshotV1
  scope: SyncScopePreferences
  /** 已先于设置写入的主题偏好，避免恢复时重复触发主题切换。 */
  uiPreferencesApplied?: true
  wallpapers?: Record<string, PendingWallpaperApplyV1>
}

export interface PendingWallpaperApplyV1 {
  variant: 'light' | 'dark'
  itemId: string
  assetId: string
  mimeType: string
  sha256: string
  size: number
  temporaryKey: string
}

export interface StoredSyncConflictV1 {
  version: 1
  base: SyncSnapshotV1
  conflicts: SyncConflict[]
  deviceLocal: SyncSnapshotV1
  local: SyncSnapshotV1
  remote: SyncSnapshotV1
  tombstones?: TombstoneV1[]
  remoteRevisionIds: string[]
  remoteBranchConflicts?: SyncConflict[]
  remainingRemoteRevisionIds: string[]
  stage: 'local-remote' | 'remote-branches'
  remoteVersions?: Array<{
    revisionId: string
    deviceName: string
    modifiedAt: string
  }>
}

const BASELINE_KEY = 'baseline-v1'
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
      enabled: true,
      paused: false,
      deviceId: '',
      deviceName: '',
      resourceOmissions: [],
      scope: { ...DEFAULT_SYNC_SCOPE },
      encrypted: false,
    },
  },
)

async function readSyncState(): Promise<LocalSyncStateV1> {
  const stored = await webDavSyncStateStorage.getValue()
  const current = normalizeLocalSyncState(stored)
  const state: LocalSyncStateV1 = {
    ...current,
    deviceId: current.deviceId || crypto.randomUUID(),
    resourceOmissions: current.resourceOmissions ?? [],
    scope: normalizeScope(current.scope),
  }
  if (canonicalState(stored) !== canonicalState(state)) await webDavSyncStateStorage.setValue(state)
  return state
}

export function getOrCreateSyncState(): Promise<LocalSyncStateV1> {
  return navigator.locks.request('lemon-webdav-state', readSyncState)
}

export async function patchSyncState(patch: Partial<LocalSyncStateV1>): Promise<LocalSyncStateV1> {
  return navigator.locks.request('lemon-webdav-state', async () => {
    const current = await readSyncState()
    const next = { ...current, ...patch }
    await webDavSyncStateStorage.setValue(next)
    return next
  })
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
    enabled: true,
    paused: false,
    deviceId: crypto.randomUUID(),
    deviceName: '',
    resourceOmissions: [],
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

export async function getBaseline(): Promise<SyncSnapshotV1 | undefined> {
  return (await readWorking<{ snapshot: SyncSnapshotV1 }>(BASELINE_KEY))?.snapshot
}

export function setBaseline(snapshot: SyncSnapshotV1): Promise<void> {
  return writeWorking(BASELINE_KEY, { snapshot })
}

export function currentSyncSource(): SyncSource {
  return {
    formatVersion: 1,
    settingsSchemaVersion: CURRENT_CONFIG_VERSION,
    pluginVersion: browser.runtime.getManifest().version,
  }
}

async function readWorking<T extends object>(key: string): Promise<T | undefined> {
  const stored = (await idbGet('webdavSync', key)) as WorkingRecord<T> | undefined
  if (!stored) return undefined
  const value = decodeWorkingRecord(stored, browser.runtime.getManifest().version)
  if (
    JSON.stringify(stored.value) !== JSON.stringify(value) ||
    JSON.stringify(stored.source) !== JSON.stringify(currentSyncSource())
  ) {
    await writeWorking(key, value)
  }
  return value
}

function workingRecord<T extends object>(value: T): WorkingRecord<T> {
  const source = currentSyncSource()
  return { source, value: decodeWorkingRecord({ source, value }, source.pluginVersion) }
}

function writeWorking<T extends object>(key: string, value: T): Promise<void> {
  return idbSet('webdavSync', key, workingRecord(value))
}

export interface PublishRecovery {
  operationId: string
  revisionId: string
  snapshotHash: string
  expectedLocal: SyncSnapshotV1
}

export function getPublishRecovery() {
  return readWorking<PublishRecovery>('publish-recovery')
}

export function setPublishRecovery(value: PublishRecovery) {
  return writeWorking('publish-recovery', value)
}

export function clearPublishRecovery() {
  return idbDelete('webdavSync', 'publish-recovery')
}

export interface AppliedSyncSnapshot {
  operationId: string
  revisionId: string
  snapshot: SyncSnapshotV1
}

export function getAppliedSyncSnapshot() {
  return readWorking<AppliedSyncSnapshot>('applied-sync-snapshot')
}

export function setAppliedSyncSnapshot(value: AppliedSyncSnapshot) {
  return writeWorking('applied-sync-snapshot', value)
}

export function clearAppliedSyncSnapshot() {
  return idbDelete('webdavSync', 'applied-sync-snapshot')
}

export function getPendingApply(): Promise<PendingApplyV1 | undefined> {
  return readWorking<PendingApplyV1>(PENDING_APPLY_KEY)
}

export async function hasPendingApply(): Promise<boolean> {
  return (await (await getDB()).getKey('webdavSync', PENDING_APPLY_KEY)) !== undefined
}

export async function setPendingApply(
  value: PendingApplyV1,
  resources: ReadonlyArray<readonly [string, Blob]> = [],
): Promise<void> {
  const record = workingRecord(value)
  const db = await getDB()
  const tx = db.transaction(['webdavSync', 'wallpaperLibrary'], 'readwrite')
  try {
    const store = tx.objectStore('webdavSync')
    const previous = (await store.get(PENDING_APPLY_KEY)) as
      | WorkingRecord<PendingApplyV1>
      | undefined
    if (previous) {
      const old = decodeWorkingRecord(previous, record.source.pluginVersion)
      const retained = new Set(
        Object.values(value.wallpapers ?? {}).map((item) => item.temporaryKey),
      )
      for (const item of Object.values(old.wallpapers ?? {}))
        if (!retained.has(item.temporaryKey)) await store.delete(item.temporaryKey)
      if (old.operationId !== value.operationId)
        await tx.objectStore('wallpaperLibrary').delete(`applied:${old.operationId}`)
    }
    // 新日志与资源替换、旧临时文件回收一起提交，中断时保留完整的旧计划。
    await Promise.all([
      ...resources.map(([key, blob]) => store.put(blob, key)),
      store.put(record, PENDING_APPLY_KEY),
    ])
    await tx.done
  } catch (error) {
    try {
      tx.abort()
    } catch {
      /* 事务可能已因存储错误自动中止。 */
    }
    await tx.done.catch(() => undefined)
    throw error
  }
}

export function clearPendingApply(): Promise<void> {
  return idbDelete('webdavSync', PENDING_APPLY_KEY)
}

export function getStoredConflict(): Promise<StoredSyncConflictV1 | undefined> {
  return readWorking<StoredSyncConflictV1>(CONFLICT_KEY)
}

export function setStoredConflict(value: StoredSyncConflictV1): Promise<void> {
  return writeWorking(CONFLICT_KEY, value)
}

export function clearStoredConflict(): Promise<void> {
  return idbDelete('webdavSync', CONFLICT_KEY)
}

function canonicalState(value: unknown): string | undefined {
  return JSON.stringify(value)
}
