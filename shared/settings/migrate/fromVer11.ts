import type { SettingsSchemaV11, SettingsSchemaV12 } from '../types'

import type { PartialSettings } from './partial.ts'

export function migrateFromVer11To12(old: SettingsSchemaV11): SettingsSchemaV12
export function migrateFromVer11To12(
  old: PartialSettings<SettingsSchemaV11>,
): PartialSettings<SettingsSchemaV12>
export function migrateFromVer11To12(
  old: PartialSettings<SettingsSchemaV11>,
): PartialSettings<SettingsSchemaV12> {
  const { local: _local, localDark: _localDark, ...background } = old.background ?? {}
  void _local
  void _localDark
  return {
    ...old,
    version: 12,
    background: {
      ...background,
      solid: { light: '', dark: '' },
      rotation: { enabled: false, order: 'random' },
    },
  }
}
