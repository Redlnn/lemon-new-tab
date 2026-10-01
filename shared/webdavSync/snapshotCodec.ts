import { assertNoteSnapshotSize, NoteSaveError, projectNote } from '../notes/model.ts'
import { migrateSyncSettings } from '../settings/migrate/sync.ts'

import { pruneInlineImages } from './apply.ts'
import { SYNC_SCOPE_KEYS } from './domains.ts'
import { pickSyncSettings } from './settingsWhitelist.ts'
import { normalizeSnapshotOrder } from './snapshotOrder.ts'
import type { SyncSnapshotV1 } from './types.ts'
import { validateSyncSnapshot } from './validation.ts'
import { requireSupportedSource, type SyncSource } from './version.ts'

function fields<T extends object>(value: T, keys: readonly (keyof T)[]): T {
  return Object.fromEntries(
    keys.filter((key) => value[key] !== undefined).map((key) => [key, structuredClone(value[key])]),
  ) as T
}

/** 原始传输内容/hash 已验证后，生成只包含当前结构的工作副本。 */
export function decodeSyncSnapshot(
  value: SyncSnapshotV1,
  source: SyncSource,
  pluginVersion: string,
): SyncSnapshotV1 {
  requireSupportedSource(source, pluginVersion)
  const snapshot: SyncSnapshotV1 = { scope: fields(value.scope, SYNC_SCOPE_KEYS) }
  if (value.settings)
    snapshot.settings = pickSyncSettings(
      migrateSyncSettings(value.settings, source.settingsSchemaVersion),
    )
  if (value.quickLinks)
    snapshot.quickLinks = {
      items: value.quickLinks.items.map((item) =>
        fields(item, ['id', 'url', 'title', 'faviconHash', 'appId']),
      ),
      rootOrder: [...value.quickLinks.rootOrder],
      groups: value.quickLinks.groups.map((group) => fields(group, ['id', 'name', 'itemIds'])),
      groupOrder: [...value.quickLinks.groupOrder],
    }
  if (value.notes)
    snapshot.notes = {
      items: value.notes.items.map(projectNote),
    }
  if (value.customSearchEngines)
    snapshot.customSearchEngines = {
      items: value.customSearchEngines.items.map((item) =>
        fields(item, ['id', 'name', 'url', 'iconHash']),
      ),
      order: [...value.customSearchEngines.order],
    }
  if (value.ui) snapshot.ui = fields(value.ui, ['language', 'colorMode'])
  if (value.optional) {
    snapshot.optional = {}
    if (value.optional.blockedTopSites)
      snapshot.optional.blockedTopSites = { urls: [...value.optional.blockedTopSites.urls] }
    if (value.optional.onlineWallpaperUrl !== undefined)
      snapshot.optional.onlineWallpaperUrl = value.optional.onlineWallpaperUrl
    if (value.optional.wallpapers) {
      const wallpapers: NonNullable<SyncSnapshotV1['optional']>['wallpapers'] = {}
      for (const variant of ['light', 'dark'] as const) {
        const group = value.optional.wallpapers[variant]
        if (group)
          wallpapers[variant] = {
            items: group.items.map((item) =>
              fields(item, ['id', 'assetId', 'size', 'mimeType', 'sha256']),
            ),
            order: [...group.order],
            fixedId: group.fixedId,
          }
      }
      if (value.optional.wallpapers.rotation)
        wallpapers.rotation = fields(value.optional.wallpapers.rotation, ['enabled', 'order'])
      snapshot.optional.wallpapers = wallpapers
    }
    if (!Object.keys(snapshot.optional).length) delete snapshot.optional
  }
  snapshot.inlineImages = value.inlineImages
  pruneInlineImages(snapshot)
  if (snapshot.notes) assertNoteSnapshotSize({ notes: snapshot.notes.items })
  const validation = validateSyncSnapshot(snapshot)
  if (!validation.ok) {
    if (validation.error === 'Sync snapshot is too large')
      throw new NoteSaveError('snapshotTooLarge')
    throw new TypeError(validation.error)
  }
  return normalizeSnapshotOrder(snapshot)
}
