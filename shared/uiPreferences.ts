import { storage } from '#imports'

import { coordinateStorage, withSyncWriteLock } from '@/shared/storage/syncWrite'

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
  return withSyncWriteLock(async () => {
    const current = await rawStorage.getValue()
    const next: UiPreferencesV1 = { ...current, ...changes, version: 1 }
    if (
      next.version !== current.version ||
      next.language !== current.language ||
      next.colorMode !== current.colorMode
    ) {
      await rawStorage.setValue(next)
    }
    return next
  })
}
