import { jsonEquals } from './canonical.ts'
import { resolveSyncConflicts } from './conflicts.ts'
import { mergeSyncSnapshots } from './merge.ts'
import { normalizeRemoteSyncSettings } from './settingsWhitelist.ts'
import type {
  AssetReferenceV1,
  SyncConflict,
  SyncConflictResolution,
  SyncRevisionV1,
  SyncSnapshotV1,
  TombstoneV1,
} from './types.ts'

export interface RemoteSyncState {
  headRevisionIds: string[]
  snapshot: SyncSnapshotV1
  tombstones: TombstoneV1[]
  assets: AssetReferenceV1[]
}

export type RemoteBuildResult =
  | {
      kind: 'conflict'
      conflicts: SyncConflict[]
      headRevisionIds: string[]
      local: SyncSnapshotV1
      remote: SyncSnapshotV1
      remainingRemoteRevisionIds: string[]
    }
  | { kind: 'ready'; state: RemoteSyncState }

export type SyncDecision =
  | { action: 'apply-remote'; remote: RemoteSyncState; revisionId: string }
  | {
      action: 'conflict'
      base: SyncSnapshotV1
      deviceLocal: SyncSnapshotV1
      local: SyncSnapshotV1
      remote: SyncSnapshotV1
      remoteRevisionIds: string[]
      remainingRemoteRevisionIds: string[]
      conflicts: SyncConflict[]
      stage: 'local-remote' | 'remote-branches'
    }
  | {
      action: 'publish'
      parents: string[]
      snapshot: SyncSnapshotV1
      reason: 'local-change' | 'merge'
      tombstones: TombstoneV1[]
      assets: AssetReferenceV1[]
    }
  | { action: 'up-to-date'; revisionId: string; snapshot: SyncSnapshotV1 }
  | { action: 'unknown-ancestor'; remoteRevisionIds: string[] }

export function findRevisionHeads(revisions: readonly SyncRevisionV1[]): SyncRevisionV1[] {
  const byId = new Map(revisions.map((revision) => [revision.revisionId, revision]))
  if (byId.size !== revisions.length) throw new Error('Duplicate remote revision ID')
  const parents = new Set(revisions.flatMap((revision) => revision.parentRevisionIds))
  return revisions
    .filter((revision) => !parents.has(revision.revisionId))
    .sort((left, right) => left.revisionId.localeCompare(right.revisionId))
}

function descendsFrom(
  revisionId: string,
  baseRevisionId: string,
  byId: ReadonlyMap<string, SyncRevisionV1>,
  visited = new Set<string>(),
): boolean {
  if (revisionId === baseRevisionId) return true
  if (visited.has(revisionId)) return false
  visited.add(revisionId)
  const revision = byId.get(revisionId)
  return Boolean(
    revision?.parentRevisionIds.some(
      (parentId) =>
        parentId === baseRevisionId || descendsFrom(parentId, baseRevisionId, byId, visited),
    ),
  )
}

function buildRemoteState(
  baseRevisionId: string,
  baseline: SyncSnapshotV1,
  revisions: readonly SyncRevisionV1[],
): RemoteBuildResult | undefined {
  const heads = findRevisionHeads(revisions)
  if (heads.length === 0) return undefined
  const byId = new Map(revisions.map((revision) => [revision.revisionId, revision]))
  if (heads.some((head) => !descendsFrom(head.revisionId, baseRevisionId, byId))) return undefined

  return mergeRemoteRevisionHeads(baseline, revisions)
}

export function mergeRemoteRevisionHeads(
  baseline: SyncSnapshotV1,
  revisions: readonly SyncRevisionV1[],
): RemoteBuildResult | undefined {
  const heads = findRevisionHeads(revisions)
  if (heads.length === 0) return undefined

  let snapshot = baseline
  const tombstones = new Map<string, TombstoneV1>()
  const assets = new Map<string, AssetReferenceV1>()
  for (const [index, head] of heads.entries()) {
    const headSnapshot = structuredClone(head.snapshot)
    if (baseline.settings || headSnapshot.settings) {
      headSnapshot.settings = normalizeRemoteSyncSettings(
        baseline.settings ?? {},
        headSnapshot.settings ?? {},
      )
    }
    const merge = mergeSyncSnapshots(baseline, snapshot, headSnapshot)
    if (merge.conflicts.length > 0) {
      return {
        kind: 'conflict',
        conflicts: merge.conflicts,
        headRevisionIds: heads.map((item) => item.revisionId),
        local: snapshot,
        remote: headSnapshot,
        remainingRemoteRevisionIds: heads.slice(index + 1).map((item) => item.revisionId),
      }
    }
    snapshot = merge.snapshot
    for (const item of head.tombstones) tombstones.set(`${item.entityType}\0${item.entityId}`, item)
    for (const item of head.assets) assets.set(item.id, item)
  }
  return {
    kind: 'ready',
    state: {
      headRevisionIds: heads.map((head) => head.revisionId),
      snapshot,
      tombstones: [...tombstones.values()],
      assets: [...assets.values()],
    },
  }
}

