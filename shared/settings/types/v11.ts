import type { BuiltInSearchEngineKey } from '@/shared/searchEngines'

import type { SettingsSchemaV10 } from './v10'

export type BingWallpaperResolution = '1080p' | 'uhd'

type WithTransparency<T> = T & {
  transparency: number
  blurIntensity: number
}

export interface SettingsSchemaV11 extends Omit<
  SettingsSchemaV10,
  | 'version'
  | 'shortcut'
  | 'theme'
  | 'clock'
  | 'search'
  | 'yiyan'
  | 'layout'
  | 'dock'
  | 'perf'
  | 'background'
> {
  background: Omit<SettingsSchemaV10['background'], 'bing'> & {
    showDownloadBtn: boolean
    bing: SettingsSchemaV10['background']['bing'] & {
      resolution: BingWallpaperResolution
      cachedResolution: BingWallpaperResolution | null
    }
  }

  theme: SettingsSchemaV10['theme'] & {
    keepClockVisibleOnIdle: boolean
  }

  clock: SettingsSchemaV10['clock'] & {
    dateSize: number
    style: SettingsSchemaV10['clock']['style'] & {
      transparency: number
    }
  }

  search: SettingsSchemaV10['search'] & {
    borderRadius: number
    builtInEngineOrder: BuiltInSearchEngineKey[]
    hiddenBuiltInEngines: BuiltInSearchEngineKey[]
    suggestionsEnabled: boolean
  }

  quickLinks: SettingsSchemaV10['shortcut'] & {
    iconBorderRadius: number
  }

  yiyan: SettingsSchemaV10['yiyan'] & {
    borderRadius: number
  }

  layout: SettingsSchemaV10['layout'] & {
    actionBtnBorderRadius: number
    globalBorderRadius: number
    minimalModeOnDoubleClick: boolean
  }

  dock: SettingsSchemaV10['dock'] & {
    borderRadius: number
  }

  perf: Omit<
    SettingsSchemaV10['perf'],
    'shortcut' | 'bookmark' | 'dialog' | 'searchBar' | 'yiyan' | 'actionBtns'
  > & {
    bookmark: WithTransparency<SettingsSchemaV10['perf']['bookmark']>
    dialog: WithTransparency<SettingsSchemaV10['perf']['dialog']>
    quickLinks: WithTransparency<SettingsSchemaV10['perf']['shortcut']>
    searchBar: WithTransparency<SettingsSchemaV10['perf']['searchBar']>
    yiyan: WithTransparency<SettingsSchemaV10['perf']['yiyan']>
    actionBtns: WithTransparency<SettingsSchemaV10['perf']['actionBtns']>
  }

  version: 11
}
