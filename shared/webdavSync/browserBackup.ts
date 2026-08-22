import { migrateSettingsToCurrent, type MigratableSettings } from '@/shared/settings'
import { ensureQuickLinksStableIds, type QuickLinksData } from '@/shared/quickLinks'
import { getUiPreferences } from '@/shared/uiPreferences'

import { customSearchEngineStorage } from '@newtab/shared/customSearchEngine/customSearchEngineStorage'

import {
  createLocalBackupArchive,
  parseJsonBackup,
  parseLocalBackupArchive,
  serializeJsonBackup,
  type ParsedLocalBackup,
} from './archive.ts'
import {
  captureBrowserSyncSnapshot,
  getLocalWallpaperBlob,
  prepareAndApplyBrowserSnapshot,
} from './browserData.ts'
import { captureSyncSnapshot } from './capture.ts'
import { mergeImportedSnapshot } from './apply.ts'
import { DEFAULT_SYNC_SCOPE } from './localState.ts'
import type { SyncScopePreferences, SyncSnapshotV1 } from './types.ts'

const MAX_JSON_BACKUP_BYTES = 25 * 1024 * 1024
const textDecoder = new TextDecoder('utf-8', { fatal: true })

export interface PreparedBrowserImport extends ParsedLocalBackup {
  source: 'archive-v1' | 'json-v1' | 'legacy-json'
  scope: SyncScopePreferences
}

export async function createBrowserJsonBackup(): Promise<string> {
  const snapshot = await captureBrowserSyncSnapshot({ ...DEFAULT_SYNC_SCOPE, wallpapers: false })
  return serializeJsonBackup(snapshot)
}

export async function createBrowserBackupArchive(): Promise<Blob> {
  const scope = { ...DEFAULT_SYNC_SCOPE, wallpapers: true }
  const snapshot = await captureBrowserSyncSnapshot(scope)
  const wallpapers: ParsedLocalBackup['wallpapers'] = {}
  for (const variant of ['light', 'dark'] as const) {
    const reference = snapshot.optional?.wallpapers?.[variant]
    if (reference) {
      const blob = await getLocalWallpaperBlob(variant, reference.sha256)
      if (blob) wallpapers[variant] = blob
    }
  }
  return createLocalBackupArchive(snapshot, wallpapers)
}

export async function prepareBrowserImport(file: Blob): Promise<PreparedBrowserImport> {
  const prefix = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  if (new TextDecoder().decode(prefix) === 'LEMONBACKUP\0') {
    const parsed = await parseLocalBackupArchive(file)
    return {
      ...parsed,
      source: 'archive-v1',
      scope: inferImportScope(parsed.snapshot, true),
    }
  }
  if (file.size > MAX_JSON_BACKUP_BYTES) throw new TypeError('JSON backup is too large')
  let value: unknown
  try {
    value = JSON.parse(textDecoder.decode(await file.arrayBuffer())) as unknown
  } catch {
    throw new TypeError('JSON backup is invalid')
  }
  try {
    const parsed = parseJsonBackup(value)
    return {
      ...parsed,
      source: 'json-v1',
      scope: inferImportScope(parsed.snapshot, false),
    }
  } catch {
    return prepareLegacyImport(value)
  }
}

export function getPreparedImportWallpapers(
  input: PreparedBrowserImport,
): Partial<Record<'dark' | 'light', Blob>> {
  return { ...input.wallpapers }
}

export async function mergePreparedBrowserImport(
  input: PreparedBrowserImport,
  scope: SyncScopePreferences,
): Promise<SyncSnapshotV1> {
  return mergeImportedSnapshot(await captureBrowserSyncSnapshot(scope), input.snapshot)
}

export function applyPreparedBrowserImport(
  input: PreparedBrowserImport,
  snapshot: SyncSnapshotV1 = input.snapshot,
): Promise<void> {
  const wallpapers = Object.fromEntries(
    Object.entries(input.wallpapers).map(([variant, blob]) => {
      const reference = input.snapshot.optional?.wallpapers?.[variant as 'dark' | 'light']
      if (!reference) throw new TypeError('Imported wallpaper reference is missing')
      return [variant, { assetId: reference.assetId, blob, sha256: reference.sha256 }]
    }),
  )
  return prepareAndApplyBrowserSnapshot(
    crypto.randomUUID(),
    crypto.randomUUID(),
    snapshot,
    input.scope,
    wallpapers,
  )
}

