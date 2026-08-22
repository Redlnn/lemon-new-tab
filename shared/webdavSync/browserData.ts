import { getQuickLinksStorageValue, quickLinksStorage } from '@/shared/quickLinks'
import type { CURRENT_CONFIG_SCHEMA } from '@/shared/settings'
import { normalizeCurrentSettings, settingsStorage } from '@/shared/settings'
import { idbDelete, idbGet, idbSet } from '@/shared/storage/idb'
import { getUiPreferences, patchUiPreferences } from '@/shared/uiPreferences'

import { customSearchEngineStorage } from '@newtab/shared/customSearchEngine/customSearchEngineStorage'
import { blockedTopSitesStorage } from '@newtab/shared/storages/topSitesStorage'

import { materializeQuickLinks, mergeSyncSettings } from './apply.ts'
import { sha256Hex } from './canonical.ts'
import { captureSyncSnapshot, deduplicateInlineImages } from './capture.ts'
import { MAX_SYNC_WALLPAPER_BYTES } from './catalog.ts'
import {
  clearPendingApply,
  getPendingApply,
  setPendingApply,
  type PendingApplyV1,
  type PendingWallpaperApplyV1,
} from './localState.ts'
import type {
  LocalResourceOmission,
  SyncScopePreferences,
  SyncSnapshotV1,
  SyncWallpaperV1,
} from './types.ts'
import { validateSyncSnapshot } from './validation.ts'

export interface BrowserSyncCaptureResult {
  snapshot: SyncSnapshotV1
  resourceOmissions: LocalResourceOmission[]
}

interface CapturedWallpaper {
  preserveBaseline?: boolean
  reason?: Extract<LocalResourceOmission, { kind: 'wallpaper' }>['reason']
  value?: SyncWallpaperV1
}

export async function captureBrowserSyncSnapshot(
  scope: SyncScopePreferences,
): Promise<SyncSnapshotV1> {
  return (await captureBrowserSyncSnapshotResult(scope)).snapshot
}

export async function captureBrowserSyncSnapshotResult(
  scope: SyncScopePreferences,
  baseline?: SyncSnapshotV1,
): Promise<BrowserSyncCaptureResult> {
  const [settings, quickLinks, searchEngines, ui, blockedTopSites] = await Promise.all([
    settingsStorage.getValue(),
    getQuickLinksStorageValue(),
    customSearchEngineStorage.getValue(),
    getUiPreferences(),
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
    blockedTopSites,
  })
  const resourceOmissions = await deduplicateInlineImages(snapshot, baseline)
  if (scope.wallpapers) {
    const [light, dark] = await Promise.all([
      captureWallpaper(settings.background.local, 'wallpaper'),
      captureWallpaper(settings.background.localDark, 'wallpaperDark'),
    ])
    const lightValue =
      light.value ?? (light.preserveBaseline ? baseline?.optional?.wallpapers?.light : undefined)
    const darkValue =
      dark.value ?? (dark.preserveBaseline ? baseline?.optional?.wallpapers?.dark : undefined)
    if (lightValue || darkValue) {
      snapshot.optional ??= {}
      snapshot.optional.wallpapers = {
        ...(lightValue ? { light: structuredClone(lightValue) } : {}),
        ...(darkValue ? { dark: structuredClone(darkValue) } : {}),
      }
    }
    if (light.reason)
      resourceOmissions.push({ kind: 'wallpaper', variant: 'light', reason: light.reason })
    if (dark.reason)
      resourceOmissions.push({ kind: 'wallpaper', variant: 'dark', reason: dark.reason })
  }
  return { snapshot, resourceOmissions }
}

