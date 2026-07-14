import { defineStore, MutationType } from 'pinia'
import { toRaw } from 'vue'

import { browser } from 'wxt/browser'

import { useCustomSearchEngineStore } from '@newtab/shared/customSearchEngine'

import { BgType } from '../enums'
import { defaultQuickLinksData, useQuickLinksStore } from '../quickLinks'
import { ensureSearchEngineAvailable } from '../searchEngines'
import type { QuickLinksData } from '../quickLinks/quickLinksStorage'
import type { CURRENT_CONFIG_SCHEMA, MigratableSettings } from '../settings'
import {
  CURRENT_CONFIG_VERSION,
  defaultSettings,
  migrateSettingsToCurrent,
  useSettingsStore,
} from '../settings'

import { createDeviceId, detectDeviceName } from './device'
import { localSyncMetaStorage } from './syncDataStorage'
import { emitSyncEvent } from './syncEvents'
import { normalizeSyncEnvelope } from './types'
import type {
  LocalSyncMeta,
  SyncApplyDataMessage,
  SyncClearLegacyMessage,
  SyncConflictMessage,
  SyncConflictResolveMessage,
  SyncEnvelopeV2,
  SyncEventPayloadMap,
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
let scheduleDirtySync: ((timestamp?: number) => void) | null = null

const emitSyncError = (err: unknown) => {
  emitSyncEvent('sync-error', toError(err))
}

type SyncSnapshot = {
  rawSettings: CURRENT_CONFIG_SCHEMA
  sanitizedSettings: CURRENT_CONFIG_SCHEMA
  quickLinksData: QuickLinksData
  customSearchEngines: SyncedCustomSearchEngineStorage
}

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
  const quickLinks = ref<QuickLinksData>(structuredClone(defaultQuickLinksData))
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

  const captureSyncSnapshot = (
    localSettings: ReturnType<typeof useSettingsStore>,
    quickLinksStore: ReturnType<typeof useQuickLinksStore>,
    customSearchEngineStore: ReturnType<typeof useCustomSearchEngineStore>,
  ): SyncSnapshot => {
    const rawSettings = structuredClone(localSettings.getRawState())
    return {
      rawSettings,
      sanitizedSettings: sanitizeSettingsForCloud(rawSettings),
      quickLinksData: quickLinksStore.getSnapshot(),
      customSearchEngines: normalizeCustomSearchEngines({
        items: structuredClone(toRaw(customSearchEngineStore.items)),
      }),
    }
  }

  const computeSyncHash = (snapshot: SyncSnapshot): string => {
    return JSON.stringify({
      s: snapshot.sanitizedSettings,
      q: snapshot.quickLinksData,
      e: snapshot.customSearchEngines.items,
    })
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

  const buildPayload = (
    timestamp: number,
    meta: LocalSyncMeta,
    snapshot = captureSyncSnapshot(
      useSettingsStore(),
      useQuickLinksStore(),
      useCustomSearchEngineStore(),
    ),
  ): SyncEnvelopeV2 => {
    const { rawSettings, sanitizedSettings, quickLinksData, customSearchEngines } = snapshot
    return {
      _v: 2,
      configVersion: rawSettings.version,
      fromDeviceId: meta.deviceId,
      fromDeviceName: meta.deviceName,
      lastUpdate: timestamp,
      settings: sanitizedSettings,
      quickLinks: quickLinksData,
      customSearchEngines,
      version: 0,
      baseVersion: 0,
    }
  }

  const sendLocalChanged = async (payload: SyncEnvelopeV2) => {
    const msg: SyncLocalChangedMessage = { type: 'SYNC_LOCAL_CHANGED', data: payload }
    await browser.runtime.sendMessage(msg)
  }

  const resolveConflict = async (choice: SyncConflictResolveMessage['choice']) => {
    conflictDialogVisible.value = false
    conflictPayload.value = null
    try {
      const msg: SyncConflictResolveMessage = { type: 'SYNC_CONFLICT_RESOLVE', choice }
      await browser.runtime.sendMessage(msg)
    } catch (err) {
      emitSyncError(err)
    }
  }

  const handleLegacyDetected = () => {
    const localSettings = useSettingsStore()
    localSettings.sync.enabled = false
    legacyDialogVisible.value = true
    emitSyncEvent('legacy-detected', undefined)
  }

  const applyCloudData = async (cloudInput: unknown) => {
    isProcessing = true
    try {
      const localSettings = useSettingsStore()
      const cloudData = normalizeSyncEnvelope(cloudInput)
      if (!cloudData) {
        handleLegacyDetected()
        return
      }
      const quickLinksStore = useQuickLinksStore()
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
      const { settings: migratedSettings, migrated } = await migrateSettingsToCurrent(
        cloudData.settings as MigratableSettings,
      )
      const mergedSettings = restoreDeviceLocalFields(migratedSettings, localState)

      localSettings.$patch(mergedSettings)
      await quickLinksStore.save(cloudData.quickLinks, {
        groupingEnabled: mergedSettings.quickLinks.grouping,
      })
      const normalizedCustomSearchEngines = normalizeCustomSearchEngines(
        cloudData.customSearchEngines,
      )
      await customSearchEngineStore.save(normalizedCustomSearchEngines)
      ensureSearchEngineAvailable(
        localSettings.search,
        normalizedCustomSearchEngines.items.map((item) => item.id),
      )
      lastSyncHash = computeSyncHash(
        captureSyncSnapshot(localSettings, quickLinksStore, customSearchEngineStore),
      )

      const cloudVersion = cloudData.version ?? 0
      await setLocalSyncMeta({
        lastSyncedAt: cloudData.lastUpdate,
        localModifiedAt: cloudData.lastUpdate,
        localVersion: cloudVersion,
      })
      lastUpdate.value = cloudData.lastUpdate

      // If settings were migrated to a newer schema, push the migrated version back
      if (migrated) {
        scheduleDirtySync?.(Date.now())
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
      const quickLinksStore = useQuickLinksStore()
      const customSearchEngineStore = useCustomSearchEngineStore()
      isProcessing = true
      // Handle messages from background; hoisted so the catch block can remove it on error.
      let handleBackgroundMessage: ((message: unknown) => Promise<void>) | undefined

      try {
        await Promise.all([quickLinksStore.init(), customSearchEngineStore.init()])

        const meta = await ensureDeviceMeta()

        // Initialise sync store refs from *local* state — never from the browser's potentially
        // stale cloud cache. applyCloudData() will update these once background decides to apply.
        const initSnapshot = captureSyncSnapshot(
          localSettings,
          quickLinksStore,
          customSearchEngineStore,
        )
        settings.value = structuredClone(initSnapshot.rawSettings)
        quickLinks.value = initSnapshot.quickLinksData
        lastUpdate.value = meta.lastSyncedAt

        // Send SYNC_INITED with the current local snapshot so background can run
        // processSyncQueue immediately (covers SW-restart + watch()-missed-update cases).
        const initPayload = buildPayload(meta.localModifiedAt, meta, initSnapshot)
        const syncInitedMessage: SyncInitedMessage = { type: 'SYNC_INITED', payload: initPayload }

        handleBackgroundMessage = async (message: unknown) => {
          if (!hasStringType(message)) return

          if (message.type === 'SYNC_APPLY_DATA' && 'data' in message) {
            const { data } = message as SyncApplyDataMessage
            await applyCloudData(data)
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

        let prevSyncEnabled = localSettings.sync.enabled
        lastSyncHash = computeSyncHash(initSnapshot)
        let dirtyVersion = 0
        let lastChangedAt = 0
        let debounceTimer: ReturnType<typeof setTimeout> | null = null

        const flushLocalChanges = async () => {
          debounceTimer = null
          if (generation !== initGeneration || !initialized || !localSettings.sync.enabled) {
            return
          }
          if (isProcessing) {
            debounceTimer = setTimeout(() => void flushLocalChanges(), 2000)
            return
          }

          const versionAtStart = dirtyVersion
          const timestamp = lastChangedAt
          const snapshot = captureSyncSnapshot(
            localSettings,
            quickLinksStore,
            customSearchEngineStore,
          )
          const syncHash = computeSyncHash(snapshot)
          if (syncHash === lastSyncHash) return

          try {
            const meta = await setLocalSyncMeta({ localModifiedAt: timestamp })
            if (generation !== initGeneration || !localSettings.sync.enabled) return
            await sendLocalChanged(buildPayload(timestamp, meta, snapshot))
            lastSyncHash = syncHash
          } catch (err) {
            emitSyncError(err)
          } finally {
            if (versionAtStart !== dirtyVersion) {
              if (debounceTimer) clearTimeout(debounceTimer)
              debounceTimer = setTimeout(() => void flushLocalChanges(), 2000)
            }
          }
        }

        const markLocalDirty = (timestamp = Date.now()) => {
          dirtyVersion += 1
          lastChangedAt = timestamp
          if (debounceTimer) clearTimeout(debounceTimer)
          debounceTimer = setTimeout(() => void flushLocalChanges(), 2000)
        }
        scheduleDirtySync = markLocalDirty

        const subChange = () => {
          const nowEnabled = localSettings.sync.enabled

          if (isProcessing) {
            prevSyncEnabled = nowEnabled
            return
          }

          if (!nowEnabled) return

          if (!prevSyncEnabled && nowEnabled) {
            prevSyncEnabled = true
            markLocalDirty()
            return
          }

          prevSyncEnabled = nowEnabled

          markLocalDirty()
        }

        const unsubSettings = localSettings.$subscribe(subChange)

        const onStateMutation = (mutation: { type: MutationType }) => {
          if (mutation.type !== MutationType.direct) {
            // 防止刚开就认为数据过旧，只有 init 会整个替换 state
            return
          }
          subChange()
        }

        const unsubQuickLink = quickLinksStore.$subscribe(onStateMutation)
        const unsubCustomSearchEngine = customSearchEngineStore.$subscribe(onStateMutation)

        const nextCleanupFns = [
          () => browser.runtime.onMessage.removeListener(handleBackgroundMessage!),
          unsubSettings,
          unsubQuickLink,
          unsubCustomSearchEngine,
          () => {
            if (debounceTimer) clearTimeout(debounceTimer)
            debounceTimer = null
            if (scheduleDirtySync === markLocalDirty) scheduleDirtySync = null
          },
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
      await sendLocalChanged(payload)
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
      await sendLocalChanged(payload)
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
    await resolveConflict('cloud')
  }

  const useLocalConflictData = async () => {
    await resolveConflict('local')
  }

  const disableSyncAndDismissConflict = () => {
    const localSettings = useSettingsStore()
    localSettings.sync.enabled = false
    conflictDialogVisible.value = false
    conflictPayload.value = null
  }

  return {
    settings,
    quickLinks,
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
