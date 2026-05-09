import { defineBackground } from '#imports'
import { browser } from 'wxt/browser'

import { CURRENT_CONFIG_VERSION, defaultSettings } from '@/shared/settings'
import { defaultShortcuts } from '@/shared/shortcut/shortcutStorage'
import { localSyncMetaStorage, syncDataStorage } from '@/shared/sync/syncDataStorage'
import { defaultSyncedCustomSearchEngines, isSyncEnvelopeV1 } from '@/shared/sync/types'
import type {
  SyncApplyDataMessage,
  SyncConflictMessage,
  SyncConflictResolveMessage,
  SyncEnvelopeV1,
  SyncInitedMessage,
  SyncLegacyDetectedMessage,
  SyncLocalChangedMessage,
  SyncMessage,
  SyncVersionTooNewMessage,
} from '@/shared/sync/types'

// ─── Runtime state (reset on each SW restart) ────────────────────────────────

// Loaded from localSyncMetaStorage in initPromise; refreshed on SYNC_INITED
let localVersion = 0
let localDeviceId = ''
let localModifiedAt = 0

// Startup write gate: block normal pushes for 5s (30s when cloud is empty)
// so the browser has time to sync cloud storage before we potentially overwrite it
let startupWriteReady = false
let startupTimer: ReturnType<typeof setTimeout> | null = null

// Latest local payload from newtab; kept as single-latest-item
let latestLocalPayload: SyncEnvelopeV1 | null = null

// Tracks version we just wrote so watch() can recognise our own write and skip re-processing
let lastSelfWrittenVersion = -1

// Set by decision matrix Rule 6/7 when local payload hasn't arrived yet;
// ensures the next SYNC_LOCAL_CHANGED triggers an immediate push
let pendingImmediatePush = false

// Newtab init gate: messages to newtab are held until SYNC_INITED is received
let isInited = false
let pendingApplyData: SyncEnvelopeV1 | null = null
let pendingConflict: SyncConflictMessage['payload'] | null = null
let pendingLegacyDetected = false
let pendingVersionTooNew: { cloud: number; local: number } | null = null

// Sync queue / rate limiting
let isRunning = false
let lastSyncTime = 0
const SYNC_INTERVAL = 2000
const ALARM_NAME = 'sync-queue-tick'
let localTimer: ReturnType<typeof setTimeout> | null = null
let localTimerExpiry = 0

const debugLog: (...args: unknown[]) => void = import.meta.env.DEV
  ? (...args) => console.log('[sync]', ...args)
  : () => {}

// ─── Local meta helper ────────────────────────────────────────────────────────

async function updateLocalMeta(
  patch: Partial<{ localVersion: number; lastSyncedAt: number; localModifiedAt: number }>,
) {
  const current = await localSyncMetaStorage.getValue()
  await localSyncMetaStorage.setValue({ ...current, ...patch })
  if (patch.localVersion !== undefined) localVersion = patch.localVersion
  if (patch.localModifiedAt !== undefined) localModifiedAt = patch.localModifiedAt
}

// ─── Initialization ───────────────────────────────────────────────────────────

const initPromise = (async () => {
  const meta = await localSyncMetaStorage.getValue()
  localVersion = meta.localVersion
  localDeviceId = meta.deviceId
  localModifiedAt = meta.localModifiedAt

  // Check if cloud is empty (never written to) to decide startup window length
  const cloudSnapshot = await syncDataStorage.getValue()
  const isCloudEmpty = !isSyncEnvelopeV1(cloudSnapshot) || cloudSnapshot.fromDeviceId === ''

  const timeoutMs = isCloudEmpty ? 30_000 : 5_000
  startupTimer = setTimeout(() => {
    startupTimer = null
    startupWriteReady = true
    debugLog('startup write gate opened (timeout)', { isCloudEmpty })
    scheduleLocalTick(0)
  }, timeoutMs)

  debugLog('initialized', { localVersion, localDeviceId, isCloudEmpty, timeoutMs })
})()

