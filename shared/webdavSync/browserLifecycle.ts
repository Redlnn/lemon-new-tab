import { openConfiguredVault } from './browserEngine.ts'
import {
  clearWebDavConnection,
  getOrCreateSyncState,
  patchSyncState,
} from './localState.ts'
import type { LocalSyncStateV1 } from './types.ts'
import { WebDavError } from './webdav.ts'

export const DELETE_REMOTE_CONFIRMATION = 'DELETE WEBDAV DATA'

export async function updateBrowserSyncPreferences(input: {
  scope?: Partial<LocalSyncStateV1['scope']>
}): Promise<LocalSyncStateV1> {
  const state = await getOrCreateSyncState()
  const scope = { ...state.scope, ...input.scope }
  if (!Object.values(scope).some(Boolean)) {
    throw new WebDavError('invalid-response', 'At least one sync category must remain enabled')
  }
  return patchSyncState({ scope })
}

export async function disconnectBrowserWebDav(input: {
  deleteRemote: boolean
  confirmationText?: string
}): Promise<LocalSyncStateV1> {
  const state = await getOrCreateSyncState()
  if (!state.configured) return state
  if (input.deleteRemote) {
    if (input.confirmationText !== DELETE_REMOTE_CONFIRMATION || !state.vaultId) {
      throw new WebDavError('forbidden', 'Remote deletion confirmation is invalid')
    }
    const opened = await openConfiguredVault()
    await opened.repository.deleteOwnedVault(state.vaultId)
  }
  await clearWebDavConnection()
  return getOrCreateSyncState()
}
