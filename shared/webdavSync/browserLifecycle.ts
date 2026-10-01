import { openConfiguredVault, createClient } from './browserEngine.ts'
import {
  clearWebDavConnection,
  getOrCreateSyncState,
  patchSyncState,
  saveWebDavPassword,
  webDavSyncConfigStorage,
} from './localState.ts'
import type { LocalSyncStateV1 } from './types.ts'
import { WebDavError, WebDavVaultRepository, requireConfiguredVaultInspection } from './webdav.ts'

export const DELETE_REMOTE_CONFIRMATION = 'DELETE WEBDAV DATA'

export async function updateBrowserWebDavCredentials(input: {
  username?: string
  password: string
  rememberPassword: boolean
}): Promise<LocalSyncStateV1> {
  const config = await webDavSyncConfigStorage.getValue()
  const state = await getOrCreateSyncState()
  if (!config || !state.configured || !input.password)
    throw new WebDavError('authentication', 'WebDAV credentials are required')
  const next = {
    ...config,
    username: input.username?.trim() || config.username,
    rememberPassword: input.rememberPassword,
  }
  const repository = new WebDavVaultRepository(createClient(next, input.password), next.directory)
  requireConfiguredVaultInspection(await repository.inspect(), { vaultId: state.vaultId })
  await saveWebDavPassword(input.password, input.rememberPassword)
  await webDavSyncConfigStorage.setValue(next)
  return patchSyncState({ retry: undefined })
}

export async function updateBrowserSyncPreferences(input: {
  enabled?: boolean
  scope?: Partial<LocalSyncStateV1['scope']>
}): Promise<LocalSyncStateV1> {
  const state = await getOrCreateSyncState()
  const scope = { ...state.scope, ...input.scope }
  return patchSyncState({
    scope,
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
  })
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
