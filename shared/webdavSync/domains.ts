import type { SyncConflict, SyncScopePreferences, SyncSnapshotV1 } from './types.ts'

export const SYNC_DOMAINS = [
  { id: 'settings', path: 'settings', storageKey: 'settings' },
  { id: 'quickLinks', path: 'quickLinks', storageKey: 'quickLinks' },
  { id: 'notes', path: 'notes', storageKey: 'notes' },
  { id: 'customSearchEngines', path: 'customSearchEngines', storageKey: 'customSearchEngine' },
  { id: 'uiPreferences', path: 'ui', storageKey: 'uiPreferences' },
  { id: 'blockedTopSites', path: 'blockedTopSites', storageKey: 'blockedTopStites' },
  { id: 'wallpapers', path: 'wallpapers', storageKey: undefined },
  { id: 'onlineWallpaperUrl', path: 'onlineWallpaperUrl', storageKey: 'settings' },
  { id: 'userIcons', path: 'inlineImages', storageKey: undefined },
] as const satisfies readonly {
  id: keyof SyncScopePreferences
  path: string
  storageKey: string | undefined
}[]

export const SYNC_SCOPE_KEYS = SYNC_DOMAINS.map(({ id }) => id)
export const SYNC_DATA_KEYS = new Set<string>(
  SYNC_DOMAINS.flatMap(({ storageKey }) => (storageKey ? [storageKey] : [])),
)

export const SYNC_ENTITIES = [
  {
    type: 'quick-link',
    category: 'quick-links',
    path: 'quickLinks.items',
    items: (s: SyncSnapshotV1) => s.quickLinks?.items,
    canKeepBoth: true,
  },
  {
    type: 'quick-link-group',
    category: 'quick-links',
    path: 'quickLinks.groups',
    items: (s: SyncSnapshotV1) => s.quickLinks?.groups,
    canKeepBoth: false,
  },
  {
    type: 'note',
    category: 'notes',
    path: 'notes.items',
    items: (s: SyncSnapshotV1) => s.notes?.items,
    canKeepBoth: true,
  },
  {
    type: 'custom-search-engine',
    category: 'search-engines',
    path: 'customSearchEngines.items',
    items: (s: SyncSnapshotV1) => s.customSearchEngines?.items,
    canKeepBoth: true,
  },
  ...(['light', 'dark'] as const).map(
    (variant) =>
      ({
        type: `wallpaper-${variant}`,
        category: 'wallpaper',
        path: `optional.wallpapers.${variant}.items`,
        items: (s: SyncSnapshotV1) => s.optional?.wallpapers?.[variant]?.items,
        canKeepBoth: true,
      }) as const,
  ),
] as const satisfies readonly {
  type: string
  category: SyncConflict['category']
  path: string
  items: (s: SyncSnapshotV1) => readonly { id: string }[] | undefined
  canKeepBoth: boolean
}[]

/** 远端只记录数据覆盖情况；不携带本机开关。 */
export function snapshotCoverage(snapshot: SyncSnapshotV1): SyncScopePreferences {
  return Object.fromEntries(
    SYNC_DOMAINS.map(({ id, path }) => [
      id,
      path in snapshot
        ? snapshot[path as keyof SyncSnapshotV1] !== undefined
        : snapshot.optional?.[path as keyof NonNullable<SyncSnapshotV1['optional']>] !== undefined,
    ]),
  ) as unknown as SyncScopePreferences
}

export const DEFAULT_SYNC_SCOPE: Readonly<SyncScopePreferences> = {
  settings: true,
  quickLinks: true,
  notes: true,
  customSearchEngines: true,
  uiPreferences: true,
  blockedTopSites: false,
  wallpapers: false,
  onlineWallpaperUrl: false,
  userIcons: false,
}