async function captureWallpaper(
  selection: CURRENT_CONFIG_SCHEMA['background']['local'],
  store: 'wallpaper' | 'wallpaperDark',
) {
  if (!selection.id) return {}
  if (selection.mediaType === 'video') {
    return { preserveBaseline: true, reason: 'unsupported' } satisfies CapturedWallpaper
  }
  const blob = await idbGet(store, selection.id)
  if (!blob || !blob.type.toLowerCase().startsWith('image/')) {
    return { preserveBaseline: true, reason: 'unavailable' } satisfies CapturedWallpaper
  }
  if (blob.size > MAX_SYNC_WALLPAPER_BYTES) {
    return { preserveBaseline: true, reason: 'too-large' } satisfies CapturedWallpaper
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  try {
    if (isAnimatedImage(bytes, blob.type)) throw new TypeError('Animated image')
  } catch {
    return { preserveBaseline: true, reason: 'unsupported' } satisfies CapturedWallpaper
  }
  const sha256 = await sha256Hex(bytes)
  return {
    value: {
      assetId: `sha256-${sha256}`,
      size: blob.size,
      mimeType: blob.type,
      sha256,
    },
  } satisfies CapturedWallpaper
}

export async function getUnavailableSelectedWallpaperVariants(): Promise<Set<'dark' | 'light'>> {
  const settings = await settingsStorage.getValue()
  const [light, dark] = await Promise.all([
    selectedWallpaperIsUnavailable(settings.background.local, 'wallpaper'),
    selectedWallpaperIsUnavailable(settings.background.localDark, 'wallpaperDark'),
  ])
  const result = new Set<'dark' | 'light'>()
  if (light) result.add('light')
  if (dark) result.add('dark')
  return result
}

async function selectedWallpaperIsUnavailable(
  selection: CURRENT_CONFIG_SCHEMA['background']['local'],
  store: 'wallpaper' | 'wallpaperDark',
): Promise<boolean> {
  if (!selection.id) return false
  if (selection.mediaType === 'video') return true
  const blob = await idbGet(store, selection.id)
  if (
    !blob ||
    blob.size > MAX_SYNC_WALLPAPER_BYTES ||
    !blob.type.toLowerCase().startsWith('image/')
  ) {
    return true
  }
  try {
    return isAnimatedImage(new Uint8Array(await blob.arrayBuffer()), blob.type)
  } catch {
    return true
  }
}

async function writeSettings(snapshot: SyncSnapshotV1, scope: SyncScopePreferences): Promise<void> {
  const current = await settingsStorage.getValue()
  const merged =
    scope.settings && snapshot.settings
      ? mergeSyncSettings<CURRENT_CONFIG_SCHEMA>(current, snapshot.settings)
      : structuredClone(current)
  if (snapshot.scope.onlineWallpaperUrl && snapshot.optional?.onlineWallpaperUrl !== undefined) {
    merged.background.online.url = snapshot.optional.onlineWallpaperUrl
  }
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
  if (!snapshot.quickLinks) return
  await quickLinksStorage.setValue(
    materializeQuickLinks(snapshot.quickLinks, current, scope.userIcons, snapshot.inlineImages),
  )
}

async function writeOptional(snapshot: SyncSnapshotV1, scope: SyncScopePreferences): Promise<void> {
  const tasks: Promise<unknown>[] = []
  if (scope.blockedTopSites && snapshot.optional?.blockedTopSites) {
    tasks.push(blockedTopSitesStorage.setValue(snapshot.optional.blockedTopSites.urls))
  }
  await Promise.all(tasks)
}

async function continueApply(pending: PendingApplyV1, scope: SyncScopePreferences): Promise<void> {
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
    // 本地壁纸会跟随页面当前的深浅色状态选择。先切换主题偏好，再写入壁纸 ID，
    // 避免旧主题在两个存储写入之间抢先解析到错误的壁纸变体。
    if (scope.uiPreferences && pending.snapshot.ui && !pending.uiPreferencesApplied) {
      await patchUiPreferences(pending.snapshot.ui)
      pending = { ...pending, uiPreferencesApplied: true }
      await setPendingApply(pending)
    }
    if (scope.settings || scope.onlineWallpaperUrl || scope.wallpapers) {
      await writeSettings(pending.snapshot, scope)
    }
    pending = { ...pending, phase: 'settings' }
    await setPendingApply(pending)
  }
  if (pending.phase === 'settings') {
    // 兼容升级前已写入设置、但尚未写入主题偏好的断点恢复。
    if (scope.uiPreferences && pending.snapshot.ui && !pending.uiPreferencesApplied) {
      await patchUiPreferences(pending.snapshot.ui)
      pending = { ...pending, uiPreferencesApplied: true }
      await setPendingApply(pending)
    }
    if (scope.quickLinks) await writeQuickLinks(pending.snapshot, scope)
    pending = { ...pending, phase: 'quick-links' }
    await setPendingApply(pending)
  }
  if (pending.phase === 'quick-links') {
    const engines = pending.snapshot.customSearchEngines
    if (scope.customSearchEngines && engines) {
      const current = await customSearchEngineStorage.getValue()
      const currentById = new Map(current.items.map((item) => [item.id, item]))
      await customSearchEngineStorage.setValue({
        items: engines.order.map((id) => {
          const item = engines.items.find((engine) => engine.id === id)!
          const icon = scope.userIcons
            ? item.iconHash && pending.snapshot.inlineImages?.[item.iconHash]
            : currentById.get(item.id)?.icon
          return { id: item.id, name: item.name, url: item.url, ...(icon ? { icon } : {}) }
        }),
      })
    }
    pending = { ...pending, phase: 'search-engines' }
    await setPendingApply(pending)
  }
  if (pending.phase === 'search-engines') {
    if (scope.uiPreferences && pending.snapshot.ui && !pending.uiPreferencesApplied) {
      await patchUiPreferences(pending.snapshot.ui)
    }
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
    scope: { ...scope },
    ...(Object.keys(pendingWallpapers).length ? { wallpapers: pendingWallpapers } : {}),
  }
  await setPendingApply(pending)
  await continueApply(pending, scope)
}

