import type { SettingsSchemaV9 } from './v9'

export type MainPositionType = 'center' | 'dvh' | 'px'
export type ActionBtnPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface SettingsSchemaV10 extends Omit<SettingsSchemaV9, 'version' | 'search' | 'yiyan'> {
  search: SettingsSchemaV9['search'] & {
    expandWidth: number
  }

  yiyan: SettingsSchemaV9['yiyan'] & {
    customLines: string
  }

  layout: {
    mainPosition: {
      type: MainPositionType
      value: number
    }
    actionBtnPosition: ActionBtnPosition
  }

  version: 10
}
