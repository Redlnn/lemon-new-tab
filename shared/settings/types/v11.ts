import type { SettingsSchemaV10 } from './v10'

type WithTransparency<T> = T & {
  transparency: number
  blurIntensity: number
}

export interface SettingsSchemaV11 extends Omit<
  SettingsSchemaV10,
  'version' | 'shortcut' | 'clock' | 'search' | 'yiyan' | 'layout' | 'perf'
> {
  clock: SettingsSchemaV10['clock'] & {
    style: SettingsSchemaV10['clock']['style'] & {
      transparency: number
    }
  }

  search: SettingsSchemaV10['search'] & {
    borderRadius: number
  }

  quickLinks: SettingsSchemaV10['shortcut'] & {
    iconBorderRadius: number
  }

  yiyan: SettingsSchemaV10['yiyan'] & {
    borderRadius: number
  }

  layout: SettingsSchemaV10['layout'] & {
    actionBtnBorderRadius: number
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