export const LOCAL_CONFLICT_CANDIDATE_ID = 'local'

interface MultiDeviceConflictInput {
  deviceName: string
  snapshot: SyncSnapshotV1
}

export function collectRemoteBranchConflicts(
  baseline: SyncSnapshotV1,
  revisions: readonly SyncRevisionV1[],
  local: MultiDeviceConflictInput,
): SyncConflict[] {
  const heads = findRevisionHeads(revisions)
  const conflicts = new Map<string, SyncConflict>()
  for (const [index, local] of heads.entries()) {
    for (const remote of heads.slice(index + 1)) {
      for (const conflict of mergeSyncSnapshots(baseline, local.snapshot, remote.snapshot).conflicts) {
        const current = conflicts.get(conflict.id) ?? {
          ...conflict,
          candidates: [],
        }
        addRevisionConflictCandidate(current, local, conflict, 'local')
        addRevisionConflictCandidate(current, remote, conflict, 'remote')
        conflicts.set(conflict.id, current)
      }
    }
  }

  for (const remote of heads) {
    for (const conflict of mergeSyncSnapshots(baseline, local.snapshot, remote.snapshot).conflicts) {
      const current = conflicts.get(conflict.id) ?? { ...conflict, candidates: [] }
      addLocalConflictCandidate(current, local, conflict)
      addRevisionConflictCandidate(current, remote, conflict, 'remote')
      conflicts.set(conflict.id, current)
    }
  }
  for (const conflict of conflicts.values()) {
    if (!conflict.candidates?.some((candidate) => candidate.source === 'local')) {
      addLocalConflictCandidate(conflict, local)
    }
  }
  return [...conflicts.values()]
}

export function resolveRemoteBranchConflicts(input: {
  baseline: SyncSnapshotV1
  revisions: readonly SyncRevisionV1[]
  local: MultiDeviceConflictInput
  resolutions: readonly SyncConflictResolution[]
}): SyncSnapshotV1 {
  const selections = new Map(
    input.resolutions.map((resolution) => [resolution.conflictId, resolution]),
  )
  const conflicts = collectRemoteBranchConflicts(input.baseline, input.revisions, input.local)
  if (selections.size !== input.resolutions.length || selections.size !== conflicts.length)
    throw new TypeError('Multi-device conflict resolution is invalid')
  for (const conflict of conflicts) {
    const selection = selections.get(conflict.id)
    if (
      !selection ||
      selection.choice !== 'candidate' ||
      !conflict.candidates?.some((candidate) => candidate.id === selection.candidateId)
    ) {
      throw new TypeError(`Multi-device conflict resolution is missing: ${conflict.id}`)
    }
  }
  let snapshot = input.local.snapshot
  for (const revision of findRevisionHeads(input.revisions)) {
    const merge = mergeSyncSnapshots(input.baseline, snapshot, revision.snapshot)
    if (merge.conflicts.length === 0) {
      snapshot = merge.snapshot
      continue
    }
    snapshot = resolveSyncConflicts({
      base: input.baseline,
      local: snapshot,
      remote: revision.snapshot,
      resolutions: merge.conflicts.map((conflict) => {
        const selection = selections.get(conflict.id)
        if (!selection || selection.choice !== 'candidate')
          throw new TypeError(`Multi-device conflict resolution is missing: ${conflict.id}`)
        return {
          conflictId: conflict.id,
          choice: selection.candidateId === revision.revisionId ? 'remote' : 'local',
        }
      }),
    })
  }
  return snapshot
}

function addRevisionConflictCandidate(
  conflict: SyncConflict,
  revision: SyncRevisionV1,
  sourceConflict: SyncConflict,
  side: 'local' | 'remote',
): void {
  const candidates = conflict.candidates ?? (conflict.candidates = [])
  if (candidates.some((candidate) => candidate.id === revision.revisionId)) return
  const value = sourceConflict[side]
  candidates.push({
    id: revision.revisionId,
    deviceName: revision.device.name,
    source: 'remote',
    ...(Object.hasOwn(sourceConflict, side) ? { value } : {}),
  })
}

