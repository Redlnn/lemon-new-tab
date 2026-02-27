import { ClockSize } from '@/shared/enums'

import type { SettingsInterfaceVer7, SettingsInterfaceVer8 } from '..'
import { defaultSettings } from '..'
import { toNewBgType } from './map'

export function migrateFromVer7To8(oldSettings: SettingsInterfaceVer7): SettingsInterfaceVer8 {
  return {
    theme: {
      primaryColor: oldSettings.primaryColor,
      colorfulMode: oldSettings.colorfulMode,
      monetColor: oldSettings.monetColor,
      idleHide: defaultSettings.theme.idleHide
    },
    clock: {
      enabled: oldSettings.time.enabled,
      colorfulNum: defaultSettings.clock.colorfulNum,
      newStyle: defaultSettings.clock.newStyle,
      isMeridiem: oldSettings.time.isMeridiem,
      showMeridiem: oldSettings.time.showMeridiem,
      showDate: oldSettings.time.showDate,
      showLunar: oldSettings.time.showLunar,
      showSeconds: oldSettings.time.showSeconds,
      size: oldSettings.time.small ? ClockSize.Small : ClockSize.Medium,
      weight: defaultSettings.clock.weight,
      calcWeight: defaultSettings.clock.calcWeight,
      meridiemFollowSize: defaultSettings.clock.meridiemFollowSize,
      shadow: oldSettings.time.enableShadow,
      blink: oldSettings.time.blinkingColon,
      invertColor: {
        light: oldSettings.time.invertColor.light,
        night: oldSettings.time.invertColor.night
      }
    },
    search: {
      enabled: oldSettings.search.enabled,
      expandAlways: oldSettings.search.alwaysExpandSearchBar,
      showIconAlways: oldSettings.search.alwaysShowIcon,
      suggestionAPI: oldSettings.search.selectedSearchSuggestionAPI,
      engine: oldSettings.search.selectedSearchEngine,
      openInNewTab: oldSettings.search.searchInNewTab,
      recordHistory: oldSettings.search.recordSearchHistory,
      shadow: oldSettings.search.enableShadow,
      placeholder: oldSettings.search.placeholder,
      launchAnimation: oldSettings.search.launchAnim
    },
    background: {
      bgType: toNewBgType(oldSettings.background.bgType),
      vignette: oldSettings.background.enableVignetting,
      blur: oldSettings.background.blurIntensity,
      mask: {
        opacity: oldSettings.background.bgMaskOpacity,
        light: oldSettings.background.lightMaskColor,
        night: oldSettings.background.nightMaskColor
      },
      pauseOnBlur: oldSettings.background.pauseWhenBlur,
      fastAnimation: oldSettings.background.fasterBgAnim,
      local: {
        id: oldSettings.localBackground.id,
        mediaType: oldSettings.localBackground.mediaType
      },
      localDark: {
        id: oldSettings.localDarkBackground.id,
        mediaType: oldSettings.localDarkBackground.mediaType
      },
      bing: {
        id: oldSettings.bingBackground.id,
        updateDate: oldSettings.bingBackground.updateDate
      },
      online: {
        url: oldSettings.background.onlineUrl,
        cacheEnable: defaultSettings.background.online.cacheEnable,
        cacheDuration: defaultSettings.background.online.cacheDuration,
        noExpires: defaultSettings.background.online.noExpires
      }
    },
    shortcut: {
      enabled: oldSettings.shortcut.enabled,
      enableTopSites: oldSettings.shortcut.enableTopSites,
      enableShadow: oldSettings.shortcut.enableShadow,
      disablePaging: defaultSettings.shortcut.disablePaging,
      showOnSearchFocus: defaultSettings.shortcut.showOnSearchFocus,
      rows: oldSettings.shortcut.rows,
      columns: oldSettings.shortcut.columns,
      itemMarginH: oldSettings.shortcut.itemMarginH,
      itemMarginV: 2 * oldSettings.shortcut.itemMarginV, // 新版更改了间距逻辑，去除了模板代码中的缩放，因此这里需要补偿
      showShortcutTitle: oldSettings.shortcut.showShortcutTitle,
      showPinnedIcon: oldSettings.shortcut.showPinnedIcon,
      iconSize: oldSettings.shortcut.iconSize,
      iconRatio: defaultSettings.shortcut.iconRatio,
      iconMarginBottom: defaultSettings.shortcut.iconMarginBottom,
      titleExtraWidth: defaultSettings.shortcut.titleExtraWidth,
      whiteTextInLightMode: oldSettings.shortcut.whiteTextInLightMode,
      marginTop: oldSettings.shortcut.marginTop,
      openInNewTab: defaultSettings.shortcut.openInNewTab
    },
    sync: { enabled: oldSettings.sync.enabled },
    yiyan: {
      enabled: oldSettings.yiyan.enabled,
      alwaysShow: oldSettings.yiyan.alwaysShow,
      provider: oldSettings.yiyan.provider,
      enableShadow: oldSettings.yiyan.enableShadow,
      invertColor: {
        light: oldSettings.yiyan.invertColor.light,
        night: oldSettings.yiyan.invertColor.night
      }
    },
    perf: { ...oldSettings.perf },
    bookmark: {
      ...oldSettings.bookmarkSidebar,
      defaultSortMode: defaultSettings.bookmark.defaultSortMode
    },
    hideMajorChangelog: oldSettings.hideMajorChangelog,
    readChangeLog: oldSettings.readChangeLog,
    pluginVersion: oldSettings.pluginVersion,
    version: 8
  }
}
