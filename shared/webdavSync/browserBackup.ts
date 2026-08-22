import { migrateSettingsToCurrent, type MigratableSettings } from '@/shared/settings'
import { ensureQuickLinksStableIds, type QuickLinksData } from '@/shared/quickLinks'
import { getUiPreferences } from '@/shared/uiPreferences'

import { customSearchEngineStorage } from '@newtab/shared/customSearchEngine/customSearchEngineStorage'

import {
  parseJsonBackup,
  serializeJsonBackup,
  type ParsedLocalBackup,
} from './backupFormat.ts'
import {
  captureBrowserSyncSnapshotResult,
  prepareAndApplyBrowserSnapshot,
} from './browserData.ts'
import { captureSyncSnapshot, deduplicateInlineImages } from './capture.ts'
import { mergeImportedSnapshot } from './apply.ts'
import { DEFAULT_SYNC_SCOPE } from './localState.ts'
import type { SyncScopePreferences, SyncSnapshotV1 } from './types.ts'

const MAX_JSON_BACKUP_BYTES = 25 * 1024 * 1024
const textDecoder = new TextDecoder('utf-8', { fatal: true })

export interface PreparedBrowserImport extends ParsedLocalBackup {
  source: 'json-v1' | 'legacy-json'
  scope: SyncScopePreferences
}

export async function createBrowserJsonBackup() {
  const capture = await captureBrowserSyncSnapshotResult({
    settings: true,
    quickLinks: true,
    customSearchEngines: true,
    uiPreferences: true,
    blockedTopSites: true,
    wallpapers: false,
    onlineWallpaperUrl: true,
    userIcons: true,
  })
  return { json: serializeJsonBackup(capture.snapshot), omissions: capture.resourceOmissions }
}

export async function prepareBrowserImport(file: Blob): Promise<PreparedBrowserImport> {
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
      scope: inferImportScope(parsed.snapshot),
    }
  } catch {
    return prepareLegacyImport(value)
  }
}

export async function mergePreparedBrowserImport(
  input: PreparedBrowserImport,
  scope: SyncScopePreferences,
): Promise<SyncSnapshotV1> {
  const current = await captureBrowserSyncSnapshotResult(scope)
  return mergeImportedSnapshot(current.snapshot, input.snapshot)
}

export function applyPreparedBrowserImport(
  input: PreparedBrowserImport,
  snapshot: SyncSnapshotV1 = input.snapshot,
): Promise<void> {
  return prepareAndApplyBrowserSnapshot(
    crypto.randomUUID(),
    crypto.randomUUID(),
    snapshot,
    snapshot.scope,
  )
}

function inferImportScope(snapshot: SyncSnapshotV1): SyncScopePreferences {
  return {
    settings: Boolean(snapshot.settings),
    quickLinks: Boolean(snapshot.quickLinks),
    customSearchEngines: Boolean(snapshot.customSearchEngines),
    uiPreferences: Boolean(snapshot.ui),
    blockedTopSites: Boolean(snapshot.optional?.blockedTopSites),
    wallpapers: false,
    onlineWallpaperUrl: snapshot.optional?.onlineWallpaperUrl !== undefined,
    userIcons: Boolean(snapshot.inlineImages),
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
    captureBrowserSyncSnapshotResult({ ...DEFAULT_SYNC_SCOPE }).then((result) => result.snapshot),
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
      language: ui.language || current.ui?.language || 'en',
      colorMode: ui.colorMode || current.ui?.colorMode || 'auto',
    },
    scope: { ...DEFAULT_SYNC_SCOPE, userIcons: false },
  })
  await deduplicateInlineImages(snapshot)
  return {
    snapshot,
    source: 'legacy-json',
    scope: { ...DEFAULT_SYNC_SCOPE, userIcons: false },
  }
}

function materializeLegacyQuickLinks(snapshot: SyncSnapshotV1): QuickLinksData {
  const quickLinks = snapshot.quickLinks ?? { items: [], rootOrder: [], groups: [], groupOrder: [] }
  const items = new Map(quickLinks.items.map((item) => [item.id, { ...item }]))
  return quickLinks.groups.length
    ? {
        items: quickLinks.items.map((item) => ({ ...item })),
        groups: quickLinks.groupOrder.map((id) => {
          const group = quickLinks.groups.find((item) => item.id === id)!
          return {
            id: group.id,
            name: group.name,
            items: group.itemIds.map((itemId) => items.get(itemId)!),
          }
        }),
      }
    : {
        items: quickLinks.rootOrder.map((id) => items.get(id)!),
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
