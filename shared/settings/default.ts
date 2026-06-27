import { BgType, ClockWeight, DrawerDirection, SortMode } from '@/shared/enums'

import { type CURRENT_CONFIG_SCHEMA, CURRENT_CONFIG_VERSION } from './current'

export const defaultSettings = {
  theme: {
    primaryColor: '#f5b800',
    colorfulMode: false,
    monetColor: false,
    idleHide: false,
  },

  clock: {
    enabled: true,

    colorfulNum: true,
    newStyle: true,
    hour12: false,

    meridiem: {
      show: true,
      followSize: false,
    },

    showDate: true,
    showLunar: true,
    showSeconds: false,

    size: 50,
    weight: {
      time: ClockWeight.Black,
      date: ClockWeight.Medium,
    },

    style: {
      shadow: true,
      blink: true,

      invertColor: {
        light: false,
        night: false,
      },
    },
  },
  search: {
    enabled: true,

    expandAlways: false,
    showIconAlways: false,

    suggestionAPI: 'bing',
    engine: 'bing',

    openInNewTab: false,
    recordHistory: true,

    style: {
      shadow: true,
      border: false,
    },

    placeholder: '',
    expandWidth: 500,
  },
  background: {
    bgType: BgType.Bing,

    vignette: false,
    parallax: false,

    blur: 3,

    mask: {
      enabled: false,
      light: 'rgba(0, 0, 0, 0.15)',
      night: 'rgba(0, 0, 0, 0.15)',
    },

    pauseOnBlur: false,
    fastAnimation: false,

    local: {
      id: '',
      url: '',
      mediaType: undefined,
    },
    localDark: {
      id: '',
      url: '',
      mediaType: undefined,
    },
    bing: {
      id: '',
      url: '',
      updateDate: '',
    },
    online: {
      url: '',
      cache: {
        enabled: false,
        duration: 1, // 默认缓存1小时
        noExpires: false,
      },
    },
  },

  quickLinks: {
    enabled: true,

    topSites: true,
    pinnedIcon: true,
    openInNewTab: false,
    paging: true,
    grouping: false,
    useScroll: false,
    pagingLoop: false,
    showOnSearchFocus: false,

    iconSize: 50,
    iconRatio: 0.5,

    style: {
      shadow: true,
      border: false,
    },

    layout: {
      rows: 2,
      columns: 5,
    },

    marginTop: 50,
    spacing: {
      itemGapX: 5,
      itemGapY: 20,
      iconTitleGap: 8,
    },

    title: {
      show: true,
      extraWidth: 35,
      whiteInLightMode: true,
    },
  },

  dock: {
    enabled: false,

    topSites: true,
    showOnSearchFocus: true,
    openInNewTab: false,

    limitCount: false,
    maxCount: 10,

    gap: 5,
    iconSize: 40,
    iconRatio: 0.7,

    launchpad: {
      enabled: false,
      topSites: true,
      openInNewTab: false,
    },
  },

  sync: {
    enabled: false,
  },

  yiyan: {
    enabled: true,
    alwaysShow: true,

    provider: 'jinrishici',
    customLines: '',

    style: {
      shadow: true,
      invertColor: {
        light: false,
        night: false,
      },
    },
  },
  perf: {
    bgSwitchAnim: true,
    dockScale: true,
    bookmark: {
      transparent: true,
      transparency: 15,
      blur: true,
      blurIntensity: 10,
    },
    dialog: {
      transparent: true,
      transparency: 15,
      blur: true,
      blurIntensity: 10,
      animation: true,
    },
    focus: {
      scale: true,
      blur: true,
    },
    quickLinks: {
      transparent: true,
      transparency: 60,
      blur: true,
      blurIntensity: 10,
    },
    searchBar: {
      transparent: true,
      transparency: 50,
      blur: true,
      blurIntensity: 10,
      launchAnim: false,
    },
    yiyan: {
      transparent: true,
      transparency: 80,
      blur: true,
      blurIntensity: 10,
      ripple: true,
    },
    actionBtns: {
      blur: true,
      transparent: true,
      transparency: 90,
      blurIntensity: 5,
    },
  },

  layout: {
    mainPosition: {
      type: 'center',
      value: 30,
    },
    actionBtnPosition: 'bottom-right',
  },

  bookmark: {
    direction: DrawerDirection.rtl,
    rightClickToOpen: true,
    showBtn: true,
    defaultSortMode: SortMode.Original,
  },

  hideMajorChangelog: true,
  readChangeLog: false,
  faviconCacheEnabled: false,

  pluginVersion: '',
  version: CURRENT_CONFIG_VERSION,
} satisfies CURRENT_CONFIG_SCHEMA
