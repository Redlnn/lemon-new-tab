import { browser, storage } from '#imports'

import { coordinateStorage } from '@/shared/storage/syncWrite'

import { migrateWallpaperLibrary } from '../wallpaperLibrary'

import { type CURRENT_CONFIG_SCHEMA, CURRENT_CONFIG_VERSION } from './current'
import { defaultSettings } from './default'
import {
  migrateSettingsOneVersion,
  migrateSettingsToCurrentWithWallpaper,
  type MigratableSettings,
} from './migrateToCurrent'
import type {
  SettingsSchemaV10,
  SettingsSchemaV11,
  SettingsSchemaV7,
  SettingsSchemaV8,
  SettingsSchemaV9,
} from './types'

// 合并重复的迁移逻辑，通过辅助函数创建迁移函数
function createMigration<From, To>(fromVersion: number) {
  return async (settings: From & { version: number }): Promise<To> => {
    if (settings.version > fromVersion) {
      return settings as unknown as To
    }
    console.log(`[Settings] Migrating config from version ${fromVersion} to ${fromVersion + 1}`)
    if (settings.version === fromVersion) {
      return (await migrateSettingsOneVersion(
        settings as unknown as MigratableSettings,
      )) as unknown as To
    }
    throw new Error('Invalid config version')
  }
}

const storedSettings = storage.defineItem<CURRENT_CONFIG_SCHEMA>('local:settings', {
  fallback: structuredClone(defaultSettings),
  version: CURRENT_CONFIG_VERSION,
  migrations: {
    // 不再提供对第6版及以前的迁移支持，遇到 <=6 的数据应由初始化逻辑提示用户清除数据
    8: createMigration<SettingsSchemaV7, SettingsSchemaV8>(7),
    9: createMigration<SettingsSchemaV8, SettingsSchemaV9>(8),
    10: createMigration<SettingsSchemaV9, SettingsSchemaV10>(9),
    11: createMigration<SettingsSchemaV10, SettingsSchemaV11>(10),
    12: async (settings: SettingsSchemaV11) => {
      await migrateWallpaperLibrary(settings.background)
      return createMigration<SettingsSchemaV11, CURRENT_CONFIG_SCHEMA>(11)(settings)
    },
  },
})

async function getCurrentSettings() {
  // 必须先等待 WXT 自己的迁移完成，再比较配置值和元数据，避免读到迁移中的中间状态。
  const value = await storedSettings.getValue()
  const metadata = (await storedSettings.getMeta()) as { v?: number; [key: string]: unknown }
  const metadataVersion = typeof metadata.v === 'number' ? metadata.v : null

  if (value.version === CURRENT_CONFIG_VERSION && metadataVersion === CURRENT_CONFIG_VERSION) {
    return { value, metadata }
  }

  if (value.version < CURRENT_CONFIG_VERSION) {
    const repaired = await migrateSettingsToCurrentWithWallpaper(
      value as unknown as MigratableSettings,
    )
    await browser.storage.local.set({
      settings: repaired,
      settings$: { ...metadata, v: CURRENT_CONFIG_VERSION },
    })
    return { value: repaired, metadata: { ...metadata, v: CURRENT_CONFIG_VERSION } }
  }

  if (value.version === CURRENT_CONFIG_VERSION && metadataVersion !== CURRENT_CONFIG_VERSION) {
    await browser.storage.local.set({
      settings$: { ...metadata, v: CURRENT_CONFIG_VERSION },
    })
    return { value, metadata: { ...metadata, v: CURRENT_CONFIG_VERSION } }
  }

  throw new Error(
    `Settings version mismatch: value=${value.version}, metadata=${metadataVersion ?? 'missing'}`,
  )
}

// WXT 会记录迁移失败后继续返回旧值；阻止调用方把未迁移的数据当作当前配置保存。
const currentSettingsStorage = {
  ...storedSettings,
  async getValue() {
    return (await getCurrentSettings()).value
  },
  async setValue(value: CURRENT_CONFIG_SCHEMA) {
    if (value.version !== CURRENT_CONFIG_VERSION) {
      throw new Error(`Cannot save settings with version ${value.version}`)
    }

    const { metadata } = await getCurrentSettings()
    await browser.storage.local.set({
      settings: value,
      settings$: { ...metadata, v: CURRENT_CONFIG_VERSION },
    })
  },
}

export const settingsStorage = coordinateStorage(currentSettingsStorage)
