import type { CURRENT_CONFIG_SCHEMA } from '@/shared/settings'
import { normalizeCurrentSettings, settingsStorage } from '@/shared/settings'
import { getQuickLinksStorageValue, quickLinksStorage } from '@/shared/quickLinks'
import { getUiPreferences, patchUiPreferences } from '@/shared/uiPreferences'
import {
  idbDelete,
  idbDeleteMany,
  idbGet,
  idbGetAllEntries,
  idbSet,
} from '@/shared/storage/idb'

import { customSearchEngineStorage } from '@newtab/shared/customSearchEngine/customSearchEngineStorage'
import {
  getSearchHistoryData,
  searchHistoriesStorage,
} from '@newtab/shared/storages/searchHistoriesStorage'
import { blockedTopSitesStorage } from '@newtab/shared/storages/topSitesStorage'

import { captureSyncSnapshot } from './capture.ts'
import { sha256Hex } from './canonical.ts'
import { MAX_SYNC_WALLPAPER_BYTES } from './catalog.ts'
import {
  clearPendingApply,
  getPendingApply,
  setPendingApply,
  type PendingApplyV1,
  type PendingWallpaperApplyV1,
} from './localState.ts'
import { materializeQuickLinks, mergeSyncSettings } from './apply.ts'
import type {
  SyncScopePreferences,
  SyncSnapshotV1,
  SyncWallpaperV1,
} from './types.ts'
import { validateSyncSnapshot } from './validation.ts'

export async function captureBrowserSyncSnapshot(
  scope: SyncScopePreferences,
): Promise<SyncSnapshotV1> {
  const [settings, quickLinks, searchEngines, ui, searchHistory, blockedTopSites] =
    await Promise.all([
      settingsStorage.getValue(),
      getQuickLinksStorageValue(),
      customSearchEngineStorage.getValue(),
      getUiPreferences(),
      scope.searchHistory ? getSearchHistoryData() : undefined,
      scope.blockedTopSites ? blockedTopSitesStorage.getValue() : undefined,
    ])

  const snapshot = captureSyncSnapshot({
    settings,
    quickLinks,
    customSearchEngines: searchEngines,
    ui: {
      language: ui.language || 'en',
      colorMode: ui.colorMode || 'auto',
    },
    scope,
    searchHistory: searchHistory?.items,
    blockedTopSites,
  })
  if (scope.wallpapers) {
    const [light, dark] = await Promise.all([
      captureWallpaper(settings.background.local, 'wallpaper'),
      captureWallpaper(settings.background.localDark, 'wallpaperDark'),
    ])
    if (light || dark) {
      snapshot.optional ??= {}
      snapshot.optional.wallpapers = {
        ...(light ? { light } : {}),
        ...(dark ? { dark } : {}),
      }
    }
  }
  return snapshot
}

async function captureWallpaper(
  selection: CURRENT_CONFIG_SCHEMA['background']['local'],
  store: 'wallpaper' | 'wallpaperDark',
) {
  if (!selection.id || selection.mediaType === 'video') return undefined
  const blob = await idbGet(store, selection.id)
  if (
    !blob ||
    blob.size > MAX_SYNC_WALLPAPER_BYTES ||
    !blob.type.toLowerCase().startsWith('image/')
  ) {
    return undefined
  }
  const sha256 = await sha256Hex(await blob.arrayBuffer())
  return {
    assetId: `sha256-${sha256}`,
    size: blob.size,
    mimeType: blob.type,
    sha256,
  }
}

async function writeSettings(snapshot: SyncSnapshotV1): Promise<void> {
  const current = await settingsStorage.getValue()
  const merged = mergeSyncSettings<CURRENT_CONFIG_SCHEMA>(current, snapshot.settings)
  const pending = await getPendingApply()
  if (pending?.wallpapers?.light) {
    merged.background.local = {
      id: pending.wallpapers.light.assetId,
      url: '',
      mediaType: 'image',
    }
  }
  if (pending?.wallpapers?.dark) {
    merged.background.localDark = {
      id: pending.wallpapers.dark.assetId,
      url: '',
      mediaType: 'image',
    }
  }
  await settingsStorage.setValue(normalizeCurrentSettings(structuredClone(merged)))
}

