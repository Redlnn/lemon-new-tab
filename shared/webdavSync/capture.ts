import { sha256Hex } from '../json.ts'
import { projectNote } from '../notes/model.ts'

import {
  MAX_SYNC_INLINE_IMAGE_BYTES,
  MAX_SYNC_INLINE_IMAGES_BYTES,
  toSyncBlockedTopSites,
  toSyncCustomSearchEngines,
  toSyncQuickLinks,
  type CaptureContext,
} from './catalog.ts'
import { pickSyncSettings } from './settingsWhitelist.ts'
import { normalizeSnapshotOrder } from './snapshotOrder.ts'
import type {
  LocalResourceOmission,
  SyncCustomSearchEngineV1,
  SyncQuickLinkV1,
  SyncSnapshotV1,
} from './types.ts'

function onlineWallpaperUrl(settings: unknown): string | undefined {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return undefined
  const { background } = settings as Record<string, unknown>
  if (!background || typeof background !== 'object' || Array.isArray(background)) return undefined
  const { online } = background as Record<string, unknown>
  if (!online || typeof online !== 'object' || Array.isArray(online)) return undefined
  const { url } = online as Record<string, unknown>
  return typeof url === 'string' ? url : undefined
}

export function sanitizeSettings(settings: unknown) {
  return pickSyncSettings(settings)
}

export function captureSyncSnapshot(context: CaptureContext): SyncSnapshotV1 {
  const snapshot: SyncSnapshotV1 = { scope: { ...context.scope } }
  if (context.scope.settings) snapshot.settings = sanitizeSettings(context.settings)
  if (context.scope.quickLinks) {
    snapshot.quickLinks = toSyncQuickLinks(context.quickLinks, context.scope.userIcons)
  }
  if (context.scope.notes && context.notes) {
    snapshot.notes = { items: context.notes.notes.map(projectNote) }
  }
  if (context.scope.customSearchEngines) {
    snapshot.customSearchEngines = toSyncCustomSearchEngines(
      context.customSearchEngines,
      context.scope.userIcons,
    )
  }
  if (context.scope.uiPreferences)
    snapshot.ui = { language: context.ui.language, colorMode: context.ui.colorMode }
  if (context.scope.blockedTopSites && context.blockedTopSites) {
    snapshot.optional = {
      ...snapshot.optional,
      blockedTopSites: toSyncBlockedTopSites(context.blockedTopSites),
    }
  }
  if (context.scope.onlineWallpaperUrl) {
    const url = onlineWallpaperUrl(context.settings)
    if (url !== undefined) snapshot.optional = { ...snapshot.optional, onlineWallpaperUrl: url }
  }
  return normalizeSnapshotOrder(snapshot)
}

interface BaseImageCandidate {
  baselineHash?: string
  bytes: number
  id: string
  hash: string
  value: string
}

type ImageCandidate = BaseImageCandidate &
  (
    | { kind: 'quick-link-icon'; owner: SyncQuickLinkV1 }
    | { kind: 'search-engine-icon'; owner: SyncCustomSearchEngineV1 }
  )

function keepBaselineImage(
  snapshot: SyncSnapshotV1,
  baseline: SyncSnapshotV1 | undefined,
  candidate: ImageCandidate,
): void {
  if (!candidate.baselineHash) return
  const value = baseline?.inlineImages?.[candidate.baselineHash]
  if (!value) return
  snapshot.inlineImages ??= {}
  snapshot.inlineImages[candidate.baselineHash] = value
  if (candidate.kind === 'quick-link-icon') candidate.owner.faviconHash = candidate.baselineHash
  else candidate.owner.iconHash = candidate.baselineHash
}