// ─── Send message to newtab ───────────────────────────────────────────────────

/** Returns true if the message was delivered; false if newtab was not reachable. */
async function sendToNewtab(message: SyncMessage): Promise<boolean> {
  try {
    const [tab] = await browser.tabs.query({ active: true, status: 'complete' })
    if (tab?.id) {
      await browser.tabs.sendMessage(tab.id, message)
      return true
    }
    debugLog('sendToNewtab: no active complete tab')
    return false
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (
      msg.includes('Receiving end does not exist') ||
      msg.includes('Could not establish connection')
    ) {
      debugLog('sendToNewtab skipped: no receiver')
      return false
    }
    console.warn('[sync] Failed to send message to newtab', err)
    return false
  }
}

// ─── Write to cloud ───────────────────────────────────────────────────────────

async function writeToCloud(payload: SyncEnvelopeV1): Promise<void> {
  const newVersion = localVersion + 1
  const envelope: SyncEnvelopeV1 = {
    ...payload,
    version: newVersion,
    baseVersion: localVersion,
  }

  lastSelfWrittenVersion = newVersion
  try {
    await syncDataStorage.setValue(envelope)
  } catch (err) {
    lastSelfWrittenVersion = -1
    throw err
  }
  await updateLocalMeta({ localVersion: newVersion, lastSyncedAt: envelope.lastUpdate })
  debugLog('wrote to cloud', { version: newVersion, baseVersion: newVersion - 1 })
}

// ─── Decision matrix ──────────────────────────────────────────────────────────

