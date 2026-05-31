import { useDebounceFn } from '@vueuse/core'
import { defineStore, MutationType } from 'pinia'
import { toRaw } from 'vue'

import { browser } from 'wxt/browser'

import { useCustomSearchEngineStore } from '@newtab/shared/customSearchEngine'

import { BgType } from '../enums'
import type {
  CURRENT_CONFIG_SCHEMA,
  SettingsSchemaV7,
  SettingsSchemaV8,
  SettingsSchemaV9,
} from '../settings'
import {
  CURRENT_CONFIG_VERSION,
  defaultSettings,
  migrateFromVer7To8,
  migrateFromVer8To9,
  migrateFromVer9To10,
  useSettingsStore,
} from '../settings'
import { defaultShortcuts, useShortcutStore } from '../shortcut'
import type { Shortcuts } from '../shortcut/shortcutStorage'

import { createDeviceId, detectDeviceName } from './device'
import { localSyncMetaStorage } from './syncDataStorage'
import { isSyncEnvelopeV1 } from './types'
import type {
  LocalSyncMeta,
  SyncApplyDataMessage,
  SyncClearLegacyMessage,
  SyncConflictMessage,
  SyncConflictResolveMessage,
  SyncEnvelopeV1,
  SyncEventPayloadMap,
  SyncEventType,
  SyncInitedMessage,
  SyncLocalChangedMessage,
  SyncVersionTooNewMessage,
  SyncedCustomSearchEngineStorage,
} from './types'

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const hasStringType = (value: unknown): value is { type: string } =>
  isObjectRecord(value) && typeof value.type === 'string'

const toError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)))

const debouncedSend = useDebounceFn(async (data: SyncEnvelopeV1) => {
  try {
    const localSettings = useSettingsStore()
    if (!initialized || !localSettings.sync.enabled) {
      return
    }
    const msg: SyncLocalChangedMessage = { type: 'SYNC_LOCAL_CHANGED', data }
    await browser.runtime.sendMessage(msg)
  } catch (err) {
    console.error('Sync to cloud failed:', toError(err))
  }
}, 2000)

// 静默同步标志
// 防止初始化过程中触发 subChange
// 防止 applyCloudData 期间触发 subChange
let isProcessing = false

// 已初始化标志及清理句柄，防止重复 init
let initialized = false
let cleanupFns: (() => void)[] = []
let initPromise: Promise<void> | null = null
let initGeneration = 0
let lastSyncHash: string | null = null

// 事件回调，用于通知 UI 层
export type SyncEventCallback = <T extends SyncEventType>(
  type: T,
  payload: SyncEventPayloadMap[T],
) => void
let syncEventCallback: SyncEventCallback | null = null
export function setSyncEventCallback(cb: SyncEventCallback | null) {
  syncEventCallback = cb
}

const emitSyncEvent = <T extends SyncEventType>(type: T, payload: SyncEventPayloadMap[T]) => {
  syncEventCallback?.(type, payload)
}

const emitSyncError = (err: unknown) => {
  emitSyncEvent('sync-error', toError(err))
}

type MigratableSettings =
  | SettingsSchemaV7
  | SettingsSchemaV8
  | SettingsSchemaV9
  | CURRENT_CONFIG_SCHEMA

const migrations: Partial<
  Record<
    MigratableSettings['version'],
    (s: MigratableSettings) => Promise<MigratableSettings> | MigratableSettings
  >
> = {
  7: (s) => (s.version === 7 ? migrateFromVer7To8(s) : s),
  8: (s) => (s.version === 8 ? migrateFromVer8To9(s) : s),
  9: (s) => (s.version === 9 ? migrateFromVer9To10(s) : s),
}

const BUILTIN_SEARCH_ENGINES = new Set(['google', 'baidu', 'bing', 'yandex', 'duckduckgo'])

const normalizeCustomSearchEngines = (
  input: SyncedCustomSearchEngineStorage,
): SyncedCustomSearchEngineStorage => {
  const seenIds = new Set<string>()
  const items = input.items.filter((item) => {
    if (seenIds.has(item.id)) return false
    if (!item.id.trim() || !item.name.trim() || !item.url.trim()) return false
    seenIds.add(item.id)
    return true
  })
  return { items }
}

