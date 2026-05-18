// 决策矩阵：处理云存储变化并确定适当的操作
import { CURRENT_CONFIG_VERSION } from '@/shared/settings'
import { isSyncEnvelopeV1 } from '@/shared/sync/types'
import type {
  SyncApplyDataMessage,
  SyncConflictMessage,
  SyncLegacyDetectedMessage,
  SyncVersionTooNewMessage,
} from '@/shared/sync/types'

import type { BackgroundState, PendingMessages } from './types'

const debugLog: (...args: unknown[]) => void = import.meta.env.DEV
  ? (...args) => console.log('[sync]', ...args)
  : () => {}

interface DecisionResult {
  action:
    | 'ignore'
    | 'own-write-confirmed'
    | 'legacy-detected'
    | 'version-too-new'
    | 'extend-startup'
    | 'apply-cloud'
    | 'conflict'
    | 'push-stale-device'
    | 'push-local'
  needsDelivery?: boolean
}

export async function evaluateCloudChange(
  cloudRaw: unknown,
  state: BackgroundState,
  pending: PendingMessages,
  sendToNewtab: (
    msg:
      | SyncLegacyDetectedMessage
      | SyncVersionTooNewMessage
      | SyncApplyDataMessage
      | SyncConflictMessage,
  ) => Promise<boolean>,
  openStartupWriteGate: () => void,
): Promise<DecisionResult> {
  if (!isSyncEnvelopeV1(cloudRaw)) {
    debugLog('legacy data detected')
    if (state.isInited) {
      const delivered = await sendToNewtab({ type: 'SYNC_LEGACY_DETECTED' })
      if (!delivered) {
        pending.legacyDetected = true
      }
    } else {
      pending.legacyDetected = true
    }
    return { action: 'legacy-detected' }
  }

  const cloud = cloudRaw

  // 规则 1：自己的写入
  if (cloud.version === state.lastSelfWrittenVersion && cloud.fromDeviceId === state.deviceId) {
    state.lastSelfWrittenVersion = -1
    debugLog('own write confirmed', { version: cloud.version })
    return { action: 'own-write-confirmed' }
  }

  // 规则 2：本设备的历史数据
  if (cloud.fromDeviceId === state.deviceId && cloud.version === state.localVersion) {
    debugLog('own device historical, skip', { version: cloud.version, local: state.localVersion })
    return { action: 'ignore' }
  }

  // 拒绝 configVersion 比此版本更新的云数据
  if (cloud.configVersion > CURRENT_CONFIG_VERSION) {
    debugLog('version too new', { cloud: cloud.configVersion, local: CURRENT_CONFIG_VERSION })
    const versionPayload = { cloud: cloud.configVersion, local: CURRENT_CONFIG_VERSION }
    if (state.isInited) {
      const delivered = await sendToNewtab({
        type: 'SYNC_VERSION_TOO_NEW',
        ...versionPayload,
      } as SyncVersionTooNewMessage)
      if (!delivered) {
        pending.versionTooNew = versionPayload
      }
    } else {
      pending.versionTooNew = versionPayload
    }
    return { action: 'version-too-new' }
  }

  // 规则 3：云为空
  if (cloud.version === 0 && cloud.fromDeviceId === '') {
    return { action: 'extend-startup' }
  }

  // 规则 4-7：真实云数据到达 — 打开写入门
  openStartupWriteGate()

  // 规则 4：云数据更新
  if (cloud.version > state.localVersion) {
    debugLog('cloud is newer, applying', { cloud: cloud.version, local: state.localVersion })
    if (state.isInited) {
      const delivered = await sendToNewtab({
        type: 'SYNC_APPLY_DATA',
        data: cloudRaw,
      } as SyncApplyDataMessage)
      if (!delivered) {
        pending.applyData = cloudRaw
      }
    } else {
      pending.applyData = cloudRaw
    }
    return { action: 'apply-cloud' }
  }

  // 规则 5：冲突
  if (cloud.version === state.localVersion && cloud.fromDeviceId !== state.deviceId) {
    debugLog('conflict', { version: cloud.version, device: cloud.fromDeviceId })
    const conflictPayload: SyncConflictMessage['payload'] = {
      cloud: {
        lastUpdate: cloud.lastUpdate,
        fromDeviceName: cloud.fromDeviceName,
        fromDeviceId: cloud.fromDeviceId,
      },
      local: { localModifiedAt: state.localModifiedAt },
    }
    if (state.isInited) {
      const delivered = await sendToNewtab({
        type: 'SYNC_CONFLICT',
        payload: conflictPayload,
      } as SyncConflictMessage)
      if (!delivered) {
        pending.conflict = conflictPayload
      }
    } else {
      pending.conflict = conflictPayload
    }
    return { action: 'conflict' }
  }

  // 规则 6：旧设备覆盖
  if (
    cloud.version < state.localVersion &&
    cloud.baseVersion < state.localVersion &&
    cloud.fromDeviceId !== state.deviceId
  ) {
    debugLog('stale-device overwrite detected, correcting', {
      cloudVersion: cloud.version,
      cloudBase: cloud.baseVersion,
      local: state.localVersion,
    })
    return { action: 'push-stale-device', needsDelivery: true }
  }

  // 规则 7：云数据已过期
  if (cloud.version < state.localVersion) {
    debugLog('cloud is stale, pushing local', { cloud: cloud.version, local: state.localVersion })
    return { action: 'push-local', needsDelivery: true }
  }

  return { action: 'ignore' }
}
