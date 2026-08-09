import { browser } from 'wxt/browser'

import type {
  LocalSyncStateV1,
  SyncConflict,
  SyncConflictResolution,
  SyncSnapshotV1,
} from './types.ts'
import type {
  BrowserWebDavSetupInput,
  BrowserWebDavSetupPreview,
  BrowserSyncHistoryEntry,
  BrowserSyncDeviceEntry,
  BrowserCorruptionInspection,
} from './browserEngine.ts'

export interface BrowserSyncConflictDetails {
  conflicts: SyncConflict[]
  remoteRevisionIds: string[]
}

export type WebDavSyncMessage =
  | { type: 'webdav-sync:commit-compressed-wallpaper'; blob: Blob; variant: 'dark' | 'light' }
  | {
      type: 'webdav-sync:connect'
      input: BrowserWebDavSetupInput
      expected: Pick<
        BrowserWebDavSetupPreview,
        'generationId' | 'headRevisionIds' | 'state' | 'vaultId'
      >
    }
  | { type: 'webdav-sync:data-changed' }
  | { type: 'webdav-sync:disconnect'; deleteRemote: boolean; confirmationText?: string }
  | { type: 'webdav-sync:inspect-corruption' }
  | {
      type: 'webdav-sync:download-corruption'
      actualPayloadHash: string
      revisionId: string
    }
  | { type: 'webdav-sync:get-state' }
  | { type: 'webdav-sync:get-conflict' }
  | { type: 'webdav-sync:immediate' }
  | { type: 'webdav-sync:list-history' }
  | { type: 'webdav-sync:list-devices' }
  | { type: 'webdav-sync:natural' }
  | { type: 'webdav-sync:online' }
  | { type: 'webdav-sync:preview-connection'; input: BrowserWebDavSetupInput }
  | { type: 'webdav-sync:resume-apply' }
  | { type: 'webdav-sync:resolve-conflict'; resolutions: SyncConflictResolution[] }
  | { type: 'webdav-sync:reset'; encryptionPassword?: string; snapshot: SyncSnapshotV1 }
  | { type: 'webdav-sync:accept-reset'; encryptionPassword?: string; mode: 'apply' | 'merge' }
  | { type: 'webdav-sync:restore-history'; revisionId: string }
  | {
      type: 'webdav-sync:repair-corruption'
      actualPayloadHash: string
      choice?: 'local' | 'previous'
      downloaded: boolean
      revisionId: string
    }
  | { type: 'webdav-sync:stop-wallpapers' }
  | {
      type: 'webdav-sync:update-preferences'
      historyLimit?: number
      scope?: Partial<LocalSyncStateV1['scope']>
    }
  | { type: 'webdav-sync:migrate-encryption'; newPassword: string; oldPassword?: string }
  | { type: 'webdav-sync:unlock-encryption'; password: string }

export function sendSyncDataChanged(): void {
  void browser.runtime
    .sendMessage({ type: 'webdav-sync:data-changed' } satisfies WebDavSyncMessage)
    .catch(() => undefined)
}

export function syncNow(): Promise<LocalSyncStateV1> {
  return browser.runtime.sendMessage({ type: 'webdav-sync:immediate' } satisfies WebDavSyncMessage)
}

export function getSyncState(): Promise<LocalSyncStateV1> {
  return browser.runtime.sendMessage({ type: 'webdav-sync:get-state' } satisfies WebDavSyncMessage)
}

export function commitCompressedSyncWallpaper(
  variant: 'dark' | 'light',
  blob: Blob,
): Promise<LocalSyncStateV1> {
  return browser.runtime.sendMessage({
    type: 'webdav-sync:commit-compressed-wallpaper',
    variant,
    blob,
  } satisfies WebDavSyncMessage)
}

export function inspectSyncCorruption(): Promise<BrowserCorruptionInspection> {
  return browser.runtime.sendMessage({ type: 'webdav-sync:inspect-corruption' } satisfies WebDavSyncMessage)
}

export function downloadSyncCorruption(
  revisionId: string,
  actualPayloadHash: string,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; filename: string }> {
  return browser.runtime.sendMessage({
    type: 'webdav-sync:download-corruption',
    revisionId,
    actualPayloadHash,
  } satisfies WebDavSyncMessage)
}

