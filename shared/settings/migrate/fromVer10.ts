import { defaultSettings, type SettingsSchemaV10, type SettingsSchemaV11 } from '..'

export function migrateFromVer10To11(old: SettingsSchemaV10): SettingsSchemaV11 {
  const { shortcut, perf, ...rest } = old
  const { shortcut: perfShortcut, ...restPerf } = perf

  return {
    ...rest,
    clock: {
      ...rest.clock,
      style: {
        ...rest.clock.style,
        transparency: defaultSettings.clock.style.transparency,
      },
    },
    quickLinks: shortcut,
    perf: {
      ...restPerf,
      bookmark: {
        ...restPerf.bookmark,
        transparency: defaultSettings.perf.bookmark.transparency,
        blurIntensity: defaultSettings.perf.bookmark.blurIntensity,
      },
      dialog: {
        ...restPerf.dialog,
        transparency: defaultSettings.perf.dialog.transparency,
        blurIntensity: defaultSettings.perf.dialog.blurIntensity,
      },
      quickLinks: {
        ...perfShortcut,
        transparency: defaultSettings.perf.quickLinks.transparency,
        blurIntensity: defaultSettings.perf.quickLinks.blurIntensity,
      },
      searchBar: {
        ...restPerf.searchBar,
        transparency: defaultSettings.perf.searchBar.transparency,
        blurIntensity: defaultSettings.perf.searchBar.blurIntensity,
      },
      yiyan: {
        ...restPerf.yiyan,
        transparency: defaultSettings.perf.yiyan.transparency,
        blurIntensity: defaultSettings.perf.yiyan.blurIntensity,
      },
      actionBtns: {
        ...restPerf.actionBtns,
        transparency: defaultSettings.perf.actionBtns.transparency,
        blurIntensity: defaultSettings.perf.actionBtns.blurIntensity,
      },
    },
    version: 11,
  } satisfies SettingsSchemaV11
}
