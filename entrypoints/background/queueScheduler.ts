// 同步操作的队列调度和速率限制
import { normalizeSyncEnvelope } from '@/shared/sync/types'
import type { SyncEnvelopeV2 } from '@/shared/sync/types'

import type { BackgroundState } from './types'

const debugLog: (...args: unknown[]) => void = import.meta.env.DEV
  ? (...args) => console.log('[sync]', ...args)
  : () => {}

const SYNC_INTERVAL = 2000
const MAX_RETRY_DELAY = 60_000

export function createQueueScheduler(
  state: BackgroundState,
  writeToCloud: (payload: SyncEnvelopeV2) => Promise<void>,
  processCloudChange: (cloudRaw: unknown, payload: SyncEnvelopeV2) => Promise<boolean>,
  syncDataStorage: { getValue: () => Promise<unknown> },
) {
  let rerunRequested = false
  let runningTask: Promise<void> | null = null
  let lastSyncTime = 0
  let localTimer: ReturnType<typeof setTimeout> | null = null
  let localTimerExpiry = 0
  let retryDelay = 0
  let retryPayload: SyncEnvelopeV2 | null = null
  let blockedPayload: SyncEnvelopeV2 | null = null

  const schedulePostRunIfNeeded = () => {
    if (state.latestLocalPayload === null || state.latestLocalPayload === blockedPayload) {
      rerunRequested = false
      return
    }
    if (
      rerunRequested ||
      state.pendingImmediatePush ||
      state.startupWriteReady
    ) {
      rerunRequested = false
      scheduleLocalTick(state.latestLocalPayload === retryPayload ? retryDelay : 0)
    }
  }

  const scheduleLocalTick = (delay = SYNC_INTERVAL) => {
    blockedPayload = null
    const now = Date.now()
    const desiredExpiry = now + delay

    if (localTimer !== null) {
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
        if (runningTask) {
          rerunRequested = true
          return
        }
        await run()
      },
      Math.max(0, delay),
    )
    localTimerExpiry = desiredExpiry
  }

  const processSyncQueue = async (): Promise<void> => {
    if (state.latestLocalPayload === null) return

    const isImmediate = state.pendingImmediatePush
    if (!isImmediate && !state.startupWriteReady) return

    state.pendingImmediatePush = false

    if (!isImmediate && Date.now() - lastSyncTime < SYNC_INTERVAL) {
      scheduleLocalTick(SYNC_INTERVAL - (Date.now() - lastSyncTime))
      return
    }

    const payload = state.latestLocalPayload
    const clearPayload = () => {
      if (state.latestLocalPayload === payload) {
        state.latestLocalPayload = null
      }
    }

    try {
      // 读前写：如果云在等待期间更新，则中止推送
      const currentCloud = await syncDataStorage.getValue()
      const normalizedCloud = normalizeSyncEnvelope(currentCloud)
      if (!normalizedCloud) {
        debugLog('读前写：非 v2 云数据存在，等待云变化或重新初始化')
        blockedPayload = payload
        retryDelay = 0
        retryPayload = null
        return
      }
      if (normalizedCloud.version > state.localVersion) {
        debugLog('读前写：云比较新，应用而不是推送')
        if (!(await processCloudChange(normalizedCloud, payload))) {
          blockedPayload = payload
          retryDelay = 0
          retryPayload = null
          return
        }
        clearPayload()
      } else if (
        normalizedCloud.version === state.localVersion &&
        normalizedCloud.fromDeviceId === state.deviceId &&
        payload.lastUpdate <= normalizedCloud.lastUpdate
      ) {
        // 空操作保护：如果云已反映了我们最新的本地状态，则跳过推送
        debugLog('读前写：最后一次推送后无本地变化，跳过')
        clearPayload()
      } else {
        await writeToCloud(payload)
        clearPayload()
      }

      retryDelay = 0
      retryPayload = null
      blockedPayload = null
      lastSyncTime = Date.now()
    } catch (error) {
      blockedPayload = null
      retryDelay = Math.min(retryDelay ? retryDelay * 2 : SYNC_INTERVAL, MAX_RETRY_DELAY)
      retryPayload = payload
      console.warn(`[sync] Sync failed; retrying in ${retryDelay}ms`, error)
    }
  }

  const run = (): Promise<void> => {
    if (state.latestLocalPayload !== null && state.latestLocalPayload === blockedPayload) {
      return Promise.resolve()
    }
    if (runningTask) return runningTask
    runningTask = processSyncQueue().finally(() => {
      runningTask = null
      schedulePostRunIfNeeded()
    })
    return runningTask
  }

  const reset = async () => {
    rerunRequested = false
    if (localTimer) clearTimeout(localTimer)
    localTimer = null
    localTimerExpiry = 0
    retryDelay = 0
    retryPayload = null
    blockedPayload = null
    state.latestLocalPayload = null
    state.pendingImmediatePush = false
    await runningTask
    retryDelay = 0
    retryPayload = null
    blockedPayload = null
  }

  return {
    scheduleLocalTick,
    run,
    reset,
    getLastSyncTime: () => lastSyncTime,
  }
}