export function repairSyncCorruption(input: {
  actualPayloadHash: string
  choice?: 'local' | 'previous'
  downloaded: boolean
  revisionId: string
}): Promise<LocalSyncStateV1> {
  return browser.runtime.sendMessage({
    type: 'webdav-sync:repair-corruption',
    ...input,
  } satisfies WebDavSyncMessage)
}

export function disconnectSyncConnection(
  deleteRemote: boolean,
  confirmationText?: string,
): Promise<LocalSyncStateV1> {
  return browser.runtime.sendMessage({
    type: 'webdav-sync:disconnect',
    deleteRemote,
    confirmationText,
  } satisfies WebDavSyncMessage)
}

export function previewSyncConnection(
  input: BrowserWebDavSetupInput,
): Promise<BrowserWebDavSetupPreview> {
  return browser.runtime.sendMessage({
    type: 'webdav-sync:preview-connection',
    input,
  } satisfies WebDavSyncMessage)
}

export function connectSyncConnection(
  input: BrowserWebDavSetupInput,
  expected: Pick<
    BrowserWebDavSetupPreview,
    'generationId' | 'headRevisionIds' | 'state' | 'vaultId'
  >,
): Promise<LocalSyncStateV1> {
  return browser.runtime.sendMessage({
    type: 'webdav-sync:connect',
    input,
    expected,
  } satisfies WebDavSyncMessage)
}

export function getSyncConflict(): Promise<BrowserSyncConflictDetails | null> {
  return browser.runtime.sendMessage({ type: 'webdav-sync:get-conflict' } satisfies WebDavSyncMessage)
}

export function getSyncHistory(): Promise<BrowserSyncHistoryEntry[]> {
  return browser.runtime.sendMessage({ type: 'webdav-sync:list-history' } satisfies WebDavSyncMessage)
}

export function getSyncDevices(): Promise<BrowserSyncDeviceEntry[]> {
  return browser.runtime.sendMessage({ type: 'webdav-sync:list-devices' } satisfies WebDavSyncMessage)
}

export function restoreSyncHistory(revisionId: string): Promise<LocalSyncStateV1> {
  return browser.runtime.sendMessage({
    type: 'webdav-sync:restore-history',
    revisionId,
  } satisfies WebDavSyncMessage)
}

export function stopAndDeleteSyncedWallpapers(): Promise<LocalSyncStateV1> {
  return browser.runtime.sendMessage({ type: 'webdav-sync:stop-wallpapers' } satisfies WebDavSyncMessage)
}

export function updateSyncPreferences(input: {
  historyLimit?: number
  scope?: Partial<LocalSyncStateV1['scope']>
}): Promise<LocalSyncStateV1> {
  return browser.runtime.sendMessage({
    type: 'webdav-sync:update-preferences',
    ...input,
  } satisfies WebDavSyncMessage)
}

export function resolveSyncConflict(
  resolutions: SyncConflictResolution[],
): Promise<LocalSyncStateV1> {
  return browser.runtime.sendMessage({
    type: 'webdav-sync:resolve-conflict',
    resolutions,
  } satisfies WebDavSyncMessage)
}

export function resetSyncedData(
  snapshot: SyncSnapshotV1,
  encryptionPassword?: string,
): Promise<LocalSyncStateV1> {
  return browser.runtime.sendMessage({
    type: 'webdav-sync:reset',
    snapshot,
    encryptionPassword,
  } satisfies WebDavSyncMessage)
}

export function acceptRemoteSyncReset(
  mode: 'apply' | 'merge',
  encryptionPassword?: string,
): Promise<LocalSyncStateV1> {
  return browser.runtime.sendMessage({
    type: 'webdav-sync:accept-reset',
    mode,
    encryptionPassword,
  } satisfies WebDavSyncMessage)
}

export function unlockSyncEncryption(password: string): Promise<LocalSyncStateV1> {
  return browser.runtime.sendMessage({
    type: 'webdav-sync:unlock-encryption',
    password,
  } satisfies WebDavSyncMessage)
}

export function migrateSyncEncryption(
  newPassword: string,
  oldPassword?: string,
): Promise<LocalSyncStateV1> {
  return browser.runtime.sendMessage({
    type: 'webdav-sync:migrate-encryption',
    newPassword,
    oldPassword,
  } satisfies WebDavSyncMessage)
}

