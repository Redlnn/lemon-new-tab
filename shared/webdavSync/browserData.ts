import { browser } from 'wxt/browser'

import { getQuickLinksStorageValue } from '@/shared/quickLinks'
import type { CURRENT_CONFIG_SCHEMA } from '@/shared/settings'
import { normalizeCurrentSettings, settingsStorage } from '@/shared/settings'
import { idbDelete, idbGet } from '@/shared/storage/idb'
import { withSyncWriteLock } from '@/shared/storage/syncWrite'
import { getUiPreferences, uiPreferencesStorage } from '@/shared/uiPreferences'
import {
  readWallpaperLibrary,
  wallpaperLibrarySignature,
  updateWallpaperLibrary,
  wallpaperStore,
  type WallpaperItem,
  type WallpaperVariant,
} from '@/shared/wallpaperLibrary'

import { customSearchEngineStorage } from '@newtab/shared/customSearchEngine/customSearchEngineStorage'
import { blockedTopSitesStorage } from '@newtab/shared/storages/topSitesStorage'

import { materializeQuickLinks, mergeSyncSettings } from './apply.ts'
import { jsonEquals, sha256Hex } from './canonical.ts'
import { captureSyncSnapshot, deduplicateInlineImages } from './capture.ts'
import { MAX_SYNC_WALLPAPER_BYTES } from './catalog.ts'
import {
  clearPendingApply,
  getPendingApply,
  getOrCreateSyncState,
  setAppliedSyncSnapshot,
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
  lockHeld = false,
): Promise<SyncSnapshotV1> {
  return (await captureBrowserSyncSnapshotResult(scope, undefined, lockHeld)).snapshot
}

