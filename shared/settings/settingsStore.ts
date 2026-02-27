import { defineStore } from 'pinia'

import type { CURRENT_CONFIG_INTERFACE } from '../settings'
import { defaultSettings } from '../settings'
import { settingsStorage } from './settingsStorage'

export async function initSettings() {
  const settings = await settingsStorage.getValue()
  console.log('[Settings] Initializing settings storage with config version', settings.version)

  // 清除过期的 blob url，避免使用失效的 URL
  settings.background.local.url = ''
  settings.background.localDark.url = ''
  settings.background.bing.url = ''

  useSettingsStore().$patch(settings)
}

export async function saveSettings(
  settings?: CURRENT_CONFIG_INTERFACE | { $state?: CURRENT_CONFIG_INTERFACE }
) {
  let toSave: CURRENT_CONFIG_INTERFACE | undefined

  if (!settings) {
    toSave = useSettingsStore().$state
  } else if ((settings as unknown as { $state?: CURRENT_CONFIG_INTERFACE }).$state) {
    toSave = (settings as unknown as { $state?: CURRENT_CONFIG_INTERFACE }).$state
  } else {
    toSave = settings as CURRENT_CONFIG_INTERFACE
  }

  await settingsStorage.setValue(toRaw(toSave as CURRENT_CONFIG_INTERFACE))
}

export const useSettingsStore = defineStore('option', {
  state: () => {
    return structuredClone(defaultSettings as CURRENT_CONFIG_INTERFACE)
  }
})
