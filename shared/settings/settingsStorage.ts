import { storage } from '#imports'

import { type CURRENT_CONFIG_SCHEMA, CURRENT_CONFIG_VERSION } from './current'
import { defaultSettings } from './default'
import {
  migrateFromVer7To8,
  migrateFromVer8To9,
  migrateFromVer9To10,
  migrateFromVer10To11,
} from './migrate'
import type {
  SettingsSchemaV10,
  SettingsSchemaV7,
  SettingsSchemaV8,
  SettingsSchemaV9,
} from './types'

// 合并重复的迁移逻辑，通过辅助函数创建迁移函数
function createMigration<From, To>(
  fromVersion: number,
  migrationFn: (settings: From) => Promise<To> | To,
) {
  return async (settings: From & { version: number }): Promise<To> => {
    if (settings.version > fromVersion) {
      return settings as unknown as To
    }
    console.log(`[Settings] Migrating config from version ${fromVersion} to ${fromVersion + 1}`)
    if (settings.version === fromVersion) {
      return await migrationFn(settings)
    }
    throw new Error('Invalid config version')
  }
}

export const settingsStorage = storage.defineItem<CURRENT_CONFIG_SCHEMA>('local:settings', {
  fallback: structuredClone(defaultSettings),
  version: CURRENT_CONFIG_VERSION,
  migrations: {
    // 不再提供对第6版及以前的迁移支持，遇到 <=6 的数据应由初始化逻辑提示用户清除数据
    8: createMigration<SettingsSchemaV7, SettingsSchemaV8>(7, migrateFromVer7To8),
    9: createMigration<SettingsSchemaV8, SettingsSchemaV9>(8, migrateFromVer8To9),
    10: createMigration<SettingsSchemaV9, SettingsSchemaV10>(9, migrateFromVer9To10),
    11: createMigration<SettingsSchemaV10, CURRENT_CONFIG_SCHEMA>(10, migrateFromVer10To11),
  },
})