export async function prepareSyncBeforeNewTabStartup(): Promise<void> {
  const stored = await browser.storage.local.get('webdavSyncState')
  const state = stored.webdavSyncState as LocalSyncStateV1 | undefined
  if (state?.pending?.phase === 'applying-local') {
    await browser.runtime.sendMessage({ type: 'webdav-sync:resume-apply' } satisfies WebDavSyncMessage)
  }
  void browser.runtime
    .sendMessage({ type: 'webdav-sync:natural' } satisfies WebDavSyncMessage)
    .catch(() => undefined)
}

export function setupOnlineSyncTrigger(): () => void {
  const listener = () => {
    void browser.runtime
      .sendMessage({ type: 'webdav-sync:online' } satisfies WebDavSyncMessage)
      .catch(() => undefined)
  }
  window.addEventListener('online', listener)
  return () => window.removeEventListener('online', listener)
}

export function isWebDavSyncMessage(value: unknown): value is WebDavSyncMessage {
  if (!value || typeof value !== 'object') return false
  const type = (value as { type?: unknown }).type
  if (type === 'webdav-sync:commit-compressed-wallpaper') {
    const message = value as { blob?: unknown; variant?: unknown }
    return message.blob instanceof Blob && (message.variant === 'dark' || message.variant === 'light')
  }
  if (type === 'webdav-sync:preview-connection') {
    return Boolean((value as { input?: unknown }).input)
  }
  if (type === 'webdav-sync:connect') {
    const message = value as { expected?: unknown; input?: unknown }
    return Boolean(message.input && message.expected)
  }
  if (type === 'webdav-sync:disconnect') {
    const message = value as { confirmationText?: unknown; deleteRemote?: unknown }
    return (
      typeof message.deleteRemote === 'boolean' &&
      (message.confirmationText === undefined || typeof message.confirmationText === 'string')
    )
  }
  if (type === 'webdav-sync:download-corruption') {
    const message = value as { actualPayloadHash?: unknown; revisionId?: unknown }
    return typeof message.actualPayloadHash === 'string' && typeof message.revisionId === 'string'
  }
  if (type === 'webdav-sync:repair-corruption') {
    const message = value as {
      actualPayloadHash?: unknown
      choice?: unknown
      downloaded?: unknown
      revisionId?: unknown
    }
    return (
      typeof message.actualPayloadHash === 'string' &&
      (message.choice === undefined || message.choice === 'local' || message.choice === 'previous') &&
      typeof message.downloaded === 'boolean' &&
      typeof message.revisionId === 'string'
    )
  }
  if (type === 'webdav-sync:unlock-encryption') {
    return typeof (value as { password?: unknown }).password === 'string'
  }
  if (type === 'webdav-sync:migrate-encryption') {
    const message = value as { newPassword?: unknown; oldPassword?: unknown }
    return (
      typeof message.newPassword === 'string' &&
      (message.oldPassword === undefined || typeof message.oldPassword === 'string')
    )
  }
  if (type === 'webdav-sync:resolve-conflict') {
    return Array.isArray((value as { resolutions?: unknown }).resolutions)
  }
  if (type === 'webdav-sync:restore-history') {
    return typeof (value as { revisionId?: unknown }).revisionId === 'string'
  }
  if (type === 'webdav-sync:reset') {
    const message = value as { encryptionPassword?: unknown; snapshot?: unknown }
    return Boolean(
      message.snapshot &&
      (message.encryptionPassword === undefined || typeof message.encryptionPassword === 'string'),
    )
  }
  if (type === 'webdav-sync:accept-reset') {
    const message = value as { encryptionPassword?: unknown; mode?: unknown }
    return (
      (message.mode === 'apply' || message.mode === 'merge') &&
      (message.encryptionPassword === undefined || typeof message.encryptionPassword === 'string')
    )
  }
  if (type === 'webdav-sync:update-preferences') return true
  return (
    type === 'webdav-sync:data-changed' ||
    type === 'webdav-sync:get-state' ||
    type === 'webdav-sync:get-conflict' ||
    type === 'webdav-sync:immediate' ||
    type === 'webdav-sync:inspect-corruption' ||
    type === 'webdav-sync:list-history' ||
    type === 'webdav-sync:list-devices' ||
    type === 'webdav-sync:natural' ||
    type === 'webdav-sync:online' ||
    type === 'webdav-sync:resume-apply' ||
    type === 'webdav-sync:stop-wallpapers'
  )
}
