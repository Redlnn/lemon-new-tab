import { storage } from '#imports'

import type { ColorModePreference } from './webdavSync/types.ts'

export interface UiPreferencesV1 {
  version: 1
  language?: string
  colorMode?: ColorModePreference
}

const defaultUiPreferences: UiPreferencesV1 = { version: 1 }

export const uiPreferencesStorage = storage.defineItem<UiPreferencesV1>('local:uiPreferences', {
  fallback: structuredClone(defaultUiPreferences),
})

let patchTask = Promise.resolve<UiPreferencesV1>(structuredClone(defaultUiPreferences))

export function getUiPreferences(): Promise<UiPreferencesV1> {
  return uiPreferencesStorage.getValue()
}

export function patchUiPreferences(
  patch: Partial<Omit<UiPreferencesV1, 'version'>>,
): Promise<UiPreferencesV1> {
  patchTask = patchTask.then(async () => {
    const current = await uiPreferencesStorage.getValue()
    const next = { ...current, ...patch, version: 1 as const }
    await uiPreferencesStorage.setValue(next)
    return next
  })
  return patchTask
}
