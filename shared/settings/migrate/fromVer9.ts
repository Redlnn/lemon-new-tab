import type { SettingsSchemaV9, SettingsSchemaV10 } from '..'
import { defaultSettings } from '..'

export function migrateFromVer9To10(old: SettingsSchemaV9): SettingsSchemaV10 {
  return {
    ...old,
    search: {
      ...old.search,
      expandWidth: defaultSettings.search.expandWidth,
    },
    shortcut: {
      ...old.shortcut,
      grouping: defaultSettings.quickLinks.grouping,
      useScroll: defaultSettings.quickLinks.useScroll,
      pagingLoop: defaultSettings.quickLinks.pagingLoop,
    },
    yiyan: {
      ...old.yiyan,
      customLines: defaultSettings.yiyan.customLines,
    },
    layout: {
      mainPosition: {
        type: old.shortcut.enabled ? 'center' : 'dvh',
        value: defaultSettings.layout.mainPosition.value,
      },
      actionBtnPosition: old.dock.enabled ? 'top-right' : 'bottom-right',
    },
    version: 10,
  } satisfies SettingsSchemaV10
}
