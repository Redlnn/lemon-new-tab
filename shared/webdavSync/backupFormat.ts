import { CURRENT_CONFIG_VERSION } from '../settings/current.ts'

import { canonicalJson } from './canonical.ts'
import { decodeSyncSnapshot } from './snapshotCodec.ts'
import type { SyncSnapshotV1 } from './types.ts'
import { validateStoredSyncSnapshot } from './validation.ts'
import { requireSupportedSource, type SyncSource } from './version.ts'

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
  const validation = validateStoredSyncSnapshot(value)
  if (!validation.ok) throw new TypeError(validation.error)
  return validation.value
}

export function serializeJsonBackup(snapshot: SyncSnapshotV1, pluginVersion: string): string {
  return canonicalJson({
    product: 'lemon-new-tab',
    formatVersion: FORMAT_VERSION,
    pluginVersion,
    settingsSchemaVersion: CURRENT_CONFIG_VERSION,
    snapshot: decodeSyncSnapshot(
      validateSnapshot(withoutWallpaperFiles(snapshot)),
      {
        formatVersion: FORMAT_VERSION,
        settingsSchemaVersion: CURRENT_CONFIG_VERSION,
        pluginVersion,
      },
      pluginVersion,
    ),
  })
}

export function parseJsonBackup(value: unknown, pluginVersion: string): ParsedLocalBackup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Backup must be an object')
  }
  const record = value as Record<string, unknown>
  requireSupportedSource(record as unknown as SyncSource, pluginVersion)
  if (record.product !== 'lemon-new-tab' || record.formatVersion !== FORMAT_VERSION) {
    throw new TypeError('Backup format is unsupported')
  }
  return {
    snapshot: decodeSyncSnapshot(
      validateSnapshot(record.snapshot),
      record as unknown as SyncSource,
      pluginVersion,
    ),
  }
}
