import { CURRENT_CONFIG_VERSION } from '../current.ts'
import { isSettingsObject } from '../projection.ts'
import type { SettingsSchemaV10, SettingsSchemaV11 } from '../types'

import { migrateFromVer10To11 } from './fromVer10.ts'
import { migrateFromVer11To12 } from './fromVer11.ts'
import type { PartialSettings } from './partial.ts'

/** 版本登记共用于同步投影和完整本机设置；字段映射仍由原迁移函数负责。 */
export const SYNC_SETTINGS_MIGRATIONS: Record<
  number,
  (settings: Record<string, unknown>) => Record<string, unknown>
> = {
  10: (settings) => migrateFromVer10To11(settings as PartialSettings<SettingsSchemaV10>),
  11: (settings) => migrateFromVer11To12(settings as PartialSettings<SettingsSchemaV11>),
}

/** 复用本机迁移的纯转换，不创建旧版完整配置，也不执行壁纸存储副作用。 */
export function migrateSyncSettings(value: unknown, version: number): Record<string, unknown> {
  if (!isSettingsObject(value)) throw new TypeError('Settings must be an object')
  let settings = structuredClone(value)
  while (version < CURRENT_CONFIG_VERSION) {
    const migrate = SYNC_SETTINGS_MIGRATIONS[version]
    if (!migrate) throw new TypeError(`Unsupported settings version: ${version}`)
    const next = migrate(settings)
    if (next.version !== version + 1) throw new TypeError('Invalid settings migration result')
    settings = next
    version = next.version as number
  }
  return settings
}
