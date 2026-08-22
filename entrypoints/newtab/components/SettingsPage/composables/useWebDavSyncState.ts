import {
  DEFAULT_SYNC_SCOPE,
  webDavSyncStateStorage,
} from '@/shared/webdavSync/localState'
import type { LocalSyncStateV1 } from '@/shared/webdavSync/types'

const state = shallowRef<LocalSyncStateV1>({
  configured: false,
  paused: false,
  deviceId: '',
  deviceName: '',
  resourceOmissions: [],
  scope: { ...DEFAULT_SYNC_SCOPE },
  encrypted: false,
})

let initialized = false

export function useWebDavSyncState() {
  if (!initialized) {
    initialized = true
    void webDavSyncStateStorage.getValue().then((value) => {
      state.value = value
    })
    webDavSyncStateStorage.watch((value) => {
      state.value = value
    })
  }
  return readonly(state)
}
