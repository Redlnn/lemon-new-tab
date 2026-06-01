import { storage } from '#imports'

import { defaultQuickLinksData } from '../quickLinks/quickLinksStorage'
import { CURRENT_CONFIG_VERSION, defaultSettings } from '../settings'

import { defaultSyncedCustomSearchEngines } from './types'
import type { LocalSyncMeta, SyncEnvelope } from './types'

export const syncDataStorage = storage.defineItem<SyncEnvelope>('sync:syncData', {
  fallback: {
    _v: 2,
    configVersion: CURRENT_CONFIG_VERSION,
    fromDeviceId: '',
    fromDeviceName: '',
    settings: defaultSettings,
    quickLinks: defaultQuickLinksData,
    customSearchEngines: defaultSyncedCustomSearchEngines,
    lastUpdate: 0,
    version: 0,
    baseVersion: 0,
  },
})

export const localSyncMetaStorage = storage.defineItem<LocalSyncMeta>('local:syncMeta', {
  fallback: {
    deviceId: '',
    deviceName: '',
    lastSyncedAt: 0,
    localModifiedAt: 0,
    localVersion: 0,
  },
})
