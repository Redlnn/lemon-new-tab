import { hex2rgba } from '@/shared/theme'

import { defaultSettings, type SettingsSchemaV8, type SettingsSchemaV9 } from '..'

function clockSizeToNumber(size: 'small' | 'medium' | 'large'): number {
  switch (size) {
    case 'small':
      return 40
    case 'medium':
      return 50
    case 'large':
      return 70
    default:
      return 50
  }
}

function hex2maskColor(hex: string, alpha: number): string {
  const rgba = hex2rgba(hex)
  return `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${alpha / 100})`
}

export function migrateFromVer8To9(oldSettings: SettingsSchemaV8): SettingsSchemaV9 {
  return {
    theme: {
      primaryColor: oldSettings.theme.primaryColor,
      colorfulMode: oldSettings.theme.colorfulMode,
      monetColor: oldSettings.theme.monetColor,
      idleHide: defaultSettings.theme.idleHide,
    },

    clock: {
      enabled: oldSettings.clock.enabled,

      colorfulNum: defaultSettings.clock.colorfulNum,
      newStyle: defaultSettings.clock.newStyle,
      hour12: defaultSettings.clock.hour12,

      meridiem: {
        show: oldSettings.clock.showMeridiem,
        followSize: oldSettings.clock.meridiemFollowSize,
      },

      showDate: oldSettings.clock.showDate,
      showLunar: oldSettings.clock.showLunar,
      showSeconds: oldSettings.clock.showSeconds,

      size: clockSizeToNumber(oldSettings.clock.size),
      weight: {
        time: oldSettings.clock.weight,
        date: defaultSettings.clock.weight.date,
      },

      style: {
        shadow: oldSettings.clock.shadow,
        blink: oldSettings.clock.blink,

        invertColor: {
          light: oldSettings.clock.invertColor.light,
          night: oldSettings.clock.invertColor.night,
        },
      },
    },

    search: {
      enabled: oldSettings.search.enabled,

      placeholder: oldSettings.search.placeholder,

      expandAlways: oldSettings.search.expandAlways,
      showIconAlways: oldSettings.search.showIconAlways,

      suggestionAPI: oldSettings.search.suggestionAPI,
      engine: oldSettings.search.engine,

      openInNewTab: oldSettings.search.openInNewTab,
      recordHistory: oldSettings.search.recordHistory,

      style: {
        shadow: oldSettings.search.shadow,
        border: defaultSettings.search.style.border,
      },
    },

    background: {
      bgType: oldSettings.background.bgType,

      vignette: oldSettings.background.vignette,
      parallax: defaultSettings.background.parallax,

      blur: oldSettings.background.blur,

      mask: {
        enabled: oldSettings.background.mask.opacity > 0,
        light:
          oldSettings.background.mask.opacity > 0
            ? hex2maskColor(oldSettings.background.mask.light, oldSettings.background.mask.opacity)
            : defaultSettings.background.mask.light,
        night:
          oldSettings.background.mask.opacity > 0
            ? hex2maskColor(oldSettings.background.mask.night, oldSettings.background.mask.opacity)
            : defaultSettings.background.mask.night,
      },

      pauseOnBlur: oldSettings.background.pauseOnBlur,
      fastAnimation: oldSettings.background.fastAnimation,

      local: {
        id: oldSettings.background.local.id,
        mediaType: oldSettings.background.local.mediaType,
      },
      localDark: {
        id: oldSettings.background.localDark.id,
        mediaType: oldSettings.background.localDark.mediaType,
      },
      bing: {
        id: oldSettings.background.bing.id,
        updateDate: oldSettings.background.bing.updateDate,
      },

      online: {
        url: oldSettings.background.online.url,
        cache: {
          enabled: oldSettings.background.online.cacheEnable,
          duration: oldSettings.background.online.cacheDuration,
          noExpires: oldSettings.background.online.noExpires,
        },
      },
    },

    shortcut: {
      enabled: oldSettings.shortcut.enabled,

      topSites: oldSettings.shortcut.enableTopSites,
      pinnedIcon: oldSettings.shortcut.showPinnedIcon,
      openInNewTab: oldSettings.shortcut.openInNewTab,
      paging: !oldSettings.shortcut.disablePaging,
      showOnSearchFocus: oldSettings.shortcut.showOnSearchFocus,

      iconSize: oldSettings.shortcut.iconSize,
      iconRatio: oldSettings.shortcut.iconRatio,

      style: {
        shadow: oldSettings.shortcut.enableShadow,
        border: defaultSettings.quickLinks.style.border,
      },

      layout: {
        rows: oldSettings.shortcut.rows,
        columns: oldSettings.shortcut.columns,
      },

      marginTop: oldSettings.shortcut.marginTop,
      spacing: {
        itemGapX: oldSettings.shortcut.itemMarginH,
        itemGapY: oldSettings.shortcut.itemMarginV,
        iconTitleGap: oldSettings.shortcut.iconMarginBottom,
      },

      title: {
        show: oldSettings.shortcut.showShortcutTitle,
        extraWidth: oldSettings.shortcut.titleExtraWidth,
        whiteInLightMode: oldSettings.shortcut.whiteTextInLightMode,
      },
    },

    dock: defaultSettings.dock,
    sync: oldSettings.sync,

    yiyan: {
      enabled: oldSettings.yiyan.enabled,
      alwaysShow: oldSettings.yiyan.alwaysShow,

      provider: oldSettings.yiyan.provider,

      style: {
        shadow: defaultSettings.yiyan.style.shadow,
        invertColor: {
          light: defaultSettings.yiyan.style.invertColor.light,
          night: defaultSettings.yiyan.style.invertColor.night,
        },
      },
    },

    perf: {
      bgSwitchAnim: !oldSettings.perf.disableBgSwitchAnim,
      dockScale: defaultSettings.perf.dockScale,
      bookmark: {
        transparent: !oldSettings.perf.disableBookmarkTransparent,
        blur: !oldSettings.perf.disableBookmarkBlur,
      },
      dialog: {
        transparent: !oldSettings.perf.disableDialogTransparent,
        blur: !oldSettings.perf.disableDialogBlur,
        animation: !oldSettings.perf.disableDialogAnimation,
      },
      focus: {
        scale: !oldSettings.perf.disableFocusScale,
        blur: !oldSettings.perf.disableFocusBlur,
      },
      shortcut: {
        transparent: !oldSettings.perf.disableShortcutTransparent,
        blur: !oldSettings.perf.disableShortcutBlur,
      },
      searchBar: {
        transparent: !oldSettings.perf.disableSearchBarTransparent,
        blur: !oldSettings.perf.disableSearchBarBlur,
        launchAnim: defaultSettings.perf.searchBar.launchAnim,
      },
      yiyan: {
        transparent: !oldSettings.perf.disableYiyanTransparent,
        blur: !oldSettings.perf.disableYiyanBlur,
        ripple: defaultSettings.perf.yiyan.ripple,
      },
      actionBtns: {
        blur: !oldSettings.perf.disableSettingsBtnBlur,
        transparent: !oldSettings.perf.disableSettingsBtnTransparent,
      },
    },

    bookmark: {
      direction: oldSettings.bookmark.direction,
      rightClickToOpen: oldSettings.bookmark.rightClickToOpen,
      showBtn: !oldSettings.bookmark.hideBtn,
      defaultSortMode: defaultSettings.bookmark.defaultSortMode,
    },

    hideMajorChangelog: oldSettings.hideMajorChangelog,
    readChangeLog: oldSettings.readChangeLog,
    faviconCacheEnabled: defaultSettings.faviconCacheEnabled,

    pluginVersion: oldSettings.pluginVersion,
    version: 9,
  } satisfies SettingsSchemaV9
}
