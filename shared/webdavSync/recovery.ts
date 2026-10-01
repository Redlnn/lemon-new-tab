import { SYNC_SCOPE_KEYS } from './domains.ts'
import { pruneExpiredTombstones } from './lifecycle.ts'
import type { StoredSyncConflictV1 } from './localState.ts'
import { mergeSyncSnapshots } from './merge.ts'
import { decodeSyncSnapshot } from './snapshotCodec.ts'
import type { SyncSnapshotV1, TombstoneV1 } from './types.ts'
import { requireSupportedSource, type SyncSource } from './version.ts'

export interface WorkingRecord<T> {
  source: SyncSource
  value: T
}

const SNAPSHOT_MEMBERS = [
  'snapshot',
  'localBefore',
  'expectedLocal',
  'base',
  'deviceLocal',
  'local',
  'remote',
] as const
const RECORD_MEMBERS = new Set([
  ...SNAPSHOT_MEMBERS,
  'version',
  'origin',
  'operationId',
  'revisionId',
  'snapshotHash',
  'scope',
  'phase',
  'wallpaperSignature',
  'uiPreferencesApplied',
  'wallpapers',
  'tombstones',
  'conflicts',
  'remoteRevisionIds',
  'remoteBranchConflicts',
  'remainingRemoteRevisionIds',
  'stage',
  'remoteVersions',
])

/** 工作日志与历史分开：工作副本升级后移除废弃字段，操作身份及原始哈希保持不变。 */
export function decodeWorkingRecord<T extends object>(
  record: WorkingRecord<T>,
  pluginVersion: string,
): T {
  requireSupportedSource(record.source, pluginVersion)
  const value = Object.fromEntries(
    Object.entries(record.value)
      .filter(([key]) => RECORD_MEMBERS.has(key))
      .map(([key, item]) => [key, structuredClone(item)]),
  ) as T
  const members = value as Record<string, unknown>
  for (const key of SNAPSHOT_MEMBERS) {
    if (members[key])
      members[key] = decodeSyncSnapshot(
        members[key] as SyncSnapshotV1,
        record.source,
        pluginVersion,
      )
  }
  if (members.scope)
    members.scope = Object.fromEntries(
      SYNC_SCOPE_KEYS.map((key) => [key, (members.scope as SyncSnapshotV1['scope'])[key]]),
    )
  if (members.tombstones)
    members.tombstones = pruneExpiredTombstones(members.tombstones as TombstoneV1[])
  if (members.wallpapers)
    members.wallpapers = Object.fromEntries(
      Object.entries(members.wallpapers).map(([key, item]) => [
        key,
        Object.fromEntries(
          ['variant', 'itemId', 'assetId', 'mimeType', 'sha256', 'size', 'temporaryKey'].map(
            (field) => [field, (item as Record<string, unknown>)[field]],
          ),
        ),
      ]),
    )
  if (members.remoteVersions)
    members.remoteVersions = (
      members.remoteVersions as NonNullable<StoredSyncConflictV1['remoteVersions']>
    ).map(({ revisionId, deviceName, modifiedAt }) => ({ revisionId, deviceName, modifiedAt }))
  if (members.stage === 'local-remote') {
    const conflict = value as unknown as StoredSyncConflictV1
    conflict.conflicts = mergeSyncSnapshots(
      conflict.base,
      conflict.local,
      conflict.remote,
      conflict.tombstones,
    ).conflicts
  }
  return value
}