export async function captureBrowserSyncSnapshotResult(
  scope: SyncScopePreferences,
  baseline?: SyncSnapshotV1,
  lockHeld = false,
): Promise<BrowserSyncCaptureResult> {
  const [settings, quickLinks, searchEngines, ui, blockedTopSites] = await Promise.all([
    settingsStorage.getValue(),
    getQuickLinksStorageValue(lockHeld),
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
    const library = await readWallpaperLibrary()
    snapshot.optional ??= {}
    snapshot.optional.wallpapers = { rotation: structuredClone(settings.background.rotation) }
    for (const variant of ['light', 'dark'] as const) {
      const group = library[variant]
      const items: SyncWallpaperV1[] = []
      for (const item of group.items) {
        const captured = await captureWallpaper(item, wallpaperStore(variant))
        const reference =
          captured.value ??
          (captured.preserveBaseline
            ? baseline?.optional?.wallpapers?.[variant]?.items.find((value) => value.id === item.id)
            : undefined)
        if (reference) items.push(reference)
        if (captured.reason)
          resourceOmissions.push({ kind: 'wallpaper', variant, reason: captured.reason })
      }
      const ids = items.map((item) => item.id)
      const previousFixed = baseline?.optional?.wallpapers?.[variant]?.fixedId
      snapshot.optional.wallpapers[variant] = {
        items: [...items].sort((a, b) => a.id.localeCompare(b.id)),
        order: ids,
        fixedId: ids.includes(group.fixedId)
          ? group.fixedId
          : previousFixed && ids.includes(previousFixed)
            ? previousFixed
            : (ids[0] ?? ''),
      }
    }
  }
  return { snapshot, resourceOmissions }
}

async function captureWallpaper(selection: WallpaperItem, store: 'wallpaper' | 'wallpaperDark') {
  if (!selection.id) return {}
  if (selection.metadataFailed)
    return { preserveBaseline: true, reason: 'unavailable' } satisfies CapturedWallpaper
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
  const cacheValid = selection.size === blob.size && selection.mimeType === blob.type
  let sha256 = cacheValid ? selection.sha256 : undefined
  if (cacheValid && selection.syncEligible === false)
    return { preserveBaseline: true, reason: 'unsupported' } satisfies CapturedWallpaper
  if (!sha256 || selection.syncEligible !== true) {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const eligible = !isAnimatedImage(bytes, blob.type)
    sha256 ??= await sha256Hex(bytes)
    const hash = sha256
    await updateWallpaperLibrary((library) => {
      const variant = store === 'wallpaper' ? 'light' : 'dark'
      const current = library[variant].items.find((item) => item.id === selection.id)
      if (current) {
        current.sha256 = hash
        current.syncEligible = eligible
        current.size = blob.size
        current.mimeType = blob.type
      }
    })
    if (!eligible)
      return { preserveBaseline: true, reason: 'unsupported' } satisfies CapturedWallpaper
  }
  return {
    value: {
      id: selection.id,
      assetId: `sha256-${sha256}`,
      size: blob.size,
      mimeType: blob.type,
      sha256,
    },
  } satisfies CapturedWallpaper
}

async function materializeSettings(snapshot: SyncSnapshotV1, scope: SyncScopePreferences) {
  const current = await settingsStorage.getValue()
  const merged =
    scope.settings && snapshot.settings
      ? mergeSyncSettings<CURRENT_CONFIG_SCHEMA>(current, snapshot.settings)
      : structuredClone(current)
  if (snapshot.scope.onlineWallpaperUrl && snapshot.optional?.onlineWallpaperUrl !== undefined) {
    merged.background.online.url = snapshot.optional.onlineWallpaperUrl
  }
  if (scope.wallpapers && snapshot.optional?.wallpapers?.rotation)
    merged.background.rotation = structuredClone(snapshot.optional.wallpapers.rotation)
  return normalizeCurrentSettings(structuredClone(merged))
}

async function continueApply(pending: PendingApplyV1, scope: SyncScopePreferences): Promise<void> {
  if (pending.phase === 'validated') {
    if (scope.wallpapers && pending.snapshot.optional?.wallpapers) {
      const alreadyApplied = await idbGet('wallpaperLibrary', `applied:${pending.operationId}`)
      if (!alreadyApplied) {
        const current = await readWallpaperLibrary()
        const protectedIds = new Map<WallpaperVariant, Set<string>>()
        for (const variant of ['light', 'dark'] as const) {
          const ids = new Set<string>()
          for (const item of current[variant].items)
            if (!(await captureWallpaper(item, wallpaperStore(variant))).value) ids.add(item.id)
          protectedIds.set(variant, ids)
        }
        const resources = new Map<string, Blob>()
        for (const wallpaper of Object.values(pending.wallpapers ?? {})) {
          const blob = await idbGet('webdavSync', wallpaper.temporaryKey)
          if (
            !(blob instanceof Blob) ||
            blob.size !== wallpaper.size ||
            blob.type !== wallpaper.mimeType ||
            (await sha256Hex(await blob.arrayBuffer())) !== wallpaper.sha256
          )
            throw new Error('Pending wallpaper resource is invalid')
          resources.set(`${wallpaper.variant}:${wallpaper.itemId}`, blob)
        }
        // 未下载的已有文件也必须匹配远端引用，不能只检查 ID 存在。
        for (const variant of ['light', 'dark'] as const) {
          for (const reference of pending.snapshot.optional.wallpapers[variant]?.items ?? []) {
            const key = `${variant}:${reference.id}`
            if (protectedIds.get(variant)!.has(reference.id) || resources.has(key)) continue
            const blob = await idbGet(wallpaperStore(variant), reference.id)
            if (
              !blob ||
              blob.size !== reference.size ||
              blob.type !== reference.mimeType ||
              (await sha256Hex(await blob.arrayBuffer())) !== reference.sha256
            )
              throw new Error('Existing wallpaper does not match incoming reference')
          }
        }
        await updateWallpaperLibrary(async (library, tx) => {
          if (
            pending.wallpaperSignature &&
            wallpaperLibrarySignature(library) !== pending.wallpaperSignature
          )
            throw new Error('Wallpaper library changed before sync apply')
          // 轮换进度可并发推进；素材变化必须重新捕获，不能覆盖用户刚完成的编辑。
          if (wallpaperLibrarySignature(library) !== wallpaperLibrarySignature(current))
            throw new Error('Wallpaper library changed during sync apply')
          for (const variant of ['light', 'dark'] as const) {
            const incoming = pending.snapshot.optional?.wallpapers?.[variant]
            if (!incoming) continue
            const group = library[variant]
            const protectedSet = protectedIds.get(variant)!
            const old = new Map(group.items.map((item) => [item.id, item]))
            const incomingItems = new Map(incoming.items.map((item) => [item.id, item]))
            for (const reference of incoming.items) {
              if (protectedSet.has(reference.id)) continue
              const blob = resources.get(`${variant}:${reference.id}`)
              if (blob) await tx.objectStore(wallpaperStore(variant)).put(blob, reference.id)
              else if (!(await tx.objectStore(wallpaperStore(variant)).get(reference.id)))
                throw new Error('Incoming wallpaper file is missing')
            }
            const replacement = incoming.order
              .filter((id) => !protectedSet.has(id))
              .map((id) => {
                const reference = incomingItems.get(id)!
                return {
                  ...(old.get(id)?.sha256 === reference.sha256 ? old.get(id) : {}),
                  id,
                  mediaType: 'image' as const,
                  size: reference.size,
                  sha256: reference.sha256,
                  syncEligible: true,
                  mimeType: reference.mimeType,
                }
              })
            const ordered: WallpaperItem[] = []
            let cursor = 0
            for (const item of group.items) {
              if (protectedSet.has(item.id)) ordered.push(item)
              else if (cursor < replacement.length) ordered.push(replacement[cursor++]!)
            }
            ordered.push(...replacement.slice(cursor))
            const orderedIds = new Set(ordered.map((item) => item.id))
            for (const item of group.items)
              if (!orderedIds.has(item.id)) {
                await tx.objectStore(wallpaperStore(variant)).delete(item.id)
                await tx.objectStore('wallpaperLibrary').delete(`thumbnail:${variant}:${item.id}`)
              }
            for (const reference of incoming.items)
              if (old.get(reference.id)?.sha256 !== reference.sha256)
                await tx
                  .objectStore('wallpaperLibrary')
                  .delete(`thumbnail:${variant}:${reference.id}`)
            group.items = ordered
            if (!protectedSet.has(group.fixedId))
              group.fixedId = orderedIds.has(incoming.fixedId)
                ? incoming.fixedId
                : (ordered[0]?.id ?? '')
          }
          await tx.objectStore('wallpaperLibrary').put(true, `applied:${pending.operationId}`)
        })
      }
      const channel = new BroadcastChannel('lemon-wallpaper-library')
      channel.postMessage(null)
      channel.close()
    }
    pending = { ...pending, phase: 'wallpapers' }
    await setPendingApply(pending)
  }
  // 普通数据与完成标记在同一次 storage.set 中提交。重启后即使有新编辑也不重放旧数据。
  const marker = 'webdavAppliedOperationId'
  if ((await browser.storage.local.get(marker))[marker] !== pending.operationId) {
    const updates: Record<string, unknown> = {}
    const phases = ['wallpapers', 'settings', 'quick-links', 'search-engines', 'ui', 'optional']
    const phase = phases.indexOf(pending.phase)
    if (phase <= 0 && (scope.settings || scope.onlineWallpaperUrl || scope.wallpapers))
      updates.settings = await materializeSettings(pending.snapshot, scope)
    if (phase <= 1 && scope.quickLinks && pending.snapshot.quickLinks)
      updates.quickLinks = materializeQuickLinks(
        pending.snapshot.quickLinks,
        await getQuickLinksStorageValue(true),
        scope.userIcons,
        pending.snapshot.inlineImages,
      )
    const engines = pending.snapshot.customSearchEngines
    if (phase <= 2 && scope.customSearchEngines && engines) {
      const current = await customSearchEngineStorage.getValue()
      const currentById = new Map(current.items.map((item) => [item.id, item]))
      const incomingById = new Map(engines.items.map((item) => [item.id, item]))
      updates.customSearchEngine = {
        items: engines.order.map((id) => {
          const item = incomingById.get(id)!
          const icon = scope.userIcons
            ? item.iconHash && pending.snapshot.inlineImages?.[item.iconHash]
            : currentById.get(id)?.icon
          return { id, name: item.name, url: item.url, ...(icon ? { icon } : {}) }
        }),
      }
    }
    if (phase <= 3 && scope.uiPreferences && pending.snapshot.ui && !pending.uiPreferencesApplied)
      updates.uiPreferences = { ...(await uiPreferencesStorage.getValue()), ...pending.snapshot.ui }
    if (phase <= 4 && scope.blockedTopSites && pending.snapshot.optional?.blockedTopSites)
      updates.blockedTopStites = pending.snapshot.optional.blockedTopSites.urls
    await browser.storage.local.set({ ...updates, [marker]: pending.operationId })
  }
  if ((await getOrCreateSyncState()).pending?.operationId === pending.operationId)
    await setAppliedSyncSnapshot({
      operationId: pending.operationId,
      revisionId: pending.revisionId,
      snapshot: pending.snapshot,
    })
  for (const wallpaper of Object.values(pending.wallpapers ?? {}))
    await idbDelete('webdavSync', wallpaper.temporaryKey)
  await clearPendingApply()
  await idbDelete('wallpaperLibrary', `applied:${pending.operationId}`)
}

export type IncomingWallpaperResources = Record<
  string,
  { variant: WallpaperVariant; itemId: string; assetId: string; blob: Blob; sha256: string }
>

export async function prepareBrowserApply(
  operationId: string,
  revisionId: string,
  snapshot: SyncSnapshotV1,
  scope: SyncScopePreferences,
  wallpapers?: IncomingWallpaperResources,
) {
  const validation = validateSyncSnapshot(snapshot)
  if (!validation.ok) throw new Error(validation.error)
  const resources: Array<readonly [string, Blob]> = []
  const pendingWallpapers: Record<string, PendingWallpaperApplyV1> = {}
  for (const [key, wallpaper] of Object.entries(wallpapers ?? {})) {
    const reference = snapshot.optional?.wallpapers?.[wallpaper.variant]?.items.find(
      (item) => item.id === wallpaper.itemId,
    )
    if (
      !reference ||
      reference.assetId !== wallpaper.assetId ||
      reference.sha256 !== wallpaper.sha256 ||
      reference.size !== wallpaper.blob.size ||
      reference.mimeType !== wallpaper.blob.type ||
      (await sha256Hex(await wallpaper.blob.arrayBuffer())) !== wallpaper.sha256
    )
      throw new Error('Incoming wallpaper does not match the validated snapshot')
    const temporaryKey = `pending-wallpaper-${operationId}-${key}`
    resources.push([temporaryKey, wallpaper.blob])
    pendingWallpapers[key] = {
      variant: wallpaper.variant,
      itemId: wallpaper.itemId,
      assetId: wallpaper.assetId,
      mimeType: wallpaper.blob.type,
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
  return { pending, resources }
}

/** 调用方持有同步写入锁；所有下载与输入资源校验已经完成。 */
export async function applyPreparedBrowserSnapshot(
  prepared: Awaited<ReturnType<typeof prepareBrowserApply>>,
  wallpaperSignature?: string,
  localBefore?: SyncSnapshotV1,
): Promise<void> {
  const pending = {
    ...prepared.pending,
    wallpaperSignature:
      wallpaperSignature ?? wallpaperLibrarySignature(await readWallpaperLibrary()),
    localBefore: localBefore ?? (await captureBrowserSyncSnapshot(prepared.pending.scope, true)),
  }
  await setPendingApply(pending, prepared.resources)
  await continueApply(pending, pending.scope)
}

export async function getLocalWallpaperBlob(
  variant: WallpaperVariant,
  expectedSha256: string,
): Promise<Blob | undefined> {
  const library = await readWallpaperLibrary()
  for (const item of library[variant].items) {
    if (item.mediaType !== 'image' || (item.sha256 && item.sha256 !== expectedSha256)) continue
    const blob = await idbGet(wallpaperStore(variant), item.id)
    if (blob && (await sha256Hex(await blob.arrayBuffer())) === expectedSha256) return blob
  }
  return undefined
}
export async function resumePendingBrowserApply(): Promise<boolean> {
  return withSyncWriteLock(async () => {
    const pending = await getPendingApply()
    if (!pending) return false
    const alreadyApplied =
      (await browser.storage.local.get('webdavAppliedOperationId')).webdavAppliedOperationId ===
      pending.operationId
    if (!alreadyApplied && pending.localBefore) {
      const current = await captureBrowserSyncSnapshot(pending.scope, true)
      // 素材事务独立提交；这里只比较尚未提交的普通数据。
      const ordinary = (value: SyncSnapshotV1) => ({
        ...value,
        optional: {
          ...value.optional,
          wallpapers: undefined,
        },
      })
      if (!jsonEquals(ordinary(current), ordinary(pending.localBefore))) {
        for (const wallpaper of Object.values(pending.wallpapers ?? {}))
          await idbDelete('webdavSync', wallpaper.temporaryKey)
        await clearPendingApply()
        return false
      }
    }
    // 尚未提交的旧应用计划遇到本机编辑时，撤销暂存计划，交回正常三方合并。
    // 已提交的计划必须继续依赖事务标记恢复，不能重复删除后来新增的素材。
    if (
      pending.phase === 'validated' &&
      pending.wallpaperSignature &&
      !(await idbGet('wallpaperLibrary', `applied:${pending.operationId}`)) &&
      pending.wallpaperSignature !== wallpaperLibrarySignature(await readWallpaperLibrary())
    ) {
      for (const wallpaper of Object.values(pending.wallpapers ?? {}))
        await idbDelete('webdavSync', wallpaper.temporaryKey)
      await clearPendingApply()
      return false
    }
    const validation = validateSyncSnapshot(pending.snapshot)
    if (!validation.ok) throw new Error(validation.error)
    await continueApply({ ...pending, snapshot: validation.value }, pending.scope)
    return true
  })
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