async function writeQuickLinks(
  snapshot: SyncSnapshotV1,
  scope: SyncScopePreferences,
): Promise<void> {
  const current = await getQuickLinksStorageValue()
  await quickLinksStorage.setValue(
    materializeQuickLinks(snapshot.quickLinks, current, scope.quickLinkIcons),
  )
}

async function writeOptional(
  snapshot: SyncSnapshotV1,
  scope: SyncScopePreferences,
): Promise<void> {
  const tasks: Promise<unknown>[] = []
  if (scope.searchHistory && snapshot.optional?.searchHistory) {
    tasks.push(
      searchHistoriesStorage.setValue({
        version: 1,
        items: snapshot.optional.searchHistory.order.map(
          (id) => snapshot.optional!.searchHistory!.items.find((item) => item.id === id)!,
        ),
      }),
    )
  }
  if (scope.blockedTopSites && snapshot.optional?.blockedTopSites) {
    tasks.push(blockedTopSitesStorage.setValue(snapshot.optional.blockedTopSites.urls))
  }
  await Promise.all(tasks)
}

async function continueApply(
  pending: PendingApplyV1,
  scope: SyncScopePreferences,
): Promise<void> {
  if (pending.phase === 'validated') {
    for (const [variant, wallpaper] of Object.entries(pending.wallpapers ?? {}) as Array<
      ['dark' | 'light', PendingWallpaperApplyV1]
    >) {
      const blob = await idbGet('webdavSync', wallpaper.temporaryKey)
      if (!(blob instanceof Blob)) throw new Error('Pending wallpaper resource is missing')
      const hash = await sha256Hex(await blob.arrayBuffer())
      if (
        blob.size !== wallpaper.size ||
        blob.type !== wallpaper.mimeType ||
        hash !== wallpaper.sha256
      ) {
        throw new Error('Pending wallpaper resource is invalid')
      }
      await idbSet(variant === 'light' ? 'wallpaper' : 'wallpaperDark', wallpaper.assetId, blob)
    }
    pending = { ...pending, phase: 'wallpapers' }
    await setPendingApply(pending)
  }
  if (pending.phase === 'wallpapers') {
    await writeSettings(pending.snapshot)
    pending = { ...pending, phase: 'settings' }
    await setPendingApply(pending)
  }
  if (pending.phase === 'settings') {
    await writeQuickLinks(pending.snapshot, scope)
    pending = { ...pending, phase: 'quick-links' }
    await setPendingApply(pending)
  }
  if (pending.phase === 'quick-links') {
    await customSearchEngineStorage.setValue({
      items: pending.snapshot.customSearchEngines.order.map(
        (id) => pending.snapshot.customSearchEngines.items.find((item) => item.id === id)!,
      ),
    })
    pending = { ...pending, phase: 'search-engines' }
    await setPendingApply(pending)
  }
  if (pending.phase === 'search-engines') {
    await patchUiPreferences(pending.snapshot.ui)
    pending = { ...pending, phase: 'ui' }
    await setPendingApply(pending)
  }
  if (pending.phase === 'ui') {
    await writeOptional(pending.snapshot, scope)
    pending = { ...pending, phase: 'optional' }
    await setPendingApply(pending)
  }
  for (const [variant, wallpaper] of Object.entries(pending.wallpapers ?? {}) as Array<
    ['dark' | 'light', PendingWallpaperApplyV1]
  >) {
    if (wallpaper.previousId && wallpaper.previousId !== wallpaper.assetId) {
      await idbDelete(variant === 'light' ? 'wallpaper' : 'wallpaperDark', wallpaper.previousId)
    }
    await idbDelete('webdavSync', wallpaper.temporaryKey)
  }
  await clearPendingApply()
}

export type IncomingWallpaperResources = Partial<
  Record<'dark' | 'light', { assetId: string; blob: Blob; sha256: string }>
>

