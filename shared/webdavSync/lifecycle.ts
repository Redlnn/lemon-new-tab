import { SYNC_ENTITIES } from './domains.ts'
import type { SyncSnapshotV1, TombstoneV1 } from './types.ts'

export const TOMBSTONE_RETENTION_DAYS = 180
export const HISTORY_RETENTION_DAYS = 180
export const MAX_HISTORY_VERSIONS = 10
export const MIN_COMPLETE_HISTORY_VERSIONS = 2
export const ORPHAN_RESOURCE_GRACE_MS = 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const ENTITY_TYPES = new Set<string>(SYNC_ENTITIES.map(({ type }) => type))

export function createTombstone(
  entityType: string,
  entityId: string,
  revisionId: string,
  deletedAt = new Date(),
): TombstoneV1 {
  return {
    entityType,
    entityId,
    deletedByRevisionId: revisionId,
    deletedAt: deletedAt.toISOString(),
    expiresAt: new Date(deletedAt.getTime() + TOMBSTONE_RETENTION_DAYS * DAY_MS).toISOString(),
  }
}

export function pruneExpiredTombstones(
  tombstones: readonly TombstoneV1[],
  now = new Date(),
): TombstoneV1[] {
  const nowTime = now.getTime()
  return tombstones
    .filter((item) => ENTITY_TYPES.has(item.entityType) && Date.parse(item.expiresAt) > nowTime)
    .map(({ entityType, entityId, deletedByRevisionId, deletedAt, expiresAt }) => ({
      entityType,
      entityId,
      deletedByRevisionId,
      deletedAt,
      expiresAt,
    }))
}

export function mustReinitializeDevice(lastSeenAt: string, now = new Date()): boolean {
  const lastSeenTime = Date.parse(lastSeenAt)
  return (
    !Number.isFinite(lastSeenTime) ||
    now.getTime() - lastSeenTime > TOMBSTONE_RETENTION_DAYS * DAY_MS
  )
}

export function deriveSnapshotTombstones(
  base: SyncSnapshotV1,
  next: SyncSnapshotV1,
  revisionId: string,
  deletedAt = new Date(),
): TombstoneV1[] {
  const result: TombstoneV1[] = []
  const appendDeleted = (
    entityType: string,
    baseIds: readonly string[],
    nextIds: readonly string[],
  ) => {
    const remaining = new Set(nextIds)
    for (const id of baseIds) {
      if (!remaining.has(id)) result.push(createTombstone(entityType, id, revisionId, deletedAt))
    }
  }

  for (const entity of SYNC_ENTITIES)
    appendDeleted(
      entity.type,
      entity.items(base)?.map((item) => item.id) ?? [],
      entity.items(next)?.map((item) => item.id) ?? [],
    )
  return result
}
