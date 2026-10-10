import type {
  BrowserWebDavSetupInput,
  BrowserWebDavSetupPreview,
  BrowserSyncHistoryPreview,
} from './browserEngine.ts'
import { SYNC_SCOPE_KEYS } from './domains.ts'
import type { LocalSyncStateV1, SyncConflictResolution } from './types.ts'

export type WebDavSyncMessage =
  | {
      type: 'webdav-sync:connect'
      input: BrowserWebDavSetupInput
      expected: Pick<
        BrowserWebDavSetupPreview,
        'generationId' | 'headRevisionIds' | 'localSnapshotHash' | 'state' | 'vaultId'
      >
    }
  | { type: 'webdav-sync:data-changed' }
  | {
      type: 'webdav-sync:disconnect'
      deleteRemote: boolean
      confirmationText?: string
      deleteDirectory?: boolean
    }
  | { type: 'webdav-sync:inspect-corruption' }
  | {
      type: 'webdav-sync:download-corruption'
      actualPayloadHash: string
      revisionId: string
    }
  | {
      type: 'webdav-sync:delete-corruption'
      actualPayloadHash?: string
      revisionId: string
    }
  | { type: 'webdav-sync:get-state' }
  | { type: 'webdav-sync:get-conflict' }
  | { type: 'webdav-sync:immediate' }
  | { type: 'webdav-sync:list-history' }
  | { type: 'webdav-sync:preview-history'; revisionId: string }
  | { type: 'webdav-sync:list-devices' }
  | { type: 'webdav-sync:remove-remote-wallpapers' }
  | { type: 'webdav-sync:natural' }
  | { type: 'webdav-sync:online' }
  | { type: 'webdav-sync:preview-connection'; input: BrowserWebDavSetupInput }
  | { type: 'webdav-sync:resume-apply' }
  | { type: 'webdav-sync:resolve-conflict'; resolutions: SyncConflictResolution[] }
  | {
      type: 'webdav-sync:restore-history'
      revisionId: string
      expected: Pick<BrowserSyncHistoryPreview, 'currentSnapshotHash' | 'headRevisionId'>
    }
  | {
      type: 'webdav-sync:repair-corruption'
      actualPayloadHash?: string
      choice?: 'local' | 'previous'
      downloaded: boolean
      revisionId: string
    }
  | {
      type: 'webdav-sync:update-preferences'
      enabled?: boolean
      scope?: Partial<LocalSyncStateV1['scope']>
    }
  | { type: 'webdav-sync:unlock-encryption'; password: string }
  | {
      type: 'webdav-sync:update-credentials'
      username?: string
      password: string
      rememberPassword: boolean
    }

type MessageRecord = Record<string, unknown>
const record = (value: unknown): value is MessageRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const string = (value: unknown): value is string => typeof value === 'string'
const optionalString = (value: unknown) => value === undefined || string(value)
const optionalBoolean = (value: unknown) => value === undefined || typeof value === 'boolean'
const scope = (value: unknown) =>
  value === undefined ||
  (record(value) &&
    Object.entries(value).every(
      ([key, item]) =>
        (SYNC_SCOPE_KEYS as readonly string[]).includes(key) && typeof item === 'boolean',
    ))
const setup = (value: unknown) =>
  record(value) &&
  record(value.connection) &&
  ['baseUrl', 'username', 'password'].every((key) =>
    string(value.connection && (value.connection as MessageRecord)[key]),
  ) &&
  (value.connection.insecureHttpApproval === undefined ||
    value.connection.insecureHttpApproval === 'local-warning') &&
  optionalString(value.directory) &&
  typeof value.rememberPassword === 'boolean' &&
  optionalString(value.deviceName) &&
  optionalString(value.encryptionPassword) &&
  scope(value.scope)
const preview = (value: unknown) =>
  record(value) &&
  ['empty', 'existing', 'remote-conflict'].includes(String(value.state)) &&
  optionalString(value.vaultId) &&
  optionalString(value.generationId) &&
  string(value.localSnapshotHash) &&
  Array.isArray(value.headRevisionIds) &&
  value.headRevisionIds.every(string)
const resolution = (value: unknown) =>
  record(value) &&
  string(value.conflictId) &&
  (value.choice === 'local' ||
    value.choice === 'remote' ||
    (value.choice === 'both' && string(value.duplicateId)) ||
    (value.choice === 'candidate' && string(value.candidateId)))
const empty = () => true
const validators: Record<WebDavSyncMessage['type'], (value: MessageRecord) => boolean> = {
  'webdav-sync:connect': (m) => setup(m.input) && preview(m.expected),
  'webdav-sync:preview-connection': (m) => setup(m.input),
  'webdav-sync:disconnect': (m) =>
    typeof m.deleteRemote === 'boolean' &&
    optionalString(m.confirmationText) &&
    optionalBoolean(m.deleteDirectory),
  'webdav-sync:download-corruption': (m) => string(m.actualPayloadHash) && string(m.revisionId),
  'webdav-sync:delete-corruption': (m) =>
    optionalString(m.actualPayloadHash) && string(m.revisionId),
  'webdav-sync:repair-corruption': (m) =>
    optionalString(m.actualPayloadHash) &&
    string(m.revisionId) &&
    typeof m.downloaded === 'boolean' &&
    (m.choice === undefined || m.choice === 'local' || m.choice === 'previous'),
  'webdav-sync:unlock-encryption': (m) => string(m.password),
  'webdav-sync:update-credentials': (m) =>
    optionalString(m.username) && string(m.password) && typeof m.rememberPassword === 'boolean',
  'webdav-sync:resolve-conflict': (m) =>
    Array.isArray(m.resolutions) && m.resolutions.every(resolution),
  'webdav-sync:preview-history': (m) => string(m.revisionId),
  'webdav-sync:restore-history': (m) =>
    string(m.revisionId) &&
    record(m.expected) &&
    string(m.expected.currentSnapshotHash) &&
    string(m.expected.headRevisionId),
  'webdav-sync:update-preferences': (m) => optionalBoolean(m.enabled) && scope(m.scope),
  'webdav-sync:data-changed': empty,
  'webdav-sync:get-state': empty,
  'webdav-sync:get-conflict': empty,
  'webdav-sync:immediate': empty,
  'webdav-sync:inspect-corruption': empty,
  'webdav-sync:list-history': empty,
  'webdav-sync:list-devices': empty,
  'webdav-sync:remove-remote-wallpapers': empty,
  'webdav-sync:natural': empty,
  'webdav-sync:online': empty,
  'webdav-sync:resume-apply': empty,
}

export function isWebDavSyncMessage(value: unknown): value is WebDavSyncMessage {
  return (
    record(value) &&
    string(value.type) &&
    Object.hasOwn(validators, value.type) &&
    validators[value.type as WebDavSyncMessage['type']](value)
  )
}
