// 后台脚本状态管理的类型
import type { SyncConflictMessage, SyncEnvelopeV2, SyncMessage } from '@/shared/sync/types'

export interface BackgroundState {
  localVersion: number
  deviceId: string
  localModifiedAt: number
  startupWriteReady: boolean
  latestLocalPayload: SyncEnvelopeV2 | null
  lastSelfWrittenVersion: number
  pendingImmediatePush: boolean
  isInited: boolean
}

export interface QueueState {
  isRunning: boolean
  lastSyncTime: number
  localTimer: ReturnType<typeof setTimeout> | null
  localTimerExpiry: number
}

export interface PendingMessages {
  applyData: SyncEnvelopeV2 | null
  conflict: SyncConflictMessage['payload'] | null
  legacyDetected: boolean
  versionTooNew: { cloud: number; local: number } | null
}

export interface MessageDelivery {
  sendToNewtab: (message: SyncMessage) => Promise<boolean>
}