async function processCloudChange(cloudRaw: unknown): Promise<void> {
  if (!isSyncEnvelopeV1(cloudRaw)) {
    // Legacy format (no _v: 1)
    debugLog('legacy data detected')
    if (isInited) {
      const delivered = await sendToNewtab({
        type: 'SYNC_LEGACY_DETECTED',
      } as SyncLegacyDetectedMessage)
      if (!delivered) {
        pendingLegacyDetected = true
        isInited = false
      }
    } else {
      pendingLegacyDetected = true
    }
    return
  }

  const cloud = cloudRaw

  // Rule 1: Own write — watch() fired for data we just wrote; confirm and skip
  if (cloud.version === lastSelfWrittenVersion && cloud.fromDeviceId === localDeviceId) {
    lastSelfWrittenVersion = -1
    debugLog('own write confirmed', { version: cloud.version })
    return
  }

  // Rule 2: Own device historical data already reflected locally
  if (cloud.fromDeviceId === localDeviceId && cloud.version === localVersion) {
    debugLog('own device historical, skip', { version: cloud.version, local: localVersion })
    return
  }

  // Reject cloud data whose configVersion is newer than this build supports
  if (cloud.configVersion > CURRENT_CONFIG_VERSION) {
    debugLog('version too new', { cloud: cloud.configVersion, local: CURRENT_CONFIG_VERSION })
    const versionPayload = { cloud: cloud.configVersion, local: CURRENT_CONFIG_VERSION }
    if (isInited) {
      const delivered = await sendToNewtab({
        type: 'SYNC_VERSION_TOO_NEW',
        ...versionPayload,
      } as SyncVersionTooNewMessage)
      if (!delivered) {
        pendingVersionTooNew = versionPayload
        isInited = false
      }
    } else {
      pendingVersionTooNew = versionPayload
    }
    return
  }

  // Rule 3: Cloud is empty (storage fallback — never written to)
  if (cloud.version === 0 && cloud.fromDeviceId === '') {
    // Extend startup window: browser may still be downloading real cloud data
    if (startupTimer !== null) {
      clearTimeout(startupTimer)
      startupTimer = setTimeout(() => {
        startupTimer = null
        startupWriteReady = true
        debugLog('startup write gate opened (30s after empty cloud)')
        if (latestLocalPayload !== null) {
          scheduleLocalTick(0)
        }
      }, 30_000)
      debugLog('cloud is empty, extending startup window to 30s')
    }
    return
  }

  // Rules 4-7: Real cloud data arrived — open the write gate immediately
  if (startupTimer !== null) {
    clearTimeout(startupTimer)
    startupTimer = null
    startupWriteReady = true
    debugLog('startup write gate opened (real cloud data received)')
  }

  // Rule 4: Cloud is ahead — apply to local
  if (cloud.version > localVersion) {
    debugLog('cloud is newer, applying', { cloud: cloud.version, local: localVersion })
    // Nullify init payload: newtab will re-report its state after applying the fresh cloud data.
    // Without this, processSyncQueue could push the stale pre-apply snapshot as v+1.
    latestLocalPayload = null
    await updateLocalMeta({
      localVersion: cloud.version,
      lastSyncedAt: cloud.lastUpdate,
      localModifiedAt: cloud.lastUpdate,
    })
    if (isInited) {
      const delivered = await sendToNewtab({
        type: 'SYNC_APPLY_DATA',
        data: cloudRaw,
      } as SyncApplyDataMessage)
      if (!delivered) {
        // Newtab closed before we could deliver; queue for next init
        pendingApplyData = cloudRaw
        isInited = false
      }
    } else {
      pendingApplyData = cloudRaw
    }
    return
  }

  // Rule 5: Same version from a different device — conflict
  if (cloud.version === localVersion && cloud.fromDeviceId !== localDeviceId) {
    debugLog('conflict', { version: cloud.version, device: cloud.fromDeviceId })
    const conflictPayload: SyncConflictMessage['payload'] = {
      cloud: {
        lastUpdate: cloud.lastUpdate,
        fromDeviceName: cloud.fromDeviceName,
        fromDeviceId: cloud.fromDeviceId,
      },
      local: { localModifiedAt },
    }
    if (isInited) {
      const delivered = await sendToNewtab({
        type: 'SYNC_CONFLICT',
        payload: conflictPayload,
      } as SyncConflictMessage)
      if (!delivered) {
        pendingConflict = conflictPayload
        isInited = false
      }
    } else {
      pendingConflict = conflictPayload
    }
    return
  }

  // Rule 6: Cloud is behind AND was pushed based on a version older than ours AND from a
  // different device → another device wrote stale data; overwrite it immediately
  if (
    cloud.version < localVersion &&
    cloud.baseVersion < localVersion &&
    cloud.fromDeviceId !== localDeviceId
  ) {
    debugLog('stale-device overwrite detected, correcting', {
      cloudVersion: cloud.version,
      cloudBase: cloud.baseVersion,
      local: localVersion,
    })
    if (latestLocalPayload !== null) {
      pendingImmediatePush = true
      scheduleLocalTick(0)
    } else {
      // Mark for immediate push when newtab sends SYNC_LOCAL_CHANGED
      pendingImmediatePush = true
    }
    return
  }

  // Rule 7: Cloud is behind for any other reason → push local to correct
  if (cloud.version < localVersion) {
    debugLog('cloud is stale, pushing local', { cloud: cloud.version, local: localVersion })
    if (latestLocalPayload !== null) {
      scheduleLocalTick(0)
    } else {
      pendingImmediatePush = true
    }
  }
}

// ─── Sync queue ───────────────────────────────────────────────────────────────

async function processSyncQueue(): Promise<void> {
  if (latestLocalPayload === null) return

  const isImmediate = pendingImmediatePush
  if (!isImmediate && !startupWriteReady) return

  pendingImmediatePush = false

  if (!isImmediate && Date.now() - lastSyncTime < SYNC_INTERVAL) {
    scheduleLocalTick(SYNC_INTERVAL - (Date.now() - lastSyncTime))
    return
  }

  const payload = latestLocalPayload
  latestLocalPayload = null
  lastSyncTime = Date.now()

  // Read-before-write: abort push if cloud was updated while we were waiting
  const currentCloud = await syncDataStorage.getValue()
  if (!isSyncEnvelopeV1(currentCloud)) {
    debugLog('read-before-write: non-v1 cloud data present, skipping push until resolved')
    return
  }
  if (currentCloud.version > localVersion) {
    debugLog('read-before-write: cloud is newer, applying instead of pushing')
    await processCloudChange(currentCloud)
    return
  }

  // No-op guard: skip push if cloud already reflects our latest local state
  if (
    currentCloud.version === localVersion &&
    currentCloud.fromDeviceId === localDeviceId &&
    payload.lastUpdate <= currentCloud.lastUpdate
  ) {
    debugLog('read-before-write: no local changes since last push, skipping')
    return
  }

  await writeToCloud(payload)
}

