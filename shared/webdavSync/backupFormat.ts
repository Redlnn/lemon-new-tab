import { canonicalJson } from './canonical.ts'
import type { SyncSnapshotV1 } from './types.ts'
import { validateSyncSnapshot } from './validation.ts'

const FORMAT_VERSION = 1

export interface ParsedLocalBackup {
  snapshot: SyncSnapshotV1
}

function withoutWallpaperFiles(snapshot: SyncSnapshotV1): SyncSnapshotV1 {
  const result = structuredClone(snapshot)
  result.scope.wallpapers = false
  if (result.optional?.wallpapers) delete result.optional.wallpapers
  if (result.optional && Object.keys(result.optional).length === 0) delete result.optional
  return result
}

function validateSnapshot(value: unknown): SyncSnapshotV1 {
  const validation = validateSyncSnapshot(value)
  if (!validation.ok) throw new TypeError(validation.error)
  return validation.value
}

export function serializeJsonBackup(snapshot: SyncSnapshotV1): string {
  return canonicalJson({
    product: 'lemon-new-tab',
    formatVersion: FORMAT_VERSION,
    snapshot: validateSnapshot(withoutWallpaperFiles(snapshot)),
  })
}

export function parseJsonBackup(value: unknown): ParsedLocalBackup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Backup must be an object')
  }
  const record = value as Record<string, unknown>
  if (record.product !== 'lemon-new-tab' || record.formatVersion !== FORMAT_VERSION) {
    throw new TypeError('Backup format is unsupported')
  }
  return { snapshot: validateSnapshot(record.snapshot) }
}