export async function deduplicateInlineImages(
  snapshot: SyncSnapshotV1,
  baseline?: SyncSnapshotV1,
): Promise<LocalResourceOmission[]> {
  const encoder = new TextEncoder()
  const candidates: ImageCandidate[] = []
  const baselineHashes = new Map([
    ...(baseline?.quickLinks?.items ?? []).map(
      (item) => ['quick-link-icon:' + item.id, item.faviconHash] as const,
    ),
    ...(baseline?.customSearchEngines?.items ?? []).map(
      (item) => ['search-engine-icon:' + item.id, item.iconHash] as const,
    ),
  ])
  const images = new Map<string, Promise<{ bytes: number; hash: string }>>()
  const imageInfo = (value: string) => {
    let info = images.get(value)
    if (!info) {
      const bytes = encoder.encode(value)
      info = sha256Hex(bytes).then((hash) => ({ bytes: bytes.byteLength, hash }))
      images.set(value, info)
    }
    return info
  }
  for (const item of snapshot.quickLinks?.items ?? []) {
    if (!item.favicon) continue
    candidates.push({
      baselineHash: baselineHashes.get('quick-link-icon:' + item.id),
      ...(await imageInfo(item.favicon)),
      id: item.id,
      kind: 'quick-link-icon',
      owner: item,
      value: item.favicon,
    })
    delete item.favicon
  }
  for (const item of snapshot.customSearchEngines?.items ?? []) {
    if (!item.icon) continue
    candidates.push({
      baselineHash: baselineHashes.get('search-engine-icon:' + item.id),
      ...(await imageInfo(item.icon)),
      id: item.id,
      kind: 'search-engine-icon',
      owner: item,
      value: item.icon,
    })
    delete item.icon
  }

  const omissions: LocalResourceOmission[] = []
  const valid = candidates.filter((candidate) => {
    if (candidate.bytes <= MAX_SYNC_INLINE_IMAGE_BYTES) return true
    keepBaselineImage(snapshot, baseline, candidate)
    omissions.push({ kind: candidate.kind, id: candidate.id, reason: 'item-too-large' })
    return false
  })
  const unique = new Map<string, ImageCandidate>()
  const owners = new Map<string, ImageCandidate[]>()
  for (const candidate of valid) {
    unique.set(candidate.hash, candidate)
    const references = owners.get(candidate.hash) ?? []
    references.push(candidate)
    owners.set(candidate.hash, references)
    snapshot.inlineImages ??= {}
    snapshot.inlineImages[candidate.hash] = candidate.value
    if (candidate.kind === 'quick-link-icon') candidate.owner.faviconHash = candidate.hash
    else candidate.owner.iconHash = candidate.hash
  }
  const counts = new Map<string, number>()
  const sizes = new Map<string, number>()
  let total = 0
  const retain = (hash: string) => {
    const count = counts.get(hash) ?? 0
    if (!count) {
      if (!sizes.has(hash))
        sizes.set(hash, encoder.encode(snapshot.inlineImages![hash]!).byteLength)
      total += sizes.get(hash)!
    }
    counts.set(hash, count + 1)
  }
  for (const item of snapshot.quickLinks?.items ?? [])
    if (item.faviconHash) retain(item.faviconHash)
  for (const item of snapshot.customSearchEngines?.items ?? [])
    if (item.iconHash) retain(item.iconHash)
  // 按最终引用计量；回退旧图标也占预算，同一图像的多个引用只计算一次。
  for (const candidate of [...unique.values()].sort((left, right) => {
    const leftKnown = left.hash === left.baselineHash ? 1 : 0
    const rightKnown = right.hash === right.baselineHash ? 1 : 0
    return leftKnown - rightKnown || right.bytes - left.bytes || left.hash.localeCompare(right.hash)
  })) {
    if (total <= MAX_SYNC_INLINE_IMAGES_BYTES) break
    for (const reference of owners.get(candidate.hash)!) {
      const count = counts.get(candidate.hash)! - 1
      counts.set(candidate.hash, count)
      if (!count) total -= sizes.get(candidate.hash)!
      if (reference.kind === 'quick-link-icon') delete reference.owner.faviconHash
      else delete reference.owner.iconHash
      keepBaselineImage(snapshot, baseline, reference)
      if (reference.baselineHash && baseline?.inlineImages?.[reference.baselineHash])
        retain(reference.baselineHash)
      omissions.push({ kind: reference.kind, id: reference.id, reason: 'aggregate-too-large' })
    }
  }
  if (snapshot.inlineImages)
    snapshot.inlineImages = Object.fromEntries(
      Object.entries(snapshot.inlineImages).filter(([hash]) => (counts.get(hash) ?? 0) > 0),
    )
  if (snapshot.inlineImages && Object.keys(snapshot.inlineImages).length === 0) {
    delete snapshot.inlineImages
  }
  return omissions
}

export async function inlineImageHashesAreValid(snapshot: SyncSnapshotV1): Promise<boolean> {
  const images = snapshot.inlineImages ?? {}
  for (const [hash, value] of Object.entries(images)) {
    if ((await sha256Hex(value)) !== hash) return false
  }
  const references = [
    ...(snapshot.quickLinks?.items.map((item) => item.faviconHash) ?? []),
    ...(snapshot.customSearchEngines?.items.map((item) => item.iconHash) ?? []),
  ].filter((hash): hash is string => Boolean(hash))
  return references.every((hash) => Object.hasOwn(images, hash))
}