function scheduleLocalTick(delay = SYNC_INTERVAL) {
  const now = Date.now()
  const desiredExpiry = now + delay

  if (localTimer != null) {
    const remaining = Math.max(localTimerExpiry - now, 0)
    if (delay >= remaining) return
    clearTimeout(localTimer)
    localTimer = null
    localTimerExpiry = 0
  }

  localTimer = setTimeout(
    async () => {
      localTimer = null
      localTimerExpiry = 0
      if (isRunning) return
      isRunning = true
      try {
        await processSyncQueue()
      } finally {
        isRunning = false
      }
    },
    Math.max(0, delay),
  )
  localTimerExpiry = desiredExpiry
}

// ─── Message helpers ──────────────────────────────────────────────────────────

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const hasStringType = (value: unknown): value is { type: string } =>
  isObjectRecord(value) && typeof value.type === 'string'

// ─── Background entry point ───────────────────────────────────────────────────

export default defineBackground(() => {
  // Watch for cloud storage changes (from any device, or from our own writes)
  syncDataStorage.watch(async () => {
    await initPromise
    const cloudRaw = await syncDataStorage.getValue()
    await processCloudChange(cloudRaw)
  })

  browser.runtime.onMessage.addListener(async (message) => {
    await initPromise

    if (!hasStringType(message)) return

    if (message.type === 'SYNC_INITED') {
      // Re-read meta: newtab may have just created the device ID for the first time
      const meta = await localSyncMetaStorage.getValue()
      localDeviceId = meta.deviceId
      localVersion = meta.localVersion
      localModifiedAt = meta.localModifiedAt

      isInited = true
      debugLog('newtab inited', { localVersion, localDeviceId })

      // Accept the initial local snapshot from newtab (covers SW-restart + missed-watch cases)
      const initMsg = message as SyncInitedMessage
      if (initMsg.payload && isSyncEnvelopeV1(initMsg.payload)) {
        const incoming = initMsg.payload
        if (!latestLocalPayload || incoming.lastUpdate >= (latestLocalPayload.lastUpdate ?? 0)) {
          latestLocalPayload = incoming
        }
      }
      // If gate is open (or an immediate push is queued), start processing now
      if (latestLocalPayload !== null && (startupWriteReady || pendingImmediatePush)) {
        scheduleLocalTick(0)
      }

      // Flush any notifications queued before newtab was ready
      // Priority: legacy > version-too-new > apply > conflict
      if (pendingLegacyDetected) {
        pendingLegacyDetected = false
        await sendToNewtab({ type: 'SYNC_LEGACY_DETECTED' } as SyncLegacyDetectedMessage)
      } else if (pendingVersionTooNew) {
        const payload = pendingVersionTooNew
        pendingVersionTooNew = null
        await sendToNewtab({
          type: 'SYNC_VERSION_TOO_NEW',
          ...payload,
        } as SyncVersionTooNewMessage)
      } else if (pendingApplyData) {
        const data = pendingApplyData
        pendingApplyData = null
        // Nullify init payload: it is now stale; newtab will re-report after applying cloud data.
        latestLocalPayload = null
        await sendToNewtab({ type: 'SYNC_APPLY_DATA', data } as SyncApplyDataMessage)
      } else if (pendingConflict) {
        const payload = pendingConflict
        pendingConflict = null
        await sendToNewtab({ type: 'SYNC_CONFLICT', payload } as SyncConflictMessage)
      }
    } else if (message.type === 'SYNC_LOCAL_CHANGED' || message.type === 'SYNC_REQUEST') {
      if (!isInited) return

      const reqMsg = message as SyncLocalChangedMessage
      if (!isSyncEnvelopeV1(reqMsg.data)) {
        debugLog('ignored invalid SYNC_LOCAL_CHANGED payload')
        return
      }

      const incoming = reqMsg.data
      if (!latestLocalPayload || incoming.lastUpdate >= (latestLocalPayload.lastUpdate ?? 0)) {
        latestLocalPayload = incoming
      }
      localModifiedAt = Math.max(localModifiedAt, incoming.lastUpdate)

      if (pendingImmediatePush) {
        // Rule 6/7 triggered before payload arrived; push immediately now
        scheduleLocalTick(0)
        return
      }

      if (!startupWriteReady) return

      const elapsed = Date.now() - lastSyncTime
      scheduleLocalTick(elapsed >= SYNC_INTERVAL ? 0 : SYNC_INTERVAL - elapsed)
    } else if (message.type === 'SYNC_CONFLICT_RESOLVE') {
      if (!isInited) return
      const resolveMsg = message as SyncConflictResolveMessage

      if (resolveMsg.choice === 'cloud') {
        const cloudRaw = await syncDataStorage.getValue()
        if (isSyncEnvelopeV1(cloudRaw)) {
          await sendToNewtab({ type: 'SYNC_APPLY_DATA', data: cloudRaw } as SyncApplyDataMessage)
        }
      } else if (resolveMsg.choice === 'local' && latestLocalPayload !== null) {
        // Re-read cloud before writing: another device may have pushed while the user was deciding
        const currentCloud = await syncDataStorage.getValue()
        if (isSyncEnvelopeV1(currentCloud) && currentCloud.version > localVersion) {
          // Cloud got newer during the conflict dialog; apply it and let the user decide again
          debugLog('conflict resolve(local): cloud moved ahead, re-evaluating')
          await processCloudChange(currentCloud)
        } else {
          await writeToCloud(latestLocalPayload)
          latestLocalPayload = null
        }
      }
    } else if (message.type === 'SYNC_CLEAR_LEGACY') {
      // Re-read cloud: another device may have already migrated the data to v1
      const currentCloud = await syncDataStorage.getValue()
      if (isSyncEnvelopeV1(currentCloud)) {
        debugLog('SYNC_CLEAR_LEGACY: cloud is already v1, processing normally')
        await processCloudChange(currentCloud)
        return
      }

      // Cloud is still legacy — reset version tracking and write a clean v1 envelope
      // so other devices stop seeing the legacy format
      const meta = await localSyncMetaStorage.getValue()
      const envelope: SyncEnvelopeV1 = {
        _v: 1,
        configVersion: CURRENT_CONFIG_VERSION,
        fromDeviceId: meta.deviceId || 'unknown',
        fromDeviceName: meta.deviceName || 'unknown',
        lastUpdate: Date.now(),
        settings: defaultSettings,
        bookmarks: defaultShortcuts,
        customSearchEngines: defaultSyncedCustomSearchEngines,
        version: 0,
        baseVersion: 0,
      }
      lastSelfWrittenVersion = 0
      await updateLocalMeta({ localVersion: 0 })
      await syncDataStorage.setValue(envelope)
      debugLog('legacy cleared, version reset to 0')
    }
  })

  // Alarm-based periodic tick to keep the service worker alive and process queued syncs
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== ALARM_NAME) return
    debugLog('alarm tick')
    if (!isInited || isRunning) return
    isRunning = true
    try {
      await processSyncQueue()
    } finally {
      isRunning = false
    }
  })

  try {
    browser.alarms.create(ALARM_NAME, {
      periodInMinutes: Math.max(SYNC_INTERVAL / 60_000, 1),
    })
  } catch {
    scheduleLocalTick(SYNC_INTERVAL)
  }
})
