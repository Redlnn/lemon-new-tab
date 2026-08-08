import { defineBackground } from '#imports'
import { browser } from 'wxt/browser'

import { defaultQuickLinksData } from '@/shared/quickLinks/quickLinksStorage'
import { CURRENT_CONFIG_VERSION, defaultSettings } from '@/shared/settings'
import { localSyncMetaStorage, syncDataStorage } from '@/shared/sync/syncDataStorage'
import { defaultSyncedCustomSearchEngines, normalizeSyncEnvelope } from '@/shared/sync/types'
import type {
  SyncApplyDataMessage,
  SyncConflictMessage,
  SyncConflictResolvedMessage,
  SyncConflictResolveMessage,
  SyncEnvelopeV2,
  SyncInitedMessage,
  SyncLegacyDetectedMessage,
  SyncLocalChangedMessage,
  SyncMessage,
  SyncVersionTooNewMessage,
} from '@/shared/sync/types'

import { decideCloudChange } from './decisionMatrix'
import { createQueueScheduler } from './queueScheduler'
import type { BackgroundState, PendingMessages } from './types'

// ─── Runtime state (reset on each SW restart) ────────────────────────────────

const state: BackgroundState = {
  localVersion: 0,
  deviceId: '',
  localModifiedAt: 0,
  startupWriteReady: false,
  latestLocalPayload: null,
  lastSelfWrittenVersion: -1,
  pendingImmediatePush: false,
  isInited: false,
}

const pending: PendingMessages = {
  applyData: null,
  conflict: null,
  legacyDetected: false,
  versionTooNew: null,
}

let startupTimer: ReturnType<typeof setTimeout> | null = null

const debugLog: (...args: unknown[]) => void = import.meta.env.DEV
  ? (...args) => console.log('[sync]', ...args)
  : () => {}

// ─── Local meta helper ────────────────────────────────────────────────────────

async function updateLocalMeta(
  patch: Partial<{ localVersion: number; lastSyncedAt: number; localModifiedAt: number }>,
) {
  const current = await localSyncMetaStorage.getValue()
  await localSyncMetaStorage.setValue({ ...current, ...patch })
  if (patch.localVersion !== undefined) state.localVersion = patch.localVersion
  if (patch.localModifiedAt !== undefined) state.localModifiedAt = patch.localModifiedAt
}

function clearLatestPayload(payload: SyncEnvelopeV2 | null) {
  if (payload !== null && state.latestLocalPayload === payload) {
    state.latestLocalPayload = null
  }
}

// ─── Message delivery ─────────────────────────────────────────────────────────

