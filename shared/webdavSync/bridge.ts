import { browser } from 'wxt/browser'

import { sha256Hex } from '../json.ts'

import type {
  BrowserWebDavSetupInput,
  BrowserWebDavSetupPreview,
  BrowserSyncHistoryEntry,
  BrowserSyncHistoryPreview,
  BrowserSyncDeviceEntry,
} from './browserEngine.ts'
import type { BrowserCorruptionInspection } from './browserManagement.ts'
import type { SyncConflictDisplayContext } from './conflictPresentation.ts'
import { base64ToBytes } from './crypto.ts'
import { deserializeWebDavError, WebDavError, type SerializedWebDavError } from './errors.ts'
import type { WebDavSyncMessage } from './messages.ts'
import type { LocalSyncStateV1, SyncConflict, SyncConflictResolution } from './types.ts'
import { parseLocalSyncState } from './validation.ts'

export interface BrowserSyncConflictDetails {
  conflicts: SyncConflict[]
  hasEmptyBase: boolean
  remoteRevisionIds: string[]
  remoteVersions: Array<{
    revisionId: string
    deviceName: string
    modifiedAt: string
  }>
  context: SyncConflictDisplayContext
}

async function sendMessage<T>(message: WebDavSyncMessage): Promise<T> {
  const result: { ok: true; value: T } | { ok: false; error: SerializedWebDavError } =
    await browser.runtime.sendMessage(message)
  if (!result.ok) throw deserializeWebDavError(result.error)
  return result.value
}

async function sendStateMessage(message: WebDavSyncMessage): Promise<LocalSyncStateV1> {
  return parseLocalSyncState(await sendMessage(message))
}

export function syncNow(): Promise<LocalSyncStateV1> {
  return sendStateMessage({ type: 'webdav-sync:immediate' })
}

export function getSyncState(): Promise<LocalSyncStateV1> {
  return sendStateMessage({ type: 'webdav-sync:get-state' })
}

export function inspectSyncCorruption(): Promise<BrowserCorruptionInspection> {
  return sendMessage({
    type: 'webdav-sync:inspect-corruption',
  } satisfies WebDavSyncMessage)
}

export async function downloadSyncCorruption(
  revisionId: string,
  actualPayloadHash: string,
  payloadSize: number,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; filename: string }> {
  const result: { base64: string; filename: string } = await sendMessage({
    type: 'webdav-sync:download-corruption',
    revisionId,
    actualPayloadHash,
  } satisfies WebDavSyncMessage)
  const bytes = base64ToBytes(result.base64)
  if (bytes.byteLength !== payloadSize || (await sha256Hex(bytes)) !== actualPayloadHash) {
    throw new WebDavError('corrupted', 'Downloaded backup failed integrity validation')
  }
  return { bytes, filename: result.filename }
}

export function repairSyncCorruption(input: {
  actualPayloadHash?: string
  choice?: 'local' | 'previous'
  downloaded: boolean
  revisionId: string
}): Promise<LocalSyncStateV1> {
  return sendStateMessage({
    type: 'webdav-sync:repair-corruption',
    ...input,
  } satisfies WebDavSyncMessage)
}

export function deleteSyncCorruption(
  revisionId: string,
  actualPayloadHash?: string,
): Promise<LocalSyncStateV1> {
  return sendStateMessage({
    type: 'webdav-sync:delete-corruption',
    revisionId,
    actualPayloadHash,
  } satisfies WebDavSyncMessage)
}

export function disconnectSyncConnection(
  deleteRemote: boolean,
  confirmationText?: string,
): Promise<LocalSyncStateV1> {
  return sendStateMessage({
    type: 'webdav-sync:disconnect',
    deleteRemote,
    confirmationText,
  } satisfies WebDavSyncMessage)
}

export function previewSyncConnection(
  input: BrowserWebDavSetupInput,
): Promise<BrowserWebDavSetupPreview> {
  return sendMessage({ type: 'webdav-sync:preview-connection', input })
}

export function connectSyncConnection(
  input: BrowserWebDavSetupInput,
  expected: Pick<
    BrowserWebDavSetupPreview,
    'generationId' | 'headRevisionIds' | 'localSnapshotHash' | 'state' | 'vaultId'
  >,
): Promise<LocalSyncStateV1> {
  return sendStateMessage({
    type: 'webdav-sync:connect',
    input,
    expected,
  } satisfies WebDavSyncMessage)
}

export function getSyncConflict(): Promise<BrowserSyncConflictDetails | null> {
  return sendMessage({
    type: 'webdav-sync:get-conflict',
  } satisfies WebDavSyncMessage)
}

export function getSyncHistory(): Promise<BrowserSyncHistoryEntry[]> {
  return sendMessage({
    type: 'webdav-sync:list-history',
  } satisfies WebDavSyncMessage)
}

export function getSyncDevices(): Promise<BrowserSyncDeviceEntry[]> {
  return sendMessage({
    type: 'webdav-sync:list-devices',
  } satisfies WebDavSyncMessage)
}

export function removeRemoteSyncWallpapers(): Promise<LocalSyncStateV1> {
  return sendStateMessage({ type: 'webdav-sync:remove-remote-wallpapers' })
}

export function previewSyncHistory(revisionId: string): Promise<BrowserSyncHistoryPreview> {
  return sendMessage({
    type: 'webdav-sync:preview-history',
    revisionId,
  } satisfies WebDavSyncMessage)
}

export function restoreSyncHistory(
  preview: Pick<BrowserSyncHistoryPreview, 'currentSnapshotHash' | 'headRevisionId' | 'revisionId'>,
): Promise<LocalSyncStateV1> {
  return sendStateMessage({
    type: 'webdav-sync:restore-history',
    revisionId: preview.revisionId,
    expected: {
      currentSnapshotHash: preview.currentSnapshotHash,
      headRevisionId: preview.headRevisionId,
    },
  } satisfies WebDavSyncMessage)
}

export function updateSyncPreferences(input: {
  enabled?: boolean
  scope?: Partial<LocalSyncStateV1['scope']>
}): Promise<LocalSyncStateV1> {
  return sendStateMessage({
    type: 'webdav-sync:update-preferences',
    ...input,
  } satisfies WebDavSyncMessage)
}

export function updateSyncCredentials(input: {
  username?: string
  password: string
  rememberPassword: boolean
}): Promise<LocalSyncStateV1> {
  return sendStateMessage({ type: 'webdav-sync:update-credentials', ...input })
}

export function resolveSyncConflict(
  resolutions: SyncConflictResolution[],
): Promise<LocalSyncStateV1> {
  return sendStateMessage({
    type: 'webdav-sync:resolve-conflict',
    resolutions,
  } satisfies WebDavSyncMessage)
}

export function unlockSyncEncryption(password: string): Promise<LocalSyncStateV1> {
  return sendStateMessage({
    type: 'webdav-sync:unlock-encryption',
    password,
  } satisfies WebDavSyncMessage)
}
