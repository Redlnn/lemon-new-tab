import { storage } from '#imports'

import { coordinateStorage } from '@/shared/storage/syncWrite'

import type { ColorModePreference } from './webdavSync/types.ts'

export interface UiPreferencesV1 {
  version: 1
  language?: string
  colorMode?: ColorModePreference
}

const defaultUiPreferences: UiPreferencesV1 = { version: 1 }

const rawStorage = storage.defineItem<UiPreferencesV1>('local:uiPreferences', {
  fallback: structuredClone(defaultUiPreferences),
})

export const uiPreferencesStorage = coordinateStorage(rawStorage)

export function getUiPreferences(): Promise<UiPreferencesV1> {
  return uiPreferencesStorage.getValue()
}

export function patchUiPreferences(patch: Partial<Omit<UiPreferencesV1, 'version'>>) {
  const changes = structuredClone(patch)
  return uiPreferencesStorage.updateValue((current) => ({
    ...current,
    ...changes,
    version: 1 as const,
  }))
}