function addLocalConflictCandidate(
  conflict: SyncConflict,
  local: MultiDeviceConflictInput,
  sourceConflict?: SyncConflict,
): void {
  const candidates = conflict.candidates ?? (conflict.candidates = [])
  if (candidates.some((candidate) => candidate.source === 'local')) return
  candidates.push({
    id: LOCAL_CONFLICT_CANDIDATE_ID,
    deviceName: local.deviceName,
    source: 'local',
    ...(sourceConflict && Object.hasOwn(sourceConflict, 'local')
      ? { value: sourceConflict.local }
      : Object.hasOwn(conflict, 'base')
        ? { value: conflict.base }
        : {}),
  })
}

export function decideSynchronization(input: {
  baseRevisionId: string
  baseline: SyncSnapshotV1
  local: SyncSnapshotV1
  revisions: readonly SyncRevisionV1[]
}): SyncDecision {
  const builtRemote = buildRemoteState(input.baseRevisionId, input.baseline, input.revisions)
  if (!builtRemote) {
    return {
      action: 'unknown-ancestor',
      remoteRevisionIds: findRevisionHeads(input.revisions).map((item) => item.revisionId),
    }
  }
  if (builtRemote.kind === 'conflict') {
    return {
      action: 'conflict',
      base: input.baseline,
      deviceLocal: input.local,
      local: builtRemote.local,
      remote: builtRemote.remote,
      remoteRevisionIds: builtRemote.headRevisionIds,
      remainingRemoteRevisionIds: builtRemote.remainingRemoteRevisionIds,
      conflicts: builtRemote.conflicts,
      stage: 'remote-branches',
    }
  }
  const remote = builtRemote.state

  const localChanged = !jsonEquals(input.local, input.baseline)
  const remoteChanged = !jsonEquals(remote.snapshot, input.baseline)
  const hasBranches = remote.headRevisionIds.length > 1
  if (!hasBranches && jsonEquals(input.local, remote.snapshot)) {
    return {
      action: 'up-to-date',
      revisionId: remote.headRevisionIds[0]!,
      snapshot: remote.snapshot,
    }
  }
  if (!localChanged && !hasBranches) {
    const revisionId = remote.headRevisionIds[0]!
    return remoteChanged
      ? { action: 'apply-remote', remote, revisionId }
      : { action: 'up-to-date', revisionId, snapshot: remote.snapshot }
  }

  const merge = mergeSyncSnapshots(input.baseline, input.local, remote.snapshot)
  if (merge.conflicts.length > 0) {
    return {
      action: 'conflict',
      base: input.baseline,
      deviceLocal: input.local,
      local: input.local,
      remote: remote.snapshot,
      remoteRevisionIds: remote.headRevisionIds,
      remainingRemoteRevisionIds: [],
      conflicts: merge.conflicts,
      stage: 'local-remote',
    }
  }
  return {
    action: 'publish',
    parents: remote.headRevisionIds,
    snapshot: merge.snapshot,
    reason: localChanged && !remoteChanged && !hasBranches ? 'local-change' : 'merge',
    tombstones: remote.tombstones,
    assets: remote.assets,
  }
}

export function decideInitialization(input: {
  base: SyncSnapshotV1
  local: SyncSnapshotV1
  revisions: readonly SyncRevisionV1[]
}): SyncDecision {
  const builtRemote = mergeRemoteRevisionHeads(input.base, input.revisions)
  if (!builtRemote) return { action: 'unknown-ancestor', remoteRevisionIds: [] }
  if (builtRemote.kind === 'conflict') {
    return {
      action: 'conflict',
      base: input.base,
      deviceLocal: input.local,
      local: builtRemote.local,
      remote: builtRemote.remote,
      remoteRevisionIds: builtRemote.headRevisionIds,
      remainingRemoteRevisionIds: builtRemote.remainingRemoteRevisionIds,
      conflicts: builtRemote.conflicts,
      stage: 'remote-branches',
    }
  }
  const remote = builtRemote.state
  const merge = mergeSyncSnapshots(input.base, input.local, remote.snapshot)
  if (merge.conflicts.length > 0) {
    return {
      action: 'conflict',
      base: input.base,
      deviceLocal: input.local,
      local: input.local,
      remote: remote.snapshot,
      remoteRevisionIds: remote.headRevisionIds,
      remainingRemoteRevisionIds: [],
      conflicts: merge.conflicts,
      stage: 'local-remote',
    }
  }
  if (remote.headRevisionIds.length === 1 && jsonEquals(merge.snapshot, remote.snapshot)) {
    return {
      action: 'apply-remote',
      remote,
      revisionId: remote.headRevisionIds[0]!,
    }
  }
  return {
    action: 'publish',
    parents: remote.headRevisionIds,
    snapshot: merge.snapshot,
    reason: 'merge',
    tombstones: remote.tombstones,
    assets: remote.assets,
  }
}
