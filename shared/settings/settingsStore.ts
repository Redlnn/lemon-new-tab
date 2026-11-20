import { defineStore } from 'pinia'

import { isChinese } from '@/shared/i18n'
import { jsonEquals } from '@/shared/json'
import { createDraftWriter, withSyncWriteLock } from '@/shared/storage/syncWrite'

import type { CURRENT_CONFIG_SCHEMA } from './current'
import { defaultSettings } from './default'
import { normalizeCurrentSettings } from './normalize'
import { settingsStorage } from './settingsStorage'

export const useSettingsStore = defineStore('option', () => {
  const state = reactive(structuredClone(defaultSettings as CURRENT_CONFIG_SCHEMA))
  let unwatchStorage: (() => void) | null = null
  let applyingStorage = false
  let disposed = false

  const writer = createDraftWriter(
    settingsStorage.raw,
    () => toRaw(state),
    (value) => {
      applyingStorage = true
      try {
        const next = normalizeCurrentSettings(value)
        const reconcile = <K extends keyof CURRENT_CONFIG_SCHEMA>(key: K) => {
          if (!jsonEquals(state[key], next[key])) state[key] = next[key]
        }
        for (const key of Object.keys(next) as (keyof CURRENT_CONFIG_SCHEMA)[]) reconcile(key)
      } finally {
        applyingStorage = false
      }
    },
    toRaw(state),
  )

  const init = async (hasSettings: boolean) => {
    const settings = await withSyncWriteLock(async () => {
      const stored = await settingsStorage.raw.getValue()
      const current = normalizeCurrentSettings(stored)
      const firstRun = !hasSettings
      if (firstRun && !isChinese.value) current.yiyan.enabled = false
      if (firstRun || !jsonEquals(stored, current)) await settingsStorage.raw.setValue(current)
      return current
    })
    if (disposed) return
    console.log('[Settings] Initializing settings storage with config version', settings.version)

    // 清除过期的 blob url，避免使用失效的 URL
    if (settings.background.bing.url) settings.background.bing.url = ''

    writer.reset(settings)

    // 清理之前的 watcher（幂等性）
    unwatchStorage?.()

    // 监听其他标签页对设置的更改，实时同步到当前标签页的 store
    unwatchStorage = settingsStorage.watch((newSettings) => {
      if (!newSettings) return
      writer.receive(newSettings)
    })
  }

  onScopeDispose(() => {
    disposed = true
    unwatchStorage?.()
    unwatchStorage = null
  })

  const save = async () => {
    await writer.save()
  }

  const setDockReplaceQuickLinks = (enabled: boolean) => {
    state.dock.replaceQuickLinks = enabled
    if (enabled) {
      state.dock.enabled = true
      state.quickLinks.enabled = false
    }
  }

  const isApplyingStorage = () => applyingStorage

  return {
    ...toRefs(state),
    init,
    save,
    isDirty: writer.isDirty,
    isApplyingStorage,
    prepareCommit: writer.prepareCommit,
    setDockReplaceQuickLinks,
  }
})
