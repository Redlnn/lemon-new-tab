import type { SyncEventPayloadMap, SyncEventType } from './types'

export type SyncEventCallback = <T extends SyncEventType>(
  type: T,
  payload: SyncEventPayloadMap[T],
) => void

const syncEventCallbacks = new Set<SyncEventCallback>()

export function addSyncEventCallback(cb: SyncEventCallback): () => void {
  // 同步通知和对话框需要同时监听事件，因此这里使用 Set 支持多订阅者。
  syncEventCallbacks.add(cb)
  return () => syncEventCallbacks.delete(cb)
}

export const emitSyncEvent = <T extends SyncEventType>(
  type: T,
  payload: SyncEventPayloadMap[T],
) => {
  syncEventCallbacks.forEach((cb) => cb(type, payload))
}
