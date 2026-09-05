import { sha256Hex } from './canonical.ts'
import {
  MAX_SYNC_INLINE_IMAGE_BYTES,
  MAX_SYNC_INLINE_IMAGES_BYTES,
  toSyncBlockedTopSites,
  toSyncCustomSearchEngines,
  toSyncQuickLinks,
  type CaptureContext,
} from './catalog.ts'
import { pickSyncSettings } from './settingsWhitelist.ts'
import type {
  LocalResourceOmission,
  SyncCustomSearchEngineV1,
  SyncQuickLinkV1,
  SyncSnapshotV1,
} from './types.ts'

function onlineWallpaperUrl(settings: unknown): string | undefined {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return undefined
  const background = (settings as Record<string, unknown>).background
  if (!background || typeof background !== 'object' || Array.isArray(background)) return undefined
  const online = (background as Record<string, unknown>).online
  if (!online || typeof online !== 'object' || Array.isArray(online)) return undefined
  const url = (online as Record<string, unknown>).url
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
  if (context.scope.customSearchEngines) {
    snapshot.customSearchEngines = toSyncCustomSearchEngines(
      context.customSearchEngines,
      context.scope.userIcons,
    )
  }
  if (context.scope.uiPreferences) snapshot.ui = { ...context.ui }
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
  return snapshot
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

function baselineHash(
  baseline: SyncSnapshotV1 | undefined,
  candidate: Pick<ImageCandidate, 'id' | 'kind'>,
): string | undefined {
  return candidate.kind === 'quick-link-icon'
    ? baseline?.quickLinks?.items.find((item) => item.id === candidate.id)?.faviconHash
    : baseline?.customSearchEngines?.items.find((item) => item.id === candidate.id)?.iconHash
}

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
  for (const item of snapshot.quickLinks?.items ?? []) {
    if (!item.favicon) continue
    candidates.push({
      baselineHash: baselineHash(baseline, { id: item.id, kind: 'quick-link-icon' }),
      bytes: encoder.encode(item.favicon).byteLength,
      hash: await sha256Hex(item.favicon),
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
      baselineHash: baselineHash(baseline, { id: item.id, kind: 'search-engine-icon' }),
      bytes: encoder.encode(item.icon).byteLength,
      hash: await sha256Hex(item.icon),
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
  for (const candidate of valid) unique.set(candidate.hash, candidate)
  let total = [...unique.values()].reduce((sum, candidate) => sum + candidate.bytes, 0)
  const omittedHashes = new Set<string>()
  for (const candidate of [...unique.values()].sort((left, right) => {
    const leftKnown = left.hash === left.baselineHash ? 1 : 0
    const rightKnown = right.hash === right.baselineHash ? 1 : 0
    return leftKnown - rightKnown || right.bytes - left.bytes || left.hash.localeCompare(right.hash)
  })) {
    if (total <= MAX_SYNC_INLINE_IMAGES_BYTES) break
    omittedHashes.add(candidate.hash)
    total -= candidate.bytes
  }

  for (const candidate of valid) {
    if (omittedHashes.has(candidate.hash)) {
      keepBaselineImage(snapshot, baseline, candidate)
      omissions.push({ kind: candidate.kind, id: candidate.id, reason: 'aggregate-too-large' })
      continue
    }
    snapshot.inlineImages ??= {}
    snapshot.inlineImages[candidate.hash] = candidate.value
    if (candidate.kind === 'quick-link-icon') candidate.owner.faviconHash = candidate.hash
    else candidate.owner.iconHash = candidate.hash
  }
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
