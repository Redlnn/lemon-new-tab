import type { SearchSuggestionProviderId } from '../../searchSuggestionProviders'

import type { SettingsSchemaV11 } from './v11'

export interface SettingsSchemaV12 extends Omit<
  SettingsSchemaV11,
  'version' | 'background' | 'search' | 'perf' | 'clock'
> {
  version: 12
  greetingEnabled: boolean
  clock: SettingsSchemaV11['clock'] & {
    gradient: boolean
  }
  perf: SettingsSchemaV11['perf'] & {
    dockEnterAnim: boolean
  }
  search: SettingsSchemaV11['search'] & {
    suggestionProviders: SearchSuggestionProviderId[]
    browserHistoryLimit: number
  }
  background: Omit<SettingsSchemaV11['background'], 'local' | 'localDark'> & {
    solid: { light: string; dark: string }
    rotation: { enabled: boolean; order: 'random' | 'ordered' }
  }
}
