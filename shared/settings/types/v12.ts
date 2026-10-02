import type { SearchSuggestionProviderId } from '../../searchSuggestionProviders'

import type { SettingsSchemaV11 } from './v11'

export interface SettingsSchemaV12 extends Omit<
  SettingsSchemaV11,
  'version' | 'background' | 'search'
> {
  version: 12
  search: SettingsSchemaV11['search'] & {
    suggestionProviders: SearchSuggestionProviderId[]
    browserHistoryLimit: number
  }
  background: Omit<SettingsSchemaV11['background'], 'local' | 'localDark'> & {
    solid: { light: string; dark: string }
    rotation: { enabled: boolean; order: 'random' | 'ordered' }
  }
}