async function sendToNewtab(message: SyncMessage): Promise<boolean> {
  try {
    return (await browser.runtime.sendMessage(message)) === true
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

async function writeToCloud(payload: SyncEnvelopeV2): Promise<void> {
  const newVersion = state.localVersion + 1
  const envelope: SyncEnvelopeV2 = {
    ...payload,
    version: newVersion,
    baseVersion: state.localVersion,
  }

  state.lastSelfWrittenVersion = newVersion
  try {
    await syncDataStorage.setValue(envelope)
  } catch (err) {
    state.lastSelfWrittenVersion = -1
    throw err
  }
  await updateLocalMeta({ localVersion: newVersion, lastSyncedAt: envelope.lastUpdate })
  debugLog('wrote to cloud', { version: newVersion, baseVersion: newVersion - 1 })
}

// ─── Startup write gate ───────────────────────────────────────────────────────

function openStartupWriteGate() {
  if (startupTimer !== null) {
    clearTimeout(startupTimer)
    startupTimer = null
    state.startupWriteReady = true
    debugLog('startup write gate opened (real cloud data received)')
  }
}

// ─── Initialization ───────────────────────────────────────────────────────────

const initPromise = (async () => {
  const meta = await localSyncMetaStorage.getValue()
  state.localVersion = meta.localVersion
  state.deviceId = meta.deviceId
  state.localModifiedAt = meta.localModifiedAt

  // 检查云是否为空（从未写入）以确定启动时间窗口长度
  const cloudSnapshot = await syncDataStorage.getValue()
  const normalizedCloudSnapshot = normalizeSyncEnvelope(cloudSnapshot)
  const isCloudEmpty = !normalizedCloudSnapshot || normalizedCloudSnapshot.fromDeviceId === ''

  const timeoutMs = isCloudEmpty ? 30_000 : 5_000
  startupTimer = setTimeout(() => {
    startupTimer = null
    state.startupWriteReady = true
    debugLog('startup write gate opened (timeout)', { isCloudEmpty })
    scheduler.scheduleLocalTick(0)
  }, timeoutMs)

  debugLog('initialized', {
    localVersion: state.localVersion,
    deviceId: state.deviceId,
    isCloudEmpty,
    timeoutMs,
  })
})()

// ─── Decision matrix & queue ──────────────────────────────────────────────────

async function applyCloudDataToNewtab(cloud: SyncEnvelopeV2): Promise<boolean> {
  const hasNewerPendingCloud = () => {
    const queued = pending.applyData
    return (
      queued !== null &&
      (queued.version > cloud.version ||
        (queued.version === cloud.version && queued.lastUpdate > cloud.lastUpdate))
    )
  }
  const delivered = state.isInited
    ? await sendToNewtab({ type: 'SYNC_APPLY_DATA', data: cloud } as SyncApplyDataMessage)
    : false
  if (!delivered) {
    if (!hasNewerPendingCloud()) pending.applyData = cloud
    return false
  }

  await updateLocalMeta({
    localVersion: cloud.version,
    lastSyncedAt: cloud.lastUpdate,
    localModifiedAt: cloud.lastUpdate,
  })
  if (!hasNewerPendingCloud()) pending.applyData = null
  return true
}

async function processCloudChange(
  cloudRaw: unknown,
  payload: SyncEnvelopeV2 | null,
): Promise<boolean> {
  const result = decideCloudChange(cloudRaw, state)

  if (result.action === 'extend-startup' && startupTimer !== null) {
    clearTimeout(startupTimer)
    startupTimer = setTimeout(() => {
      startupTimer = null
      state.startupWriteReady = true
      debugLog('startup write gate opened (30s after empty cloud)')
      if (state.latestLocalPayload !== null) {
        scheduler.scheduleLocalTick(0)
      }
    }, 30_000)
    debugLog('cloud is empty, extending startup window to 30s')
    return false
  }

  if (result.action === 'legacy-detected') {
    const delivered = state.isInited
      ? await sendToNewtab({ type: 'SYNC_LEGACY_DETECTED' } as SyncLegacyDetectedMessage)
      : false
    pending.legacyDetected = !delivered
    return false
  }

  if (result.action === 'own-write-confirmed') {
    state.lastSelfWrittenVersion = -1
    const cloud = normalizeSyncEnvelope(cloudRaw)
    if (cloud) {
      await updateLocalMeta({ localVersion: cloud.version, lastSyncedAt: cloud.lastUpdate })
    }
    debugLog('own write confirmed', { version: result.version })
    return cloud !== null && payload !== null && payload.lastUpdate <= cloud.lastUpdate
  }

  if (result.action === 'version-too-new') {
    const delivered = state.isInited
      ? await sendToNewtab({
          type: 'SYNC_VERSION_TOO_NEW',
          ...result.payload,
        } as SyncVersionTooNewMessage)
      : false
    if (pending.versionTooNew === null || pending.versionTooNew.cloud <= result.payload.cloud) {
      pending.versionTooNew = delivered ? null : result.payload
    }
    return false
  }

  if (result.action === 'ignore') return false

  openStartupWriteGate()

  if (result.action === 'apply-cloud') {
    return applyCloudDataToNewtab(result.cloud)
  }

  if (result.action === 'conflict') {
    const delivered = state.isInited
      ? await sendToNewtab({
          type: 'SYNC_CONFLICT',
          payload: result.payload,
        } as SyncConflictMessage)
      : false
    if (
      pending.conflict === null ||
      pending.conflict.cloud.lastUpdate <= result.payload.cloud.lastUpdate
    ) {
      pending.conflict = delivered ? null : result.payload
    }
    return false
  }

  if (result.action === 'push-stale-device' || result.action === 'push-local') {
    if (state.latestLocalPayload !== null) {
      state.pendingImmediatePush = true
      scheduler.scheduleLocalTick(0)
    } else {
      state.pendingImmediatePush = true
    }
  }
  return false
}

const scheduler = createQueueScheduler(state, writeToCloud, processCloudChange, syncDataStorage)

async function processCloudChangeAndClear(cloudRaw: unknown): Promise<void> {
  const payload = state.latestLocalPayload
  if (await processCloudChange(cloudRaw, payload)) clearLatestPayload(payload)
}

// ─── Message helpers ──────────────────────────────────────────────────────────

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const hasStringType = (value: unknown): value is { type: string } =>
  isObjectRecord(value) && typeof value.type === 'string'

async function flushPendingMessages(): Promise<void> {
  if (pending.legacyDetected) {
    const delivered = await sendToNewtab({
      type: 'SYNC_LEGACY_DETECTED',
    } as SyncLegacyDetectedMessage)
    if (delivered) {
      pending.legacyDetected = false
    }
    return
  }

  if (pending.versionTooNew) {
    const payload = pending.versionTooNew
    const delivered = await sendToNewtab({
      type: 'SYNC_VERSION_TOO_NEW',
      ...payload,
    } as SyncVersionTooNewMessage)
    if (delivered) {
      pending.versionTooNew = null
    }
    return
  }

  if (pending.applyData) {
    const data = pending.applyData
    const payload = state.latestLocalPayload
    if (await applyCloudDataToNewtab(data)) clearLatestPayload(payload)
    return
  }

  if (pending.conflict) {
    const payload = pending.conflict
    const delivered = await sendToNewtab({
      type: 'SYNC_CONFLICT',
      payload,
    } as SyncConflictMessage)
    if (delivered) {
      pending.conflict = null
    }
  }
}

// ─── Background entry point ───────────────────────────────────────────────────

export default defineBackground(() => {
  // 监听云存储变化（来自任何设备或我们自己的写入）
  syncDataStorage.watch(async () => {
    await initPromise
    const cloudRaw = await syncDataStorage.getValue()
    await processCloudChangeAndClear(cloudRaw)
  })

  browser.runtime.onMessage.addListener(async (message) => {
    await initPromise

    if (!hasStringType(message)) return

    if (message.type === 'SYNC_RESET') {
      state.isInited = false
      await scheduler.reset()
      state.lastSelfWrittenVersion = -1
      pending.applyData = null
      pending.conflict = null
      pending.legacyDetected = false
      pending.versionTooNew = null
    } else if (message.type === 'SYNC_INITED') {
      // 重新读取元数据：newtab 可能刚创建设备 ID
      const meta = await localSyncMetaStorage.getValue()
      state.deviceId = meta.deviceId
      state.localVersion = meta.localVersion
      state.localModifiedAt = meta.localModifiedAt

      state.isInited = true
      debugLog('newtab inited', { localVersion: state.localVersion, deviceId: state.deviceId })

      // 接受来自 newtab 的初始本地快照（覆盖 SW 重启 + 漏掉的监听情况）
      const initMsg = message as SyncInitedMessage
      const initPayload = normalizeSyncEnvelope(initMsg.payload)
      if (initPayload) {
        const incoming = initPayload
        if (
          !state.latestLocalPayload ||
          incoming.lastUpdate >= (state.latestLocalPayload.lastUpdate ?? 0)
        ) {
          state.latestLocalPayload = incoming
        }
      }
      // 先刷新云通知，避免初始化快照与待应用的云数据并发处理。
      // 优先级：legacy > version-too-new > apply > conflict
      await flushPendingMessages()

      // 如果门打开（或立即推送已排队），现在开始处理
      if (
        state.latestLocalPayload !== null &&
        (state.startupWriteReady || state.pendingImmediatePush)
      ) {
        scheduler.scheduleLocalTick(0)
      }
    } else if (message.type === 'SYNC_LOCAL_CHANGED' || message.type === 'SYNC_REQUEST') {
      if (!state.isInited) return

      const reqMsg = message as SyncLocalChangedMessage
      const incoming = normalizeSyncEnvelope(reqMsg.data)
      if (!incoming) {
        debugLog('ignored invalid SYNC_LOCAL_CHANGED payload')
        return
      }

      if (
        !state.latestLocalPayload ||
        incoming.lastUpdate >= (state.latestLocalPayload.lastUpdate ?? 0)
      ) {
        state.latestLocalPayload = incoming
      }
      state.localModifiedAt = Math.max(state.localModifiedAt, incoming.lastUpdate)

      if (state.pendingImmediatePush) {
        // 规则 6/7 在有效负载到达前被触发；现在立即推送
        scheduler.scheduleLocalTick(0)
        return
      }

      if (!state.startupWriteReady) return

      const elapsed = Date.now() - scheduler.getLastSyncTime()
      scheduler.scheduleLocalTick(elapsed >= 2000 ? 0 : 2000 - elapsed)
    } else if (message.type === 'SYNC_CONFLICT_RESOLVE') {
      if (!state.isInited) return
      const resolveMsg = message as SyncConflictResolveMessage
      const payload = state.latestLocalPayload

      if (resolveMsg.choice === 'cloud') {
        const cloudRaw = await syncDataStorage.getValue()
        const cloud = normalizeSyncEnvelope(cloudRaw)
        if (!cloud || !(await applyCloudDataToNewtab(cloud))) return false
        clearLatestPayload(payload)
        return true
      } else if (resolveMsg.choice === 'local' && payload !== null) {
        // 在写入前重新读取云：用户决策时可能有其他设备推送过数据
        const currentCloud = await syncDataStorage.getValue()
        const normalizedCloud = normalizeSyncEnvelope(currentCloud)
        if (normalizedCloud && normalizedCloud.version > state.localVersion) {
          // 冲突对话期间云变新了；应用它并让用户再次决定
          debugLog('conflict resolve(local): cloud moved ahead, re-evaluating')
          if (!(await processCloudChange(normalizedCloud, payload))) return false
          clearLatestPayload(payload)
          return true
        } else {
          await writeToCloud(payload)
          clearLatestPayload(payload)
          await sendToNewtab({ type: 'SYNC_CONFLICT_RESOLVED' } as SyncConflictResolvedMessage)
          return true
        }
      }
      return true
    } else if (message.type === 'SYNC_CLEAR_LEGACY') {
      // 重新读取云：可能其他设备已将数据迁移到 v2
      const currentCloud = await syncDataStorage.getValue()
      const normalizedCloud = normalizeSyncEnvelope(currentCloud)
      if (normalizedCloud) {
        debugLog('SYNC_CLEAR_LEGACY: cloud is already v2, processing normally')
        await processCloudChangeAndClear(normalizedCloud)
        return
      }

      // 云仍为旧版本 — 重置版本跟踪并写入干净的 v2 信封
      // so other devices stop seeing the legacy format
      const meta = await localSyncMetaStorage.getValue()
      const envelope: SyncEnvelopeV2 = {
        _v: 2,
        configVersion: CURRENT_CONFIG_VERSION,
        fromDeviceId: meta.deviceId || 'unknown',
        fromDeviceName: meta.deviceName || 'unknown',
        lastUpdate: Date.now(),
        settings: defaultSettings,
        quickLinks: defaultQuickLinksData,
        customSearchEngines: defaultSyncedCustomSearchEngines,
        version: 0,
        baseVersion: 0,
      }
      state.lastSelfWrittenVersion = 0
      await updateLocalMeta({ localVersion: 0 })
      await syncDataStorage.setValue(envelope)
      debugLog('legacy cleared, version reset to 0')
    }
  })

  // 基于报警的定期心跳以保持 service worker 活动并处理队列中的同步
  browser.alarms.onAlarm.addListener(async (alarm) => {
    const ALARM_NAME = 'sync-queue-tick'
    if (alarm.name !== ALARM_NAME) return
    debugLog('alarm tick')
    if (!state.isInited) return
    await scheduler.run()
  })

  try {
    browser.alarms.create('sync-queue-tick', {
      periodInMinutes: Math.max(2000 / 60_000, 1),
    })
  } catch {
    scheduler.scheduleLocalTick(2000)
  }
})
