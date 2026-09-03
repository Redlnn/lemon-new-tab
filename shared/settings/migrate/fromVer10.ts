import { defaultSettings } from '../default'
import type { SettingsSchemaV10, SettingsSchemaV11 } from '../types'

export function migrateFromVer10To11(old: SettingsSchemaV10): SettingsSchemaV11 {
  const { shortcut, perf, ...rest } = old
  const { shortcut: perfShortcut, ...restPerf } = perf

  return {
    ...rest,
    theme: {
      ...rest.theme,
      keepClockVisibleOnIdle: defaultSettings.theme.keepClockVisibleOnIdle,
    },
    background: {
      ...rest.background,
      showDownloadBtn: defaultSettings.background.showDownloadBtn,
      bing: {
        ...rest.background.bing,
        resolution: defaultSettings.background.bing.resolution,
        cachedResolution: rest.background.bing.id ? '1080p' : null,
      },
    },
    clock: {
      ...rest.clock,
      dateSize: defaultSettings.clock.dateSize,
      style: {
        ...rest.clock.style,
        transparency: defaultSettings.clock.style.transparency,
      },
    },
    search: {
      ...rest.search,
      borderRadius: defaultSettings.search.borderRadius,
      builtInEngineOrder: structuredClone(defaultSettings.search.builtInEngineOrder),
      hiddenBuiltInEngines: structuredClone(defaultSettings.search.hiddenBuiltInEngines),
      leftAlignInput: defaultSettings.search.leftAlignInput,
      suggestionsEnabled: defaultSettings.search.suggestionsEnabled,
    },
    quickLinks: {
      ...shortcut,
      iconBorderRadius: defaultSettings.quickLinks.iconBorderRadius,
    },
    dock: {
      ...rest.dock,
      borderRadius: defaultSettings.dock.borderRadius,
      launchpad: {
        ...rest.dock.launchpad,
        iconSize: defaultSettings.dock.launchpad.iconSize,
      },
    },
    yiyan: {
      ...rest.yiyan,
      borderRadius: defaultSettings.yiyan.borderRadius,
    },
    layout: {
      ...rest.layout,
      actionBtnBorderRadius: defaultSettings.layout.actionBtnBorderRadius,
      globalBorderRadius: defaultSettings.layout.globalBorderRadius,
      minimalModeOnDoubleClick: defaultSettings.layout.minimalModeOnDoubleClick,
    },
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