export async function getLocalWallpaperBlob(
  variant: 'dark' | 'light',
  expectedSha256: string,
): Promise<Blob | undefined> {
  const blob = await getSelectedBrowserWallpaper(variant)
  if (!blob || (await sha256Hex(await blob.arrayBuffer())) !== expectedSha256) return undefined
  return blob
}

export async function getSelectedBrowserWallpaper(
  variant: 'dark' | 'light',
): Promise<Blob | undefined> {
  const settings = await settingsStorage.getValue()
  const selection = variant === 'light' ? settings.background.local : settings.background.localDark
  if (!selection.id || selection.mediaType === 'video') return undefined
  const blob = await idbGet(variant === 'light' ? 'wallpaper' : 'wallpaperDark', selection.id)
  return blob instanceof Blob && blob.type.toLowerCase().startsWith('image/') ? blob : undefined
}

export async function resumePendingBrowserApply(): Promise<boolean> {
  const pending = await getPendingApply()
  if (!pending) return false
  const validation = validateSyncSnapshot(pending.snapshot)
  if (!validation.ok) throw new Error(validation.error)
  await continueApply({ ...pending, snapshot: validation.value }, pending.scope)
  return true
}

function isAnimatedImage(bytes: Uint8Array, mimeType: string): boolean {
  const type = mimeType.toLowerCase()
  if (type === 'image/gif') return true
  if (type === 'image/png') return includesAscii(bytes, 'acTL')
  if (type === 'image/webp') return includesAscii(bytes, 'ANIM') || includesAscii(bytes, 'ANMF')
  return false
}

function includesAscii(bytes: Uint8Array, value: string): boolean {
  outer: for (let index = 0; index <= bytes.length - value.length; index += 1) {
    for (let offset = 0; offset < value.length; offset += 1) {
      if (bytes[index + offset] !== value.charCodeAt(offset)) continue outer
    }
    return true
  }
  return false
}
