import { toSyncBlockedTopSites, toSyncCustomSearchEngines, toSyncQuickLinks } from './catalog.ts'
import type { CaptureContext } from './catalog.ts'
import { canonicalize } from './canonical.ts'
import type { JsonObject, SyncSnapshotV1 } from './types.ts'

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Settings must be an object')
  }
  return value as Record<string, unknown>
}

export function sanitizeSettings(
  settings: unknown,
  options: { includeOnlineWallpaperUrl?: boolean } = {},
): JsonObject {
  const sanitized = structuredClone(asObject(settings))
  delete sanitized.sync
  delete sanitized.readChangeLog
  delete sanitized.pluginVersion

  const background = sanitized.background
  if (background && typeof background === 'object' && !Array.isArray(background)) {
    const record = background as Record<string, unknown>
    delete record.local
    delete record.localDark

    const bing = record.bing
    if (bing && typeof bing === 'object' && !Array.isArray(bing)) {
      const resolution = (bing as Record<string, unknown>).resolution
      record.bing = resolution === 'uhd' ? { resolution: 'uhd' } : { resolution: '1080p' }
    }

    if (options.includeOnlineWallpaperUrl === false) {
      const online = record.online
      if (online && typeof online === 'object' && !Array.isArray(online)) {
        delete (online as Record<string, unknown>).url
      }
    }
  }

  const normalized = canonicalize(sanitized)
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw new TypeError('Sanitized settings must be an object')
  }
  return normalized
}

export function captureSyncSnapshot(context: CaptureContext): SyncSnapshotV1 {
  const snapshot: SyncSnapshotV1 = {
    settings: sanitizeSettings(context.settings, {
      includeOnlineWallpaperUrl: context.scope.onlineWallpaperUrl,
    }),
    quickLinks: toSyncQuickLinks(context.quickLinks, context.scope.quickLinkIcons),
    customSearchEngines: toSyncCustomSearchEngines(context.customSearchEngines),
    ui: { ...context.ui },
  }

  if (context.scope.searchHistory && context.searchHistory) {
    snapshot.optional ??= {}
    snapshot.optional.searchHistory = {
      items: context.searchHistory.map((entry) => ({ ...entry })),
      order: context.searchHistory.map((entry) => entry.id),
    }
  }
  if (context.scope.blockedTopSites && context.blockedTopSites) {
    snapshot.optional ??= {}
    snapshot.optional.blockedTopSites = toSyncBlockedTopSites(context.blockedTopSites)
  }

  return snapshot
}
