import { defineBackground } from '#imports'
import { browser, type Browser } from 'wxt/browser'

import {
  consumeExtensionUpdateNotice,
  isExtensionUpdateMessage,
  markExtensionUpdateAvailable,
} from '@/shared/extensionUpdate'
import { createSyncConflictDetails } from '@/shared/webdavSync/conflictDetails'
import { SyncCoordinator } from '@/shared/webdavSync/coordinator'
import { SYNC_DATA_KEYS } from '@/shared/webdavSync/domains'
import { serializeWebDavError, WebDavError } from '@/shared/webdavSync/errors'
import {
  getStoredConflict,
  hasPendingApply,
  getOrCreateSyncState,
  patchSyncState,
  webDavSyncConfigStorage,
} from '@/shared/webdavSync/localState'
import { isWebDavSyncMessage, type WebDavSyncMessage } from '@/shared/webdavSync/messages'
import { hasExactWebDavPermission } from '@/shared/webdavSync/permissions'
import { nextSyncRetry, SYNC_RETRY_ALARM } from '@/shared/webdavSync/retry'
import {
  syncSettingsChanged,
  syncWallpaperSettingsChanged,
} from '@/shared/webdavSync/settingsWhitelist'
import type { LocalSyncStateV1 } from '@/shared/webdavSync/types'

import { initializeBookmarkCache } from './bookmarkCache'

function routeWebDavMessage(handler: (message: WebDavSyncMessage) => Promise<unknown>) {
  return (message: unknown, sender: Browser.runtime.MessageSender) => {
    if (sender.id && sender.id !== browser.runtime.id) return undefined
    return isWebDavSyncMessage(message)
      ? handler(message).then(
          (value) => ({ ok: true, value }),
          (error: unknown) => ({ ok: false, error: serializeWebDavError(error) }),
        )
      : undefined
  }
}

function routeExtensionUpdateMessage(handler: () => Promise<unknown>) {
  return (message: unknown, sender: Browser.runtime.MessageSender) => {
    if (sender.id && sender.id !== browser.runtime.id) return undefined
    return isExtensionUpdateMessage(message) ? handler() : undefined
  }
}