export const useSyncDataStore = defineStore('sync', () => {
  const settings = ref<CURRENT_CONFIG_SCHEMA>(structuredClone(defaultSettings))
  const bookmarks = ref<Shortcuts>(structuredClone(defaultShortcuts))
  const lastUpdate = ref(0)

  const legacyDialogVisible = ref(false)
  const conflictDialogVisible = ref(false)
  const conflictPayload = ref<SyncEventPayloadMap['conflict'] | null>(null)

  const ensureDeviceMeta = async (): Promise<LocalSyncMeta> => {
    const current = await localSyncMetaStorage.getValue()
    const next: LocalSyncMeta = {
      ...current,
      deviceId: current.deviceId || createDeviceId(),
      deviceName: current.deviceName || detectDeviceName(),
    }

    if (next.deviceId !== current.deviceId || next.deviceName !== current.deviceName) {
      await localSyncMetaStorage.setValue(next)
    }

    return next
  }

  const setLocalSyncMeta = async (patch: Partial<LocalSyncMeta>): Promise<LocalSyncMeta> => {
    const current = await ensureDeviceMeta()
    const next = { ...current, ...patch }
    await localSyncMetaStorage.setValue(next)
    return next
  }

  const sanitizeSettingsForCloud = (input: CURRENT_CONFIG_SCHEMA): CURRENT_CONFIG_SCHEMA => {
    const sanitized: CURRENT_CONFIG_SCHEMA = {
      ...input,
      background: {
        ...input.background,
        bgType:
          input.background.bgType === BgType.Local || input.background.bgType === BgType.Online
            ? BgType.Bing
            : input.background.bgType,
        local: structuredClone(defaultSettings.background.local),
        localDark: structuredClone(defaultSettings.background.localDark),
        bing: structuredClone(defaultSettings.background.bing),
        online: { ...input.background.online, url: defaultSettings.background.online.url },
      },
      yiyan: {
        ...input.yiyan,
        customLines: defaultSettings.yiyan.customLines,
      },
      pluginVersion: defaultSettings.pluginVersion,
      readChangeLog: defaultSettings.readChangeLog,
    }
    return sanitized
  }

  const computeSyncHash = (
    localSettings: ReturnType<typeof useSettingsStore>,
    shortcutStore: ReturnType<typeof useShortcutStore>,
    customSearchEngineStore: ReturnType<typeof useCustomSearchEngineStore>,
  ): string => {
    const rawSettings = localSettings.getRawState()
    const sanitizedSettings = sanitizeSettingsForCloud(rawSettings)
    const bookmarksData = {
      items: toRaw(shortcutStore.items),
      groups: toRaw(shortcutStore.groups),
    }
    const customEnginesData = toRaw(customSearchEngineStore.items)
    return JSON.stringify({ s: sanitizedSettings, b: bookmarksData, e: customEnginesData })
  }

  const restoreDeviceLocalFields = (
    cloudSettings: CURRENT_CONFIG_SCHEMA,
    localSettings: CURRENT_CONFIG_SCHEMA,
  ): CURRENT_CONFIG_SCHEMA => {
    const merged = structuredClone(cloudSettings)
    merged.background.bgType = localSettings.background.bgType
    merged.background.local = structuredClone(localSettings.background.local)
    merged.background.localDark = structuredClone(localSettings.background.localDark)
    merged.background.bing = structuredClone(localSettings.background.bing)
    merged.background.online.url = localSettings.background.online.url
    merged.yiyan.customLines = localSettings.yiyan.customLines
    merged.pluginVersion = localSettings.pluginVersion
    merged.readChangeLog = localSettings.readChangeLog
    return merged
  }

  const ensureSearchEngineAvailable = (
    localSettings: ReturnType<typeof useSettingsStore>,
    customSearchEngines: SyncedCustomSearchEngineStorage,
  ) => {
    const { engine } = localSettings.search
    if (BUILTIN_SEARCH_ENGINES.has(engine)) return
    if (customSearchEngines.items.some((item) => item.id === engine)) return
    localSettings.search.engine = defaultSettings.search.engine
  }

  const migrateCloudSettings = async (settings: MigratableSettings) => {
    let current = settings
    let migrated = false

    while (current.version < CURRENT_CONFIG_VERSION) {
      const migrate = migrations[current.version]
      if (!migrate) {
        throw new Error(`Unsupported cloud config version: ${current.version}`)
      }

      const next = await migrate(current)
      if (next.version <= current.version || next.version > CURRENT_CONFIG_VERSION) {
        throw new Error(`Invalid migration result: ${current.version} -> ${next.version}`)
      }

      current = next
      migrated = true
    }

    if (current.version !== CURRENT_CONFIG_VERSION) {
      throw new Error(`Unexpected cloud config version after migration: ${current.version}`)
    }

    const normalized = current as CURRENT_CONFIG_SCHEMA
    normalized.shortcut.grouping ??= defaultSettings.shortcut.grouping
    normalized.shortcut.pagingLoop ??= defaultSettings.shortcut.pagingLoop

    return {
      settings: normalized,
      migrated,
    }
  }

  const buildPayload = (timestamp: number, meta: LocalSyncMeta): SyncEnvelopeV1 => {
    const localSettings = useSettingsStore()
    const shortcutStore = useShortcutStore()
    const customSearchEngineStore = useCustomSearchEngineStore()

    const rawSettings = localSettings.getRawState()
    const sanitizedSettings = sanitizeSettingsForCloud(rawSettings)
    const bookmarksSnapshot: Shortcuts = {
      items: structuredClone(toRaw(shortcutStore.items)),
      groups: structuredClone(toRaw(shortcutStore.groups)),
    }
    const customSearchEngineSnapshot = normalizeCustomSearchEngines({
      items: structuredClone(toRaw(customSearchEngineStore.items)),
    })

    return {
      _v: 1,
      configVersion: rawSettings.version,
      fromDeviceId: meta.deviceId,
      fromDeviceName: meta.deviceName,
      lastUpdate: timestamp,
      settings: sanitizedSettings,
      bookmarks: bookmarksSnapshot,
      customSearchEngines: customSearchEngineSnapshot,
      version: 0,
      baseVersion: 0,
    }
  }

  const handleLegacyDetected = () => {
    const localSettings = useSettingsStore()
    localSettings.sync.enabled = false
    legacyDialogVisible.value = true
    emitSyncEvent('legacy-detected', undefined)
  }

  const applyCloudData = async (cloudInput: SyncEnvelopeV1) => {
    isProcessing = true
    try {
      const localSettings = useSettingsStore()
      const cloudData = cloudInput
      if (!isSyncEnvelopeV1(cloudData)) {
        handleLegacyDetected()
        return
      }
      const shortcutStore = useShortcutStore()
      const customSearchEngineStore = useCustomSearchEngineStore()

      if (cloudData.configVersion > CURRENT_CONFIG_VERSION) {
        localSettings.sync.enabled = false
        emitSyncEvent('version-too-new', {
          cloud: cloudData.configVersion,
          local: CURRENT_CONFIG_VERSION,
        })
        return
      }

      const localState = structuredClone(localSettings.getRawState())
      const { settings: migratedSettings, migrated } = await migrateCloudSettings(
        cloudData.settings as MigratableSettings,
      )
      const mergedSettings = restoreDeviceLocalFields(migratedSettings, localState)

      localSettings.$patch(mergedSettings)
      await shortcutStore.save(cloudData.bookmarks, {
        groupingEnabled: mergedSettings.shortcut.grouping,
      })
      const normalizedCustomSearchEngines = normalizeCustomSearchEngines(
        cloudData.customSearchEngines,
      )
      await customSearchEngineStore.save(normalizedCustomSearchEngines)
      ensureSearchEngineAvailable(localSettings, normalizedCustomSearchEngines)
      lastSyncHash = computeSyncHash(localSettings, shortcutStore, customSearchEngineStore)

      const cloudVersion = cloudData.version ?? 0
      await setLocalSyncMeta({
        lastSyncedAt: cloudData.lastUpdate,
        localModifiedAt: cloudData.lastUpdate,
        localVersion: cloudVersion,
      })
      lastUpdate.value = cloudData.lastUpdate

      // If settings were migrated to a newer schema, push the migrated version back
      if (migrated) {
        const meta = await localSyncMetaStorage.getValue()
        debouncedSend(buildPayload(Date.now(), meta))
      }
    } catch (err) {
      emitSyncError(err)
    } finally {
      isProcessing = false
    }
  }

  const init = async () => {
    if (initPromise) {
      await initPromise
      if (initialized) {
        return
      }
    }

    if (initialized) {
      return
    }

    const generation = ++initGeneration

    const currentInit = (async () => {
      const localSettings = useSettingsStore()
      const shortcutStore = useShortcutStore()
      const customSearchEngineStore = useCustomSearchEngineStore()
      isProcessing = true
      // Handle messages from background; hoisted so the catch block can remove it on error.
      let handleBackgroundMessage: ((message: unknown) => Promise<void>) | undefined

      try {
        const meta = await ensureDeviceMeta()

        // Initialise sync store refs from *local* state — never from the browser's potentially
        // stale cloud cache. applyCloudData() will update these once background decides to apply.
        settings.value = structuredClone(localSettings.getRawState())
        bookmarks.value = {
          items: structuredClone(toRaw(shortcutStore.items)),
          groups: structuredClone(toRaw(shortcutStore.groups)),
        }
        lastUpdate.value = meta.lastSyncedAt

        // Send SYNC_INITED with the current local snapshot so background can run
        // processSyncQueue immediately (covers SW-restart + watch()-missed-update cases).
        const initPayload = buildPayload(meta.localModifiedAt, meta)
        const syncInitedMessage: SyncInitedMessage = { type: 'SYNC_INITED', payload: initPayload }

        handleBackgroundMessage = async (message: unknown) => {
          if (!hasStringType(message)) return

          if (message.type === 'SYNC_APPLY_DATA' && 'data' in message) {
            const { data } = message as SyncApplyDataMessage
            if (isSyncEnvelopeV1(data)) {
              await applyCloudData(data)
            }
          } else if (message.type === 'SYNC_CONFLICT' && 'payload' in message) {
            const { payload } = message as SyncConflictMessage
            conflictPayload.value = payload
            conflictDialogVisible.value = true
            emitSyncEvent('conflict', payload)
          } else if (message.type === 'SYNC_LEGACY_DETECTED') {
            handleLegacyDetected()
          } else if (message.type === 'SYNC_VERSION_TOO_NEW') {
            const msg = message as SyncVersionTooNewMessage
            localSettings.sync.enabled = false
            emitSyncEvent('version-too-new', { cloud: msg.cloud, local: msg.local })
          }
        }

        if (generation !== initGeneration) {
          return
        }

        // Register BEFORE awaiting sendMessage: background may flush pendingApplyData/pendingConflict
        // during the SYNC_INITED response, and newtab must already be listening when those arrive.
        browser.runtime.onMessage.addListener(handleBackgroundMessage)

        if (generation !== initGeneration) {
          browser.runtime.onMessage.removeListener(handleBackgroundMessage)
          return
        }

        await browser.runtime.sendMessage(syncInitedMessage)

        // Cheap change-detection: only serialize sync-relevant data when checking for changes
        let prevSyncEnabled = localSettings.sync.enabled
        lastSyncHash = computeSyncHash(localSettings, shortcutStore, customSearchEngineStore)

        const subChange = async () => {
          const nowEnabled = localSettings.sync.enabled

          if (isProcessing) {
            prevSyncEnabled = nowEnabled
            return
          }

          if (!nowEnabled) return

          const syncHash = computeSyncHash(localSettings, shortcutStore, customSearchEngineStore)

          if (!prevSyncEnabled && nowEnabled) {
            prevSyncEnabled = true
            lastSyncHash = syncHash
            const timestamp = Date.now()
            const meta = await setLocalSyncMeta({ localModifiedAt: timestamp })
            debouncedSend(buildPayload(timestamp, meta))
            return
          }

          prevSyncEnabled = nowEnabled

          if (syncHash === lastSyncHash) {
            return
          }

          lastSyncHash = syncHash
          const timestamp = Date.now()
          const meta = await setLocalSyncMeta({ localModifiedAt: timestamp })
          debouncedSend(buildPayload(timestamp, meta))
        }

        const unsubSettings = localSettings.$subscribe(subChange)

        const onStateMutation = async (mutation: { type: MutationType }) => {
          if (mutation.type !== MutationType.direct) {
            // 防止刚开就认为数据过旧，只有 init 会整个替换 state
            return
          }
          await subChange()
        }

        const unsubShortcut = shortcutStore.$subscribe(onStateMutation)
        const unsubCustomSearchEngine = customSearchEngineStore.$subscribe(onStateMutation)

        const nextCleanupFns = [
          () => browser.runtime.onMessage.removeListener(handleBackgroundMessage!),
          unsubSettings,
          unsubShortcut,
          unsubCustomSearchEngine,
        ]

        if (generation !== initGeneration) {
          nextCleanupFns.forEach((fn) => fn())
          return
        }

        cleanupFns = nextCleanupFns
        initialized = true
      } catch (err) {
        // Clean up the message listener if it was registered before the error
        if (handleBackgroundMessage) {
          browser.runtime.onMessage.removeListener(handleBackgroundMessage)
        }
        emitSyncError(err)
      } finally {
        isProcessing = false
      }
    })()

    initPromise = currentInit
    try {
      await currentInit
    } finally {
      if (initPromise === currentInit) {
        initPromise = null
      }
    }
  }

  const deinit = () => {
    initGeneration += 1
    cleanupFns.forEach((fn) => fn())
    cleanupFns = []
    conflictDialogVisible.value = false
    conflictPayload.value = null
    legacyDialogVisible.value = false
    initialized = false
  }

  const syncToCloud = async () => {
    try {
      const localSettings = useSettingsStore()
      if (!localSettings.sync.enabled) return
      const timestamp = Date.now()
      const meta = await setLocalSyncMeta({ localModifiedAt: timestamp })
      const payload = buildPayload(timestamp, meta)
      const msg: SyncLocalChangedMessage = { type: 'SYNC_LOCAL_CHANGED', data: payload }
      await browser.runtime.sendMessage(msg)
    } catch (err) {
      emitSyncError(err)
    }
  }

  const clearLegacyAndReinitialize = async () => {
    const localSettings = useSettingsStore()
    isProcessing = true
    try {
      localSettings.sync.enabled = true
      legacyDialogVisible.value = false
      // Tell background to clear the legacy envelope and reset its version state
      const clearMsg: SyncClearLegacyMessage = { type: 'SYNC_CLEAR_LEGACY' }
      await browser.runtime.sendMessage(clearMsg)
      // Push local data so background writes version=1 on top of the cleared state
      const meta = await ensureDeviceMeta()
      const timestamp = Date.now()
      await setLocalSyncMeta({ localModifiedAt: timestamp })
      const payload = buildPayload(timestamp, meta)
      const msg: SyncLocalChangedMessage = { type: 'SYNC_LOCAL_CHANGED', data: payload }
      await browser.runtime.sendMessage(msg)
    } catch (err) {
      emitSyncError(err)
    } finally {
      isProcessing = false
    }
  }

  const dismissLegacyDialog = () => {
    legacyDialogVisible.value = false
  }

  const useCloudConflictData = async () => {
    conflictDialogVisible.value = false
    conflictPayload.value = null
    try {
      const msg: SyncConflictResolveMessage = { type: 'SYNC_CONFLICT_RESOLVE', choice: 'cloud' }
      await browser.runtime.sendMessage(msg)
    } catch (err) {
      emitSyncError(err)
    }
  }

  const useLocalConflictData = async () => {
    conflictDialogVisible.value = false
    conflictPayload.value = null
    try {
      const msg: SyncConflictResolveMessage = { type: 'SYNC_CONFLICT_RESOLVE', choice: 'local' }
      await browser.runtime.sendMessage(msg)
    } catch (err) {
      emitSyncError(err)
    }
  }

  const disableSyncAndDismissConflict = () => {
    const localSettings = useSettingsStore()
    localSettings.sync.enabled = false
    conflictDialogVisible.value = false
    conflictPayload.value = null
  }

  return {
    settings,
    bookmarks,
    lastUpdate,
    legacyDialogVisible,
    conflictDialogVisible,
    conflictPayload,
    init,
    deinit,
    syncToCloud,
    applyCloudData,
    clearLegacyAndReinitialize,
    dismissLegacyDialog,
    useCloudConflictData,
    useLocalConflictData,
    disableSyncAndDismissConflict,
  }
})
