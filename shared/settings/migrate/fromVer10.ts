import { defaultSettings, type SettingsSchemaV10, type SettingsSchemaV11 } from '..'

export function migrateFromVer10To11(old: SettingsSchemaV10): SettingsSchemaV11 {
  const { shortcut, perf, ...rest } = old
  const { shortcut: perfShortcut, ...restPerf } = perf

  return {
    ...rest,
    quickLinks: shortcut,
    perf: {
      ...restPerf,
      bookmark: {
        ...restPerf.bookmark,
        transparency: defaultSettings.perf.bookmark.transparency,
      },
      dialog: {
        ...restPerf.dialog,
        transparency: defaultSettings.perf.dialog.transparency,
      },
      quickLinks: {
        ...perfShortcut,
        transparency: defaultSettings.perf.quickLinks.transparency,
      },
      searchBar: {
        ...restPerf.searchBar,
        transparency: defaultSettings.perf.searchBar.transparency,
      },
      yiyan: {
        ...restPerf.yiyan,
        transparency: defaultSettings.perf.yiyan.transparency,
      },
      actionBtns: {
        ...restPerf.actionBtns,
        transparency: defaultSettings.perf.actionBtns.transparency,
      },
    },
    version: 11,
  } satisfies SettingsSchemaV11
}
