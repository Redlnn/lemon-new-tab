import { CURRENT_CONFIG_VERSION } from '@/shared/settings/current'
import { normalizeSyncEnvelope } from '@/shared/sync/types'
import type { SyncConflictMessage, SyncEnvelopeV2 } from '@/shared/sync/types'

import type { BackgroundState } from './types'

export type CloudDecision =
  | { action: 'legacy-detected' }
  | { action: 'own-write-confirmed'; version: number }
  | { action: 'ignore' }
  | { action: 'version-too-new'; payload: { cloud: number; local: number } }
  | { action: 'extend-startup' }
  | { action: 'apply-cloud'; cloud: SyncEnvelopeV2 }
  | { action: 'conflict'; payload: SyncConflictMessage['payload'] }
  | { action: 'push-stale-device' }
  | { action: 'push-local' }

type DecisionState = Pick<
  BackgroundState,
  'deviceId' | 'lastSelfWrittenVersion' | 'localModifiedAt' | 'localVersion'
>

/** 按固定规则顺序判断云数据，不发送消息也不修改后台状态。 */
export function decideCloudChange(cloudRaw: unknown, state: DecisionState): CloudDecision {
  const cloud = normalizeSyncEnvelope(cloudRaw)
  if (!cloud) return { action: 'legacy-detected' }

  if (cloud.version === state.lastSelfWrittenVersion && cloud.fromDeviceId === state.deviceId) {
    return { action: 'own-write-confirmed', version: cloud.version }
  }

  if (cloud.fromDeviceId === state.deviceId && cloud.version === state.localVersion) {
    return { action: 'ignore' }
  }

  if (cloud.configVersion > CURRENT_CONFIG_VERSION) {
    return {
      action: 'version-too-new',
      payload: { cloud: cloud.configVersion, local: CURRENT_CONFIG_VERSION },
    }
  }

  if (cloud.version === 0 && cloud.fromDeviceId === '') {
    return { action: 'extend-startup' }
  }

  if (cloud.version > state.localVersion) {
    return { action: 'apply-cloud', cloud }
  }

  if (cloud.version === state.localVersion && cloud.fromDeviceId !== state.deviceId) {
    return {
      action: 'conflict',
      payload: {
        cloud: {
          lastUpdate: cloud.lastUpdate,
          fromDeviceName: cloud.fromDeviceName,
          fromDeviceId: cloud.fromDeviceId,
        },
        local: { localModifiedAt: state.localModifiedAt },
      },
    }
  }

  if (
    cloud.version < state.localVersion &&
    cloud.baseVersion < state.localVersion &&
    cloud.fromDeviceId !== state.deviceId
  ) {
    return { action: 'push-stale-device' }
  }

  if (cloud.version < state.localVersion) {
    return { action: 'push-local' }
  }

  return { action: 'ignore' }
}
