// 同步操作的队列调度和速率限制
import { normalizeSyncEnvelope } from '@/shared/sync/types'
import type { SyncEnvelopeV2 } from '@/shared/sync/types'

import type { BackgroundState, QueueState } from './types'

const debugLog: (...args: unknown[]) => void = import.meta.env.DEV
  ? (...args) => console.log('[sync]', ...args)
  : () => {}

const SYNC_INTERVAL = 2000

export function createQueueScheduler(
  state: BackgroundState,
  queueState: QueueState,
  writeToCloud: (payload: SyncEnvelopeV2) => Promise<void>,
  processCloudChange: (cloudRaw: unknown) => Promise<void>,
  syncDataStorage: { getValue: () => Promise<unknown> },
) {
  let rerunRequested = false

  const schedulePostRunIfNeeded = () => {
    if (
      rerunRequested ||
      (state.latestLocalPayload !== null && (state.pendingImmediatePush || state.startupWriteReady))
    ) {
      rerunRequested = false
      scheduleLocalTick(0)
    }
  }

  const scheduleLocalTick = (delay = SYNC_INTERVAL) => {
    const now = Date.now()
    const desiredExpiry = now + delay

    if (queueState.localTimer != null) {
      const remaining = Math.max(queueState.localTimerExpiry - now, 0)
      if (delay >= remaining) return
      clearTimeout(queueState.localTimer)
      queueState.localTimer = null
      queueState.localTimerExpiry = 0
    }

    queueState.localTimer = setTimeout(
      async () => {
        queueState.localTimer = null
        queueState.localTimerExpiry = 0
        if (queueState.isRunning) {
          rerunRequested = true
          return
        }
        queueState.isRunning = true
        try {
          await processSyncQueue()
        } finally {
          queueState.isRunning = false
          schedulePostRunIfNeeded()
        }
      },
      Math.max(0, delay),
    )
    queueState.localTimerExpiry = desiredExpiry
  }

  const processSyncQueue = async (): Promise<void> => {
    if (state.latestLocalPayload === null) return

    const isImmediate = state.pendingImmediatePush
    if (!isImmediate && !state.startupWriteReady) return

    state.pendingImmediatePush = false

    if (!isImmediate && Date.now() - queueState.lastSyncTime < SYNC_INTERVAL) {
      scheduleLocalTick(SYNC_INTERVAL - (Date.now() - queueState.lastSyncTime))
      return
    }

    const payload = state.latestLocalPayload
    state.latestLocalPayload = null
    queueState.lastSyncTime = Date.now()

    // 读前写：如果云在等待期间更新，则中止推送
    const currentCloud = await syncDataStorage.getValue()
    const normalizedCloud = normalizeSyncEnvelope(currentCloud)
    if (!normalizedCloud) {
      debugLog('读前写：非 v2 云数据存在，跳过推送直到解决')
      return
    }
    if (normalizedCloud.version > state.localVersion) {
      debugLog('读前写：云比较新，应用而不是推送')
      await processCloudChange(normalizedCloud)
      return
    }

    // 空操作保护：如果云已反映了我们最新的本地状态，则跳过推送
    if (
      normalizedCloud.version === state.localVersion &&
      normalizedCloud.fromDeviceId === state.deviceId &&
      payload.lastUpdate <= normalizedCloud.lastUpdate
    ) {
      debugLog('读前写：最后一次推送后无本地变化，跳过')
      return
    }

    await writeToCloud(payload)
  }

  return {
    scheduleLocalTick,
    processSyncQueue,
    schedulePostRunIfNeeded,
  }
}
