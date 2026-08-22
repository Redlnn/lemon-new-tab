import { jsonEquals } from './canonical.ts'
import type { JsonObject, JsonValue, SyncConflict, SyncSnapshotV1 } from './types.ts'

const MISSING = Symbol('missing')
type MaybeJson = JsonValue | typeof MISSING

export interface SyncDifference {
  category: SyncConflict['category']
  path: string
  current?: JsonValue
  target?: JsonValue
}

export interface SyncDifferenceResult {
  differences: SyncDifference[]
  truncated: boolean
}

export function compareSyncSnapshots(
  current: SyncSnapshotV1,
  target: SyncSnapshotV1,
  limit = 200,
): SyncDifferenceResult {
  const result: SyncDifferenceResult = { differences: [], truncated: false }
  const sections: Array<
    [SyncConflict['category'], string, JsonValue | undefined, JsonValue | undefined]
  > = [
    ['scope', 'scope', current.scope as unknown as JsonValue, target.scope as unknown as JsonValue],
    ['settings', 'settings', current.settings, target.settings],
    [
      'quick-links',
      'quickLinks',
      current.quickLinks as unknown as JsonValue,
      target.quickLinks as unknown as JsonValue,
    ],
    [
      'search-engines',
      'customSearchEngines',
      current.customSearchEngines as unknown as JsonValue,
      target.customSearchEngines as unknown as JsonValue,
    ],
    ['ui', 'ui', current.ui as unknown as JsonValue, target.ui as unknown as JsonValue],
    [
      'blocked-top-sites',
      'optional.blockedTopSites',
      current.optional?.blockedTopSites as unknown as JsonValue | undefined,
      target.optional?.blockedTopSites as unknown as JsonValue | undefined,
    ],
    [
      'wallpaper',
      'optional.wallpapers',
      current.optional?.wallpapers as unknown as JsonValue | undefined,
      target.optional?.wallpapers as unknown as JsonValue | undefined,
    ],
    [
      'settings',
      'optional.onlineWallpaperUrl',
      current.optional?.onlineWallpaperUrl,
      target.optional?.onlineWallpaperUrl,
    ],
  ]

  for (const [category, path, left, right] of sections) {
    compareValue(
      category,
      path,
      left === undefined ? MISSING : left,
      right === undefined ? MISSING : right,
      result,
      limit,
    )
  }
  return result
}

function compareValue(
  category: SyncConflict['category'],
  path: string,
  current: MaybeJson,
  target: MaybeJson,
  result: SyncDifferenceResult,
  limit: number,
): void {
  if (maybeEquals(current, target)) return
  if (result.differences.length >= limit) {
    result.truncated = true
    return
  }
  if (isObject(current) && isObject(target)) {
    const keys = new Set([...Object.keys(current), ...Object.keys(target)])
    for (const key of [...keys].sort()) {
      compareValue(
        category,
        `${path}.${key}`,
        Object.hasOwn(current, key) ? current[key]! : MISSING,
        Object.hasOwn(target, key) ? target[key]! : MISSING,
        result,
        limit,
      )
    }
    return
  }
  if (isEntityArray(current) && isEntityArray(target)) {
    compareEntityArray(category, path, current, target, result, limit)
    return
  }
  result.differences.push({
    category,
    path,
    ...(current === MISSING ? {} : { current }),
    ...(target === MISSING ? {} : { target }),
  })
}

function compareEntityArray(
  category: SyncConflict['category'],
  path: string,
  current: Array<JsonObject & { id: string }>,
  target: Array<JsonObject & { id: string }>,
  result: SyncDifferenceResult,
  limit: number,
): void {
  const currentMap = new Map(current.map((item) => [item.id, item]))
  const targetMap = new Map(target.map((item) => [item.id, item]))
  for (const id of [...new Set([...currentMap.keys(), ...targetMap.keys()])].sort()) {
    compareValue(
      category,
      `${path}.${id}`,
      currentMap.get(id) ?? MISSING,
      targetMap.get(id) ?? MISSING,
      result,
      limit,
    )
  }
  compareValue(
    category,
    `${path}.__order`,
    current.map((item) => item.id),
    target.map((item) => item.id),
    result,
    limit,
  )
}

function maybeEquals(left: MaybeJson, right: MaybeJson): boolean {
  if (left === MISSING || right === MISSING) return left === right
  return jsonEquals(left, right)
}

function isObject(value: MaybeJson): value is JsonObject {
  return value !== MISSING && value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isEntityArray(value: MaybeJson): value is Array<JsonObject & { id: string }> {
  return (
    Array.isArray(value) && value.every((item) => isObject(item) && typeof item.id === 'string')
  )
}
