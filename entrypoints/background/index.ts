import { defineBackground } from '#imports'
import { browser } from 'wxt/browser'

import { isWebDavSyncMessage } from '@/shared/webdavSync/bridge'
import { createSyncConflictDetails } from '@/shared/webdavSync/conflictDetails'
import { SyncCoordinator } from '@/shared/webdavSync/coordinator'
import {
  getStoredConflict,
  getOrCreateSyncState,
  webDavSyncConfigStorage,
} from '@/shared/webdavSync/localState'
import { hasExactWebDavPermission } from '@/shared/webdavSync/permissions'
import type { LocalSyncStateV1 } from '@/shared/webdavSync/types'
import { serializeWebDavError, WebDavError } from '@/shared/webdavSync/webdav'

const SYNC_DATA_KEYS = new Set([
  'settings',
  'quickLinks',
  'customSearchEngine',
  'uiPreferences',
  'blockedTopStites',
])

export default defineBackground(() => {
  let applyingRemote = false
  let configured = false
  let maintenance = false
  const coordinator = new SyncCoordinator({
    isConfigured: async (trigger) => {
      const config = await webDavSyncConfigStorage.getValue()
      configured = Boolean(config)
      if (!config || maintenance) return false
      const state = await getOrCreateSyncState()
      return Boolean(state.configured && (config.rememberPassword || trigger === 'manual'))
    },
    synchronize: async () => {
      const { synchronizeBrowser } = await import('@/shared/webdavSync/browserEngine')
      await synchronizeBrowser()
    },
  })
  const runMaintenance = async <T>(task: () => Promise<T>): Promise<T> => {
    maintenance = true
    await coordinator.trigger('manual')
    try {
      return await task()
    } finally {
      maintenance = false
      void coordinator.trigger('natural')
    }
  }
  const scheduleConfiguredDataChange = () => {
    if (configured) coordinator.dataChanged()
  }
  void webDavSyncConfigStorage.getValue().then((value) => {
    configured = Boolean(value)
  })

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    if (changes.webdavSyncConfig) configured = Boolean(changes.webdavSyncConfig.newValue)
    const stateChange = changes.webdavSyncState
    if (stateChange?.newValue) {
      const state = stateChange.newValue as LocalSyncStateV1
      applyingRemote = state.pending?.phase === 'applying-local'
    }
    if (!applyingRemote && Object.keys(changes).some((key) => SYNC_DATA_KEYS.has(key))) {
      scheduleConfiguredDataChange()
    }
  })

  browser.runtime.onMessage.addListener(async (message, sender) => {
    if (sender.id && sender.id !== browser.runtime.id) return undefined
    if (!isWebDavSyncMessage(message)) return undefined
    if (message.type === 'webdav-sync:data-changed') {
      scheduleConfiguredDataChange()
      return undefined
    }
    if (message.type === 'webdav-sync:get-state') return getOrCreateSyncState()
    if (message.type === 'webdav-sync:preview-connection') {
      try {
        if (!(await hasExactWebDavPermission(message.input.connection.baseUrl))) {
          throw new WebDavError('forbidden', 'WebDAV host permission is not granted')
        }
        const { previewBrowserWebDavSetup } = await import('@/shared/webdavSync/browserEngine')
        return { ok: true, value: await previewBrowserWebDavSetup(message.input) }
      } catch (error) {
        if (!(error instanceof WebDavError)) throw error
        const safeError = serializeWebDavError(error)
        console.error('[webdav-sync] Connection test failed', safeError)
        return { ok: false, error: safeError }
      }
    }
    if (message.type === 'webdav-sync:connect') {
      const { connectBrowserWebDav } = await import('@/shared/webdavSync/browserEngine')
      return connectBrowserWebDav(message.input, message.expected)
    }
    if (message.type === 'webdav-sync:disconnect') {
      const { disconnectBrowserWebDav } = await import('@/shared/webdavSync/browserLifecycle')
      return runMaintenance(() =>
        disconnectBrowserWebDav({
          deleteRemote: message.deleteRemote,
          confirmationText: message.confirmationText,
        }),
      )
    }
    if (message.type === 'webdav-sync:get-conflict') {
      const stored = await getStoredConflict()
      return stored ? createSyncConflictDetails(stored) : null
    }
    if (message.type === 'webdav-sync:list-history') {
      const { listBrowserSyncHistory } = await import('@/shared/webdavSync/browserManagement')
      return listBrowserSyncHistory()
    }
    if (message.type === 'webdav-sync:preview-history') {
      const { previewBrowserSyncHistory } = await import('@/shared/webdavSync/browserManagement')
      return runMaintenance(() => previewBrowserSyncHistory(message.revisionId))
    }
    if (message.type === 'webdav-sync:list-devices') {
      const { listBrowserSyncDevices } = await import('@/shared/webdavSync/browserManagement')
      return listBrowserSyncDevices()
    }
    if (message.type === 'webdav-sync:inspect-corruption') {
      const { inspectBrowserSyncCorruption } = await import('@/shared/webdavSync/browserManagement')
      return inspectBrowserSyncCorruption()
    }
    if (message.type === 'webdav-sync:download-corruption') {
      const { downloadBrowserCorruptedPayload } =
        await import('@/shared/webdavSync/browserManagement')
      return downloadBrowserCorruptedPayload({
        revisionId: message.revisionId,
        actualPayloadHash: message.actualPayloadHash,
      })
    }
    if (message.type === 'webdav-sync:delete-corruption') {
      const { deleteBrowserCorruptedRevision } =
        await import('@/shared/webdavSync/browserManagement')
      return runMaintenance(() =>
        deleteBrowserCorruptedRevision({
          revisionId: message.revisionId,
          actualPayloadHash: message.actualPayloadHash,
        }),
      )
    }
    if (message.type === 'webdav-sync:resume-apply') {
      const { resumePendingBrowserApply } = await import('@/shared/webdavSync/browserData')
      await resumePendingBrowserApply()
      return getOrCreateSyncState()
    }
    if (message.type === 'webdav-sync:unlock-encryption') {
      const { unlockBrowserEncryption } = await import('@/shared/webdavSync/browserEngine')
      const state = await unlockBrowserEncryption(message.password)
      await coordinator.trigger('manual')
      return state
    }
    if (message.type === 'webdav-sync:resolve-conflict') {
      const { resolveBrowserSyncConflict } = await import('@/shared/webdavSync/browserEngine')
      return runMaintenance(() => resolveBrowserSyncConflict(message.resolutions))
    }
    if (message.type === 'webdav-sync:restore-history') {
      const { restoreBrowserSyncHistory } = await import('@/shared/webdavSync/browserManagement')
      return runMaintenance(() => restoreBrowserSyncHistory(message.revisionId, message.expected))
    }
    if (message.type === 'webdav-sync:repair-corruption') {
      const { repairBrowserSyncCorruption } = await import('@/shared/webdavSync/browserManagement')
      return runMaintenance(() => repairBrowserSyncCorruption(message))
    }
    if (message.type === 'webdav-sync:update-preferences') {
      const { updateBrowserSyncPreferences } = await import('@/shared/webdavSync/browserLifecycle')
      const state = await updateBrowserSyncPreferences({
        scope: message.scope,
      })
      coordinator.dataChanged()
      return state
    }
    const trigger =
      message.type === 'webdav-sync:immediate'
        ? 'manual'
        : message.type === 'webdav-sync:online'
          ? 'online'
          : 'natural'
    await coordinator.trigger(trigger)
    return getOrCreateSyncState()
  })

  void coordinator.trigger('startup')
})