export default defineBackground(() => {
  let extensionUpdateTail: Promise<void> = Promise.resolve()
  const runExtensionUpdateTask = <T>(task: () => Promise<T>): Promise<T> => {
    const run = extensionUpdateTail.then(task, task)
    extensionUpdateTail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  browser.runtime.onUpdateAvailable.addListener(({ version }) => {
    void runExtensionUpdateTask(() => markExtensionUpdateAvailable(version)).catch((error) => {
      console.warn('[ExtensionUpdate] Failed to save restart notice:', error)
    })
  })
  browser.runtime.onMessage.addListener(
    routeExtensionUpdateMessage(() => runExtensionUpdateTask(consumeExtensionUpdateNotice)),
  )

  initializeBookmarkCache()

  let applyingRemote = false
  let configured = false
  let maintenance = false
  let maintenanceTail: Promise<void> = Promise.resolve()
  const coordinator = new SyncCoordinator({
    isConfigured: async (trigger) => {
      const config = await webDavSyncConfigStorage.getValue()
      configured = Boolean(config)
      if (!config || maintenance) return false
      const state = await getOrCreateSyncState()
      return Boolean(
        state.configured &&
        state.enabled &&
        Object.values(state.scope).some(Boolean) &&
        (config.rememberPassword || trigger === 'manual'),
      )
    },
    synchronize: async () => {
      const { synchronizeBrowser } = await import('@/shared/webdavSync/browserEngine')
      await synchronizeBrowser()
      const state = await getOrCreateSyncState()
      const retry = nextSyncRetry(state)
      await patchSyncState({ retry })
      if (retry?.nextAttemptAt)
        await browser.alarms.create(SYNC_RETRY_ALARM, { when: retry.nextAttemptAt })
      else await browser.alarms.clear(SYNC_RETRY_ALARM)
    },
  })
  const runMaintenance = <T>(task: () => Promise<T>): Promise<T> => {
    const run = maintenanceTail.then(async () => {
      maintenance = true
      await coordinator.trigger('manual')
      try {
        return await task()
      } finally {
        maintenance = false
        void coordinator.trigger('natural')
      }
    })
    maintenanceTail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
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
    const syncDataChanged = Object.entries(changes).some(([key, change]) =>
      key === 'settings'
        ? syncSettingsChanged(change.oldValue, change.newValue) ||
          syncWallpaperSettingsChanged(change.oldValue, change.newValue)
        : SYNC_DATA_KEYS.has(key),
    )
    if (!applyingRemote && syncDataChanged) {
      scheduleConfiguredDataChange()
    }
  })

  const handleWebDavMessage = async (message: WebDavSyncMessage) => {
    if (message.type === 'webdav-sync:data-changed') {
      scheduleConfiguredDataChange()
      return undefined
    }
    if (message.type === 'webdav-sync:get-state') return getOrCreateSyncState()
    if (message.type === 'webdav-sync:preview-connection') {
      if (!(await hasExactWebDavPermission(message.input.connection.baseUrl))) {
        throw new WebDavError('forbidden', 'WebDAV host permission is not granted')
      }
      const { previewBrowserWebDavSetup } = await import('@/shared/webdavSync/browserEngine')
      return previewBrowserWebDavSetup(message.input)
    }
    if (message.type === 'webdav-sync:connect') {
      const { connectBrowserWebDav } = await import('@/shared/webdavSync/browserEngine')
      return runMaintenance(() => connectBrowserWebDav(message.input, message.expected))
    }
    if (message.type === 'webdav-sync:disconnect') {
      const { disconnectBrowserWebDav } = await import('@/shared/webdavSync/browserLifecycle')
      return runMaintenance(() =>
        disconnectBrowserWebDav({
          deleteRemote: message.deleteRemote,
          confirmationText: message.confirmationText,
          deleteDirectory: message.deleteDirectory,
        }),
      )
    }
    if (message.type === 'webdav-sync:get-conflict') {
      const stored = await getStoredConflict()
      return stored ? createSyncConflictDetails(stored) : null
    }
    if (message.type === 'webdav-sync:list-history') {
      const { listBrowserSyncHistory } = await import('@/shared/webdavSync/browserManagement')
      return runMaintenance(listBrowserSyncHistory)
    }
    if (message.type === 'webdav-sync:preview-history') {
      const { previewBrowserSyncHistory } = await import('@/shared/webdavSync/browserManagement')
      return runMaintenance(() => previewBrowserSyncHistory(message.revisionId))
    }
    if (message.type === 'webdav-sync:list-devices') {
      const { listBrowserSyncDevices } = await import('@/shared/webdavSync/browserManagement')
      return runMaintenance(listBrowserSyncDevices)
    }
    if (message.type === 'webdav-sync:remove-remote-wallpapers') {
      const { removeBrowserRemoteWallpapers } =
        await import('@/shared/webdavSync/browserManagement')
      return runMaintenance(removeBrowserRemoteWallpapers)
    }
    if (message.type === 'webdav-sync:inspect-corruption') {
      const { inspectBrowserSyncCorruption } = await import('@/shared/webdavSync/browserManagement')
      return runMaintenance(inspectBrowserSyncCorruption)
    }
    if (message.type === 'webdav-sync:download-corruption') {
      const { downloadBrowserCorruptedPayload } =
        await import('@/shared/webdavSync/browserManagement')
      return runMaintenance(() =>
        downloadBrowserCorruptedPayload({
          revisionId: message.revisionId,
          actualPayloadHash: message.actualPayloadHash,
        }),
      )
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
      // 没有本机应用日志时，打开新标签页不应等待后台的远端网络任务。
      if (!(await hasPendingApply())) return getOrCreateSyncState()
      const { resumePendingBrowserApply } = await import('@/shared/webdavSync/browserData')
      await runMaintenance(async () => {
        try {
          await resumePendingBrowserApply()
        } catch (error) {
          const { recordSyncFailure } = await import('@/shared/webdavSync/browserEngine')
          await recordSyncFailure(error)
        }
      })
      return getOrCreateSyncState()
    }
    if (message.type === 'webdav-sync:unlock-encryption') {
      const { unlockBrowserEncryption } = await import('@/shared/webdavSync/browserEngine')
      const state = await runMaintenance(() => unlockBrowserEncryption(message.password))
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
      return runMaintenance(() =>
        updateBrowserSyncPreferences({
          enabled: message.enabled,
          scope: message.scope,
        }),
      )
    }
    if (message.type === 'webdav-sync:update-credentials') {
      const { updateBrowserWebDavCredentials } =
        await import('@/shared/webdavSync/browserLifecycle')
      return runMaintenance(() => updateBrowserWebDavCredentials(message))
    }
    if (message.type === 'webdav-sync:immediate') {
      const state = await getOrCreateSyncState()
      if (state.pauseReason === 'storage-full') {
        await patchSyncState({ paused: false, pauseReason: undefined })
      }
    }
    const trigger =
      message.type === 'webdav-sync:immediate'
        ? 'manual'
        : message.type === 'webdav-sync:online'
          ? 'online'
          : 'natural'
    await coordinator.trigger(trigger)
    return getOrCreateSyncState()
  }
  browser.runtime.onMessage.addListener(routeWebDavMessage(handleWebDavMessage))

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_RETRY_ALARM) void coordinator.trigger('natural')
  })

  void coordinator.trigger('startup')
})