function inferImportScope(
  snapshot: SyncSnapshotV1,
  wallpapers: boolean,
): SyncScopePreferences {
  return {
    searchHistory: Boolean(snapshot.optional?.searchHistory),
    blockedTopSites: Boolean(snapshot.optional?.blockedTopSites),
    wallpapers: wallpapers && Boolean(snapshot.optional?.wallpapers),
    onlineWallpaperUrl: true,
    quickLinkIcons: true,
  }
}

async function prepareLegacyImport(value: unknown): Promise<PreparedBrowserImport> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Legacy backup must be an object')
  }
  const record = value as Record<string, unknown>
  const quickLinksValue =
    record.quickLinks ?? record.bookmark ?? record.bookmarks ?? record.shortcuts
  const hasKnownField =
    record.settings !== undefined ||
    quickLinksValue !== undefined ||
    record.customSearchEngines !== undefined
  if (!hasKnownField) throw new TypeError('Backup format is unsupported')

  const [current, currentEngines, ui] = await Promise.all([
    captureBrowserSyncSnapshot({ ...DEFAULT_SYNC_SCOPE }),
    customSearchEngineStorage.getValue(),
    getUiPreferences(),
  ])
  let settings: unknown = current.settings
  if (record.settings !== undefined) {
    if (!isRecord(record.settings) || !Number.isSafeInteger(record.settings.version)) {
      throw new TypeError('Legacy settings version is invalid')
    }
    settings = migrateSettingsToCurrent(record.settings as unknown as MigratableSettings).settings
  }
  let quickLinks: QuickLinksData = materializeLegacyQuickLinks(current)
  if (quickLinksValue !== undefined) {
    if (!isQuickLinksData(quickLinksValue)) throw new TypeError('Legacy Quick Links are invalid')
    quickLinks = ensureQuickLinksStableIds(structuredClone(quickLinksValue)).value
  }
  let customSearchEngines = currentEngines
  if (record.customSearchEngines !== undefined) {
    if (!isCustomSearchEngines(record.customSearchEngines)) {
      throw new TypeError('Legacy custom search engines are invalid')
    }
    customSearchEngines = structuredClone(record.customSearchEngines)
  }
  const snapshot = captureSyncSnapshot({
    settings,
    quickLinks,
    customSearchEngines,
    ui: {
      language: ui.language || current.ui.language,
      colorMode: ui.colorMode || current.ui.colorMode,
    },
    scope: { ...DEFAULT_SYNC_SCOPE, quickLinkIcons: false },
  })
  return {
    snapshot,
    wallpapers: {},
    source: 'legacy-json',
    scope: { ...DEFAULT_SYNC_SCOPE, quickLinkIcons: false },
  }
}

function materializeLegacyQuickLinks(snapshot: SyncSnapshotV1): QuickLinksData {
  const items = new Map(snapshot.quickLinks.items.map((item) => [item.id, { ...item }]))
  return snapshot.quickLinks.groups.length
    ? {
        items: snapshot.quickLinks.items.map((item) => ({ ...item })),
        groups: snapshot.quickLinks.groupOrder.map((id) => {
          const group = snapshot.quickLinks.groups.find((item) => item.id === id)!
          return {
            id: group.id,
            name: group.name,
            items: group.itemIds.map((itemId) => items.get(itemId)!),
          }
        }),
      }
    : {
        items: snapshot.quickLinks.rootOrder.map((id) => items.get(id)!),
        groups: [],
      }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isQuickLinksData(value: unknown): value is QuickLinksData {
  if (!isRecord(value) || !Array.isArray(value.items)) return false
  const itemsValid = value.items.every(
    (item) => isRecord(item) && typeof item.url === 'string' && typeof item.title === 'string',
  )
  const groupsValid =
    value.groups === undefined ||
    (Array.isArray(value.groups) &&
      value.groups.every(
        (group) =>
          isRecord(group) &&
          typeof group.id === 'string' &&
          typeof group.name === 'string' &&
          Array.isArray(group.items) &&
          group.items.every(
            (item) =>
              isRecord(item) && typeof item.url === 'string' && typeof item.title === 'string',
          ),
      ))
  return itemsValid && groupsValid
}

function isCustomSearchEngines(
  value: unknown,
): value is { items: Array<{ id: string; name: string; url: string; icon?: string }> } {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.url === 'string' &&
        (item.icon === undefined || typeof item.icon === 'string'),
    )
  )
}
