import { jsonEquals } from '../json.ts'
import { projectSettings, SYNC_SETTING_PATHS } from '../settings/projection.ts'

import type { JsonObject } from './types.ts'

export { SYNC_SETTING_PATHS }

export function pickSyncSettings(settings: unknown): JsonObject {
  return projectSettings(settings, { syncOnly: true }) as JsonObject
}

export function completeSyncSettings(settings: unknown): JsonObject {
  return projectSettings(settings, { syncOnly: true, defaults: true }) as JsonObject
}

export function syncSettingsChanged(previous: unknown, next: unknown): boolean {
  return !jsonEquals(pickSyncSettings(previous ?? {}), pickSyncSettings(next ?? {}))
}

export function syncWallpaperSettingsChanged(previous: unknown, next: unknown): boolean {
  const before = previous as { background?: { rotation?: unknown; online?: { url?: unknown } } }
  const after = next as typeof before
  return (
    !jsonEquals(before?.background?.rotation ?? null, after?.background?.rotation ?? null) ||
    !jsonEquals(before?.background?.online?.url ?? null, after?.background?.online?.url ?? null)
  )
}

function mergeObjects(target: JsonObject, incoming: JsonObject): JsonObject {
  const result = structuredClone(target)
  const merge = (into: JsonObject, source: JsonObject) => {
    for (const [key, value] of Object.entries(source)) {
      const current = into[key]
      if (
        current &&
        value &&
        typeof current === 'object' &&
        typeof value === 'object' &&
        !Array.isArray(current) &&
        !Array.isArray(value)
      )
        merge(current, value)
      else into[key] = structuredClone(value)
    }
  }
  merge(result, incoming)
  return result
}

export function applySyncSettings<T>(current: T, incoming: JsonObject): T {
  // 应用时同步清理本机已废弃字段；本机专用字段沿用当前值。
  const settings = projectSettings(current, { defaults: true, strict: false }) as JsonObject
  return mergeObjects(settings, pickSyncSettings(incoming)) as T
}

/** 缺少字段表示旧发布尚未携带，沿用比较基线；未知字段不会进入工作数据。 */
export function normalizeRemoteSyncSettings(baseline: JsonObject, remote: JsonObject): JsonObject {
  return pickSyncSettings(mergeObjects(completeSyncSettings(baseline), pickSyncSettings(remote)))
}

/** 只合并同步字段，不引入完整设置或本机元数据。 */
export function mergeSyncSettingValues(base: JsonObject, incoming: JsonObject): JsonObject {
  return mergeObjects(pickSyncSettings(base), pickSyncSettings(incoming))
}