export async function prepareAndApplyBrowserSnapshot(
  operationId: string,
  revisionId: string,
  snapshot: SyncSnapshotV1,
  scope: SyncScopePreferences,
  wallpapers?: IncomingWallpaperResources,
): Promise<void> {
  const validation = validateSyncSnapshot(snapshot)
  if (!validation.ok) throw new Error(validation.error)
  const currentSettings = await settingsStorage.getValue()
  const pendingWallpapers: PendingApplyV1['wallpapers'] = {}
  for (const [variant, wallpaper] of Object.entries(wallpapers ?? {}) as Array<
    ['dark' | 'light', NonNullable<IncomingWallpaperResources['light']>]
  >) {
    const reference = snapshot.optional?.wallpapers?.[variant]
    if (
      !reference ||
      reference.assetId !== wallpaper.assetId ||
      reference.sha256 !== wallpaper.sha256 ||
      reference.size !== wallpaper.blob.size ||
      reference.mimeType !== wallpaper.blob.type ||
      (await sha256Hex(await wallpaper.blob.arrayBuffer())) !== wallpaper.sha256
    ) {
      throw new Error('Incoming wallpaper does not match the validated snapshot')
    }
    const temporaryKey = `pending-wallpaper-${operationId}-${variant}`
    await idbSet('webdavSync', temporaryKey, wallpaper.blob)
    pendingWallpapers[variant] = {
      assetId: wallpaper.assetId,
      mimeType: wallpaper.blob.type,
      previousId:
        variant === 'light'
          ? currentSettings.background.local.id
          : currentSettings.background.localDark.id,
      sha256: wallpaper.sha256,
      size: wallpaper.blob.size,
      temporaryKey,
    }
  }
  const pending: PendingApplyV1 = {
    version: 1,
    operationId,
    revisionId,
    phase: 'validated',
    snapshot: validation.value,
    ...(Object.keys(pendingWallpapers).length ? { wallpapers: pendingWallpapers } : {}),
  }
  await setPendingApply(pending)
  await continueApply(pending, scope)
}

export async function getLocalWallpaperBlob(
  variant: 'dark' | 'light',
  expectedSha256: string,
): Promise<Blob | undefined> {
  const settings = await settingsStorage.getValue()
  const selection =
    variant === 'light' ? settings.background.local : settings.background.localDark
  if (!selection.id || selection.mediaType === 'video') return undefined
  const blob = await idbGet(variant === 'light' ? 'wallpaper' : 'wallpaperDark', selection.id)
  if (!blob || (await sha256Hex(await blob.arrayBuffer())) !== expectedSha256) return undefined
  return blob
}

function stagedWallpaperKey(variant: 'dark' | 'light', sha256: string): string {
  return `staged-wallpaper-${variant}-${sha256}`
}

export async function stageWallpaperSyncCandidate(
  variant: 'dark' | 'light',
  blob: Blob,
): Promise<SyncWallpaperV1> {
  if (
    blob.size === 0 ||
    blob.size > MAX_SYNC_WALLPAPER_BYTES ||
    !blob.type.toLowerCase().startsWith('image/')
  ) {
    throw new TypeError('Compressed wallpaper is invalid or too large')
  }
  const sha256 = await sha256Hex(await blob.arrayBuffer())
  await idbSet('webdavSync', stagedWallpaperKey(variant, sha256), blob)
  return {
    assetId: `sha256-${sha256}`,
    mimeType: blob.type,
    sha256,
    size: blob.size,
  }
}

export async function getStagedWallpaperSyncCandidate(
  variant: 'dark' | 'light',
  sha256: string,
): Promise<Blob | undefined> {
  const value = await idbGet('webdavSync', stagedWallpaperKey(variant, sha256))
  return value instanceof Blob ? value : undefined
}

export function clearStagedWallpaperSyncCandidate(
  variant: 'dark' | 'light',
  sha256: string,
): Promise<void> {
  return idbDelete('webdavSync', stagedWallpaperKey(variant, sha256))
}

export async function clearAllStagedWallpaperSyncCandidates(): Promise<void> {
  const keys = (await idbGetAllEntries('webdavSync'))
    .map(([key]) => key)
    .filter((key) => key.startsWith('staged-wallpaper-'))
  await idbDeleteMany('webdavSync', keys)
}

export async function resumePendingBrowserApply(scope: SyncScopePreferences): Promise<boolean> {
  const pending = await getPendingApply()
  if (!pending) return false
  const validation = validateSyncSnapshot(pending.snapshot)
  if (!validation.ok) throw new Error(validation.error)
  await continueApply({ ...pending, snapshot: validation.value }, scope)
  return true
}
