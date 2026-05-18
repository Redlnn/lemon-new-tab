import { defineStore } from 'pinia'

import type { CURRENT_CONFIG_SCHEMA } from '../settings'
import { defaultSettings } from '../settings'

import { settingsStorage } from './settingsStorage'

export const useSettingsStore = defineStore('option', () => {
  const state = reactive(structuredClone(defaultSettings as CURRENT_CONFIG_SCHEMA))
  let unwatchStorage: (() => void) | null = null

  const init = async () => {
    const settings = await settingsStorage.getValue()
    console.log('[Settings] Initializing settings storage with config version', settings.version)

    // 清除过期的 blob url，避免使用失效的 URL
    if (settings.background.local.url) settings.background.local.url = ''
    if (settings.background.localDark.url) settings.background.localDark.url = ''
    if (settings.background.bing.url) settings.background.bing.url = ''

    Object.assign(state, settings)

    // 清理之前的 watcher（幂等性）
    unwatchStorage?.()

    // 监听其他标签页对设置的更改，实时同步到当前标签页的 store
    unwatchStorage = settingsStorage.watch((newSettings) => {
      if (!newSettings) return
      Object.assign(state, newSettings)
    })
  }

  const deinit = () => {
    unwatchStorage?.()
    unwatchStorage = null
  }

  const save = async () => {
    await settingsStorage.setValue(toRaw(state))
  }

  // 返回原始（非响应式）底层状态对象，对structuredClone安全
  const getRawState = (): CURRENT_CONFIG_SCHEMA => toRaw(state) as CURRENT_CONFIG_SCHEMA

  return { ...toRefs(state), init, deinit, save, getRawState }
})
