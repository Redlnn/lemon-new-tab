import type { BgType, ClockSize, ClockWeight, DrawerDirection, SortMode } from '@/shared/enums'

import type { YiyanProviderKey } from '@newtab/shared/yiyan'

import type { bingBackground, localBackground } from './type'

export interface SettingsInterfaceVer8 {
  // 主题相关
  theme: {
    primaryColor: string
    colorfulMode: boolean
    monetColor: boolean
  }

  // 时钟/时间显示
  clock: {
    enabled: boolean
    colorfulNum: boolean
    newStyle: boolean
    isMeridiem: boolean
    showMeridiem: boolean
    showDate: boolean
    showLunar: boolean
    showSeconds: boolean
    size: ClockSize
    weight: ClockWeight
    calcWeight: ClockWeight
    meridiemFollowSize: boolean
    shadow: boolean
    blink: boolean
    invertColor: {
      light: boolean
      night: boolean
    }
  }

  // 搜索相关
  search: {
    enabled: boolean
    expandAlways: boolean
    showIconAlways: boolean
    suggestionAPI: keyof typeof import('@newtab/shared/search').searchSuggestAPIs
    engine: string
    openInNewTab: boolean
    recordHistory: boolean
    shadow: boolean
    placeholder: string
    launchAnimation: boolean
  }

  // 背景设置
  background: {
    bgType: BgType
    vignette: boolean
    blur: number
    mask: {
      opacity: number
      light: string
      night: string
    }
    pauseOnBlur: boolean // 视频壁纸
    fastAnimation: boolean
    local: localBackground
    localDark: localBackground
    bing: bingBackground
    online: {
      url: string
      cacheEnable: boolean
      cacheDuration: number // 缓存时长，单位为小时
      noExpires: boolean
    }
  }

  // 快速访问
  shortcut: {
    enabled: boolean
    enableTopSites: boolean
    enableShadow: boolean
    disablePaging: boolean
    showOnSearchFocus: boolean
    rows: number
    columns: number
    itemMarginH: number
    itemMarginV: number
    showShortcutTitle: boolean
    showPinnedIcon: boolean
    iconSize: number
    iconRatio: number
    iconMarginBottom: number
    titleExtraWidth: number
    whiteTextInLightMode: boolean
    marginTop: number
    openInNewTab: boolean
  }

  // 同步
  sync: {
    enabled: boolean
  }

  // 一言
  yiyan: {
    enabled: boolean
    alwaysShow: boolean
    provider: YiyanProviderKey
    enableShadow: boolean
    invertColor: {
      light: boolean
      night: boolean
    }
  }

  // 性能相关
  perf: {
    disableBookmarkTransparent: boolean
    disableBookmarkBlur: boolean
    disableDialogTransparent: boolean
    disableDialogBlur: boolean
    disableDialogAnimation: boolean
    disableFocusScale: boolean
    disableFocusBlur: boolean
    disableShortcutTransparent: boolean
    disableShortcutBlur: boolean
    disableSearchBarTransparent: boolean
    disableSearchBarBlur: boolean
    disableYiyanTransparent: boolean
    disableYiyanBlur: boolean
    disableSettingsBtnBlur: boolean
    disableSettingsBtnTransparent: boolean
    disableBgSwitchAnim: boolean
  }

  // 书签侧边栏
  bookmark: {
    direction: DrawerDirection
    rightClickToOpen: boolean
    hideBtn: boolean
    defaultSortMode: SortMode
  }

  hideMajorChangelog: boolean
  readChangeLog: boolean
  pluginVersion: string
  version: 8
}
