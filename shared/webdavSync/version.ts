import { CURRENT_CONFIG_VERSION } from '../settings/current.ts'

export interface SyncSource {
  formatVersion: number
  settingsSchemaVersion: number
  pluginVersion: string
}

const RELEASE_VERSION = /^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/

export function compareReleaseVersions(left: string, right: string): number {
  if (!RELEASE_VERSION.test(left) || !RELEASE_VERSION.test(right))
    throw new TypeError('Invalid extension version')
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  if ([...a, ...b].some((part) => !Number.isSafeInteger(part) || part > 65535))
    throw new TypeError('Invalid extension version')
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference) return Math.sign(difference)
  }
  return 0
}

export class SyncVersionError extends Error {}

export function requireSupportedSource(source: SyncSource, pluginVersion: string): void {
  if (
    !Number.isSafeInteger(source.formatVersion) ||
    source.formatVersion < 1 ||
    !Number.isSafeInteger(source.settingsSchemaVersion) ||
    source.settingsSchemaVersion < 1
  ) {
    throw new TypeError('Invalid sync source')
  }
  const newerRelease = compareReleaseVersions(source.pluginVersion, pluginVersion) > 0
  if (
    source.formatVersion > 1 ||
    source.settingsSchemaVersion > CURRENT_CONFIG_VERSION ||
    newerRelease
  ) {
    throw new SyncVersionError('Sync data was written by a newer extension')
  }
}
