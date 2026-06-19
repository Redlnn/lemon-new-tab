import { onScopeDispose } from 'vue'

import { addSyncEventCallback, type SyncEventCallback } from '@/shared/sync/syncEvents'

export function useSyncEventCallback(cb: SyncEventCallback): () => void {
  const stop = addSyncEventCallback(cb)
  onScopeDispose(stop)
  return stop
}
