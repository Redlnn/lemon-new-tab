import { createSyncConflictDisplayContext } from './conflictPresentation.ts'
import { mergeSyncSnapshots } from './merge.ts'
import type { SyncConflict, SyncSnapshotV1, TombstoneV1 } from './types.ts'

interface StoredSyncConflictDetailsSource {
  base: SyncSnapshotV1
  conflicts: SyncConflict[]
  local: SyncSnapshotV1
  remote: SyncSnapshotV1
  tombstones?: TombstoneV1[]
  remoteBranchConflicts?: SyncConflict[]
  remoteRevisionIds: string[]
  remoteVersions?: Array<{
    revisionId: string
    deviceName: string
    modifiedAt: string
  }>
}

export function createSyncConflictDetails(stored: StoredSyncConflictDetailsSource) {
  return {
    conflicts:
      stored.remoteBranchConflicts ??
      mergeSyncSnapshots(stored.base, stored.local, stored.remote, stored.tombstones).conflicts,
    hasEmptyBase: hasEmptyBase(stored.base),
    remoteRevisionIds: stored.remoteRevisionIds,
    remoteVersions: stored.remoteVersions ?? [],
    context: createSyncConflictDisplayContext([stored.base, stored.local, stored.remote]),
  }
}

function hasEmptyBase(snapshot: SyncSnapshotV1): boolean {
  return !(
    snapshot.settings ||
    snapshot.quickLinks ||
    snapshot.notes ||
    snapshot.customSearchEngines ||
    snapshot.ui ||
    snapshot.optional ||
    snapshot.inlineImages
  )
}
