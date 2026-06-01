import type { SettingsSchemaV10 } from './v10'

export interface SettingsSchemaV11 extends Omit<
  SettingsSchemaV10,
  'version' | 'shortcut' | 'perf'
> {
  quickLinks: SettingsSchemaV10['shortcut']

  perf: Omit<SettingsSchemaV10['perf'], 'shortcut'> & {
    quickLinks: SettingsSchemaV10['perf']['shortcut']
  }

  version: 11
}
