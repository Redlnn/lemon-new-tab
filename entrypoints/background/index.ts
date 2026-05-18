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

import { evaluateCloudChange } from './decisionMatrix'
import { createQueueScheduler } from './queueScheduler'
import type { BackgroundState, PendingMessages, QueueState } from './types'

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

const queueState: QueueState = {
  isRunning: false,
  lastSyncTime: 0,
  localTimer: null,
  localTimerExpiry: 0,
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

// ─── Message delivery ─────────────────────────────────────────────────────────

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
  const newVersion = state.localVersion + 1
  const envelope: SyncEnvelopeV1 = {
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
  const isCloudEmpty = !isSyncEnvelopeV1(cloudSnapshot) || cloudSnapshot.fromDeviceId === ''

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

async function processCloudChange(cloudRaw: unknown): Promise<void> {
  const result = await evaluateCloudChange(
    cloudRaw,
    state,
    pending,
    sendToNewtab,
    openStartupWriteGate,
  )

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
    return
  }

  if (result.action === 'apply-cloud') {
    state.latestLocalPayload = null
    await updateLocalMeta({
      localVersion: (cloudRaw as SyncEnvelopeV1).version,
      lastSyncedAt: (cloudRaw as SyncEnvelopeV1).lastUpdate,
      localModifiedAt: (cloudRaw as SyncEnvelopeV1).lastUpdate,
    })
    return
  }

  if (result.needsDelivery) {
    if (state.latestLocalPayload !== null) {
      state.pendingImmediatePush = true
      scheduler.scheduleLocalTick(0)
    } else {
      state.pendingImmediatePush = true
    }
  }
}

const scheduler = createQueueScheduler(
  state,
  queueState,
  writeToCloud,
  processCloudChange,
  syncDataStorage,
)

// ─── Message helpers ──────────────────────────────────────────────────────────

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const hasStringType = (value: unknown): value is { type: string } =>
  isObjectRecord(value) && typeof value.type === 'string'

// ─── Background entry point ───────────────────────────────────────────────────

export default defineBackground(() => {
  // 监听云存储变化（来自任何设备或我们自己的写入）
  syncDataStorage.watch(async () => {
    await initPromise
    const cloudRaw = await syncDataStorage.getValue()
    await processCloudChange(cloudRaw)
  })

  browser.runtime.onMessage.addListener(async (message) => {
    await initPromise

    if (!hasStringType(message)) return

    if (message.type === 'SYNC_INITED') {
      // 重新读取元数据：newtab 可能刚创建设备 ID
      const meta = await localSyncMetaStorage.getValue()
      state.deviceId = meta.deviceId
      state.localVersion = meta.localVersion
      state.localModifiedAt = meta.localModifiedAt

      state.isInited = true
      debugLog('newtab inited', { localVersion: state.localVersion, deviceId: state.deviceId })

      // 接受来自 newtab 的初始本地快照（覆盖 SW 重启 + 漏掉的监听情况）
      const initMsg = message as SyncInitedMessage
      if (initMsg.payload && isSyncEnvelopeV1(initMsg.payload)) {
        const incoming = initMsg.payload
        if (
          !state.latestLocalPayload ||
          incoming.lastUpdate >= (state.latestLocalPayload.lastUpdate ?? 0)
        ) {
          state.latestLocalPayload = incoming
        }
      }
      // 如果门打开（或立即推送已排队），现在开始处理
      if (
        state.latestLocalPayload !== null &&
        (state.startupWriteReady || state.pendingImmediatePush)
      ) {
        scheduler.scheduleLocalTick(0)
      }

      // 刷新在 newtab 准备好前排队的任何通知
      // 优先级：legacy > version-too-new > apply > conflict
      if (pending.legacyDetected) {
        const delivered = await sendToNewtab({
          type: 'SYNC_LEGACY_DETECTED',
        } as SyncLegacyDetectedMessage)
        if (delivered) {
          pending.legacyDetected = false
        }
      } else if (pending.versionTooNew) {
        const payload = pending.versionTooNew
        const delivered = await sendToNewtab({
          type: 'SYNC_VERSION_TOO_NEW',
          ...payload,
        } as SyncVersionTooNewMessage)
        if (delivered) {
          pending.versionTooNew = null
        }
      } else if (pending.applyData) {
        const data = pending.applyData
        const delivered = await sendToNewtab({
          type: 'SYNC_APPLY_DATA',
          data,
        } as SyncApplyDataMessage)
        if (delivered) {
          pending.applyData = null
          // 清除初始化有效负载：它现在已过期；newtab 将在应用云数据后重新报告。
          state.latestLocalPayload = null
        }
      } else if (pending.conflict) {
        const payload = pending.conflict
        const delivered = await sendToNewtab({
          type: 'SYNC_CONFLICT',
          payload,
        } as SyncConflictMessage)
        if (delivered) {
          pending.conflict = null
        }
      }
    } else if (message.type === 'SYNC_LOCAL_CHANGED' || message.type === 'SYNC_REQUEST') {
      if (!state.isInited) return

      const reqMsg = message as SyncLocalChangedMessage
      if (!isSyncEnvelopeV1(reqMsg.data)) {
        debugLog('ignored invalid SYNC_LOCAL_CHANGED payload')
        return
      }

      const incoming = reqMsg.data
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

      const elapsed = Date.now() - queueState.lastSyncTime
      scheduler.scheduleLocalTick(elapsed >= 2000 ? 0 : 2000 - elapsed)
    } else if (message.type === 'SYNC_CONFLICT_RESOLVE') {
      if (!state.isInited) return
      const resolveMsg = message as SyncConflictResolveMessage

      if (resolveMsg.choice === 'cloud') {
        const cloudRaw = await syncDataStorage.getValue()
        if (isSyncEnvelopeV1(cloudRaw)) {
          await sendToNewtab({ type: 'SYNC_APPLY_DATA', data: cloudRaw } as SyncApplyDataMessage)
        }
      } else if (resolveMsg.choice === 'local' && state.latestLocalPayload !== null) {
        // 在写入前重新读取云：用户决策时可能有其他设备推送过数据
        const currentCloud = await syncDataStorage.getValue()
        if (isSyncEnvelopeV1(currentCloud) && currentCloud.version > state.localVersion) {
          // 冲突对话期间云变新了；应用它并让用户再次决定
          debugLog('conflict resolve(local): cloud moved ahead, re-evaluating')
          await processCloudChange(currentCloud)
        } else {
          await writeToCloud(state.latestLocalPayload)
          state.latestLocalPayload = null
        }
      }
    } else if (message.type === 'SYNC_CLEAR_LEGACY') {
      // 重新读取云：可能其他设备已将数据迁移到 v1
      const currentCloud = await syncDataStorage.getValue()
      if (isSyncEnvelopeV1(currentCloud)) {
        debugLog('SYNC_CLEAR_LEGACY: cloud is already v1, processing normally')
        await processCloudChange(currentCloud)
        return
      }

      // 云仍为旧版本 — 重置版本跟踪并写入干净的 v1 信封
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
    if (!state.isInited || queueState.isRunning) return
    queueState.isRunning = true
    try {
      await scheduler.processSyncQueue()
    } finally {
      queueState.isRunning = false
      scheduler.schedulePostRunIfNeeded()
    }
  })

  try {
    browser.alarms.create('sync-queue-tick', {
      periodInMinutes: Math.max(2000 / 60_000, 1),
    })
  } catch {
    scheduler.scheduleLocalTick(2000)
  }
})
