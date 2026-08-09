import { defineBackground } from '#imports'
import { browser } from 'wxt/browser'

import { isWebDavSyncMessage } from '@/shared/webdavSync/bridge'
import { SyncCoordinator } from '@/shared/webdavSync/coordinator'
import { mergeSyncSnapshots } from '@/shared/webdavSync/merge'
import {
  getStoredConflict,
  getOrCreateSyncState,
  webDavSyncConfigStorage,
} from '@/shared/webdavSync/localState'
import type { LocalSyncStateV1 } from '@/shared/webdavSync/types'

const SYNC_DATA_KEYS = new Set([
  'settings',
  'quickLinks',
  'customSearchEngine',
  'uiPreferences',
  'searchHistories',
  'blockedTopStites',
])

export default defineBackground(() => {
  let applyingRemote = false
  let maintenance = false
  const coordinator = new SyncCoordinator({
    isConfigured: async (trigger) => {
      const [config, state] = await Promise.all([
        webDavSyncConfigStorage.getValue(),
        getOrCreateSyncState(),
      ])
      return Boolean(
        !maintenance &&
        config &&
        state.configured &&
        (config.rememberPassword || trigger === 'manual'),
      )
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

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    const stateChange = changes.webdavSyncState
    if (stateChange?.newValue) {
      const state = stateChange.newValue as LocalSyncStateV1
      applyingRemote = state.pending?.phase === 'applying-local'
    }
    if (!applyingRemote && Object.keys(changes).some((key) => SYNC_DATA_KEYS.has(key))) {
      coordinator.dataChanged()
    }
  })

  browser.runtime.onMessage.addListener(async (message, sender) => {
    if (sender.id && sender.id !== browser.runtime.id) return undefined
    if (!isWebDavSyncMessage(message)) return undefined
    if (message.type === 'webdav-sync:data-changed') {
      coordinator.dataChanged()
      return undefined
    }
    if (message.type === 'webdav-sync:get-state') return getOrCreateSyncState()
    if (message.type === 'webdav-sync:preview-connection') {
      const { previewBrowserWebDavSetup } = await import('@/shared/webdavSync/browserEngine')
      return previewBrowserWebDavSetup(message.input)
    }
    if (message.type === 'webdav-sync:connect') {
      const { connectBrowserWebDav } = await import('@/shared/webdavSync/browserEngine')
      return connectBrowserWebDav(message.input, message.expected)
    }
    if (message.type === 'webdav-sync:commit-compressed-wallpaper') {
      const { commitCompressedBrowserWallpaper } = await import(
        '@/shared/webdavSync/browserEngine'
      )
      return runMaintenance(() =>
        commitCompressedBrowserWallpaper(message.variant, message.blob),
      )
    }
    if (message.type === 'webdav-sync:disconnect') {
      const { disconnectBrowserWebDav } = await import('@/shared/webdavSync/browserEngine')
      return runMaintenance(() =>
        disconnectBrowserWebDav({
          deleteRemote: message.deleteRemote,
          confirmationText: message.confirmationText,
        }),
      )
    }
    if (message.type === 'webdav-sync:get-conflict') {
      const stored = await getStoredConflict()
      if (!stored) return null
      return {
        conflicts: mergeSyncSnapshots(stored.base, stored.local, stored.remote).conflicts,
        remoteRevisionIds: stored.remoteRevisionIds,
      }
    }
    if (message.type === 'webdav-sync:list-history') {
      const { listBrowserSyncHistory } = await import('@/shared/webdavSync/browserEngine')
      return listBrowserSyncHistory()
    }
    if (message.type === 'webdav-sync:list-devices') {
      const { listBrowserSyncDevices } = await import('@/shared/webdavSync/browserEngine')
      return listBrowserSyncDevices()
    }
    if (message.type === 'webdav-sync:inspect-corruption') {
      const { inspectBrowserSyncCorruption } = await import('@/shared/webdavSync/browserEngine')
      return inspectBrowserSyncCorruption()
    }
    if (message.type === 'webdav-sync:download-corruption') {
      const { downloadBrowserCorruptedPayload } = await import('@/shared/webdavSync/browserEngine')
      return downloadBrowserCorruptedPayload({
        revisionId: message.revisionId,
        actualPayloadHash: message.actualPayloadHash,
      })
    }
    if (message.type === 'webdav-sync:resume-apply') {
      const state = await getOrCreateSyncState()
      const { resumePendingBrowserApply } = await import('@/shared/webdavSync/browserData')
      await resumePendingBrowserApply(state.scope)
      return getOrCreateSyncState()
    }
    if (message.type === 'webdav-sync:unlock-encryption') {
      const { unlockBrowserEncryption } = await import('@/shared/webdavSync/browserEngine')
      const state = await unlockBrowserEncryption(message.password)
      await coordinator.trigger('manual')
      return state
    }
    if (message.type === 'webdav-sync:migrate-encryption') {
      return runMaintenance(async () => {
        const { migrateBrowserVaultEncryption } = await import(
          '@/shared/webdavSync/browserEngine'
        )
        return await migrateBrowserVaultEncryption({
          newPassword: message.newPassword,
          oldPassword: message.oldPassword,
        })
      })
    }
    if (message.type === 'webdav-sync:resolve-conflict') {
      const { resolveBrowserSyncConflict } = await import('@/shared/webdavSync/browserEngine')
      return runMaintenance(() => resolveBrowserSyncConflict(message.resolutions))
    }
    if (message.type === 'webdav-sync:restore-history') {
      const { restoreBrowserSyncHistory } = await import('@/shared/webdavSync/browserEngine')
      return runMaintenance(() => restoreBrowserSyncHistory(message.revisionId))
    }
    if (message.type === 'webdav-sync:reset') {
      const { resetBrowserSyncedData } = await import('@/shared/webdavSync/browserEngine')
      return runMaintenance(() =>
        resetBrowserSyncedData(message.snapshot, message.encryptionPassword),
      )
    }
    if (message.type === 'webdav-sync:accept-reset') {
      const { acceptBrowserRemoteReset } = await import('@/shared/webdavSync/browserEngine')
      return runMaintenance(() =>
        acceptBrowserRemoteReset({
          mode: message.mode,
          encryptionPassword: message.encryptionPassword,
        }),
      )
    }
    if (message.type === 'webdav-sync:stop-wallpapers') {
      const { stopAndDeleteBrowserSyncedWallpapers } = await import(
        '@/shared/webdavSync/browserEngine'
      )
      return runMaintenance(stopAndDeleteBrowserSyncedWallpapers)
    }
    if (message.type === 'webdav-sync:repair-corruption') {
      const { repairBrowserSyncCorruption } = await import('@/shared/webdavSync/browserEngine')
      return runMaintenance(() => repairBrowserSyncCorruption(message))
    }
    if (message.type === 'webdav-sync:update-preferences') {
      const { updateBrowserSyncPreferences } = await import('@/shared/webdavSync/browserEngine')
      const state = await updateBrowserSyncPreferences({
        historyLimit: message.historyLimit,
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
