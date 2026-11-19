import type { SearchSuggestionProviderId } from '../../searchSuggestionProviders'

import type { SettingsSchemaV11 } from './v11'

export type MainPositionType =
  | SettingsSchemaV11['layout']['mainPosition']['type']
  | 'bottom-dvh'
  | 'bottom-px'

export interface SettingsSchemaV12 extends Omit<
  SettingsSchemaV11,
  'version' | 'background' | 'search' | 'perf' | 'clock' | 'layout' | 'dock' | 'quickLinks'
> {
  version: 12
  greetingEnabled: boolean
  disableSettingsScrollRestore: boolean
  quickLinks: SettingsSchemaV11['quickLinks'] & {
    hideAddButton: boolean
  }
  dock: SettingsSchemaV11['dock'] & {
    replaceQuickLinks: boolean
    groupId: string
    showOtherGroups: boolean
    folderCount: number
  }
  layout: Omit<SettingsSchemaV11['layout'], 'mainPosition'> & {
    mainPosition: { type: MainPositionType; value: number }
  }
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
  background: Omit<
    SettingsSchemaV11['background'],
    'local' | 'localDark' | 'map' | 'ocean' | 'beach' | 'meadow'
  > & {
    pauseWhenHidden: boolean
    solid: { light: string; dark: string }
    rotation: { enabled: boolean; order: 'random' | 'ordered' }
    dynamic: {
      fps: 25 | 30 | 45 | 60 | 120
      navigationCloudSize: number
      autoNightTheme: boolean
      nightByTime: boolean
      disableEntrance: boolean
    }
    map: {
      trains: number
      ships: number
      islands: number
      showNavigationLake: boolean
      navigationLakeSize: number
    }
    ocean: {
      cloudSize: number
      cloudCover: number
      flow: number
      showNavigationCloud: boolean
      sailboats: number
      yachts: number
      whales: number
      birds: number
      waterCaustics: boolean
      glintDensity: number
    }
    beach: {
      sigma: number
      warp: number
      shoal: number
      shallow: number
      palms: number
      kayaks: number
      birds: number
      showMainIsland: boolean
      waterCaustics: boolean
    }
    meadow: {
      cloudSize: number
      cloudCover: number
      flow: number
      showNavigationCloud: boolean
      showBoy: boolean
      showCat: boolean
      catCount: number
      clickToMove: boolean
    }
  }
}
