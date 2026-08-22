import type {
  SyncAvailability,
  SyncBlockedTopSitesV1,
  SyncCustomSearchEngineDataV1,
  SyncQuickLinksDataV1,
  SyncScopePreferences,
  SyncSnapshotV1,
} from './types.ts'

export const MAX_SYNC_WALLPAPER_BYTES = 20 * 1024 * 1024
export const MAX_SYNC_INLINE_IMAGE_BYTES = 2 * 1024 * 1024
export const MAX_SYNC_INLINE_IMAGES_BYTES = 8 * 1024 * 1024
export const MAX_SYNC_SNAPSHOT_BYTES = 10 * 1024 * 1024

export type SyncCatalogKey =
  | 'settings'
  | 'quickLinks'
  | 'customSearchEngines'
  | 'ui.language'
  | 'ui.colorMode'
  | 'searchHistory'
  | 'blockedTopSites'
  | 'onlineWallpaperUrl'
  | 'userIcons'
  | 'wallpaper.light'
  | 'wallpaper.dark'
  | 'faviconCache'
  | 'bookmarks'
  | 'onlineWallpaperCache'
  | 'permission.monet'
  | 'permission.favicon'
  | 'permission.wallpaper'

export interface CapturableQuickLink {
  id?: string
  url: string
  title: string
  favicon?: string
  faviconSource?: 'automatic' | 'user-selected'
}

export interface CapturableQuickLinkGroup {
  id: string
  name: string
  items: CapturableQuickLink[]
}

export interface CaptureContext {
  settings: unknown
  quickLinks: {
    items: CapturableQuickLink[]
    groups?: CapturableQuickLinkGroup[]
  }
  customSearchEngines: {
    items: Array<{ id: string; name: string; url: string; icon?: string }>
  }
  ui: NonNullable<SyncSnapshotV1['ui']>
  scope: SyncScopePreferences
  blockedTopSites?: string[]
}

export interface WallpaperAvailabilityContext {
  failed?: boolean
  mediaType?: 'image' | 'video'
  selected: boolean
  size?: number
}

export interface AvailabilityContext {
  scope: SyncScopePreferences
  pendingPermissions?: ReadonlySet<'favicon' | 'monet' | 'wallpaper'>
  wallpapers?: {
    light?: WallpaperAvailabilityContext
    dark?: WallpaperAvailabilityContext
  }
}

const included = (): SyncAvailability => ({ state: 'included' })
const excludedByDesign = (reasonKey: string): SyncAvailability => ({
  state: 'excluded-by-design',
  reasonKey,
})
const excludedByUser = (reasonKey: string): SyncAvailability => ({
  state: 'excluded-by-user',
  reasonKey,
})

function wallpaperAvailability(
  variant: 'dark' | 'light',
  context: AvailabilityContext,
): SyncAvailability {
  const wallpaper = context.wallpapers?.[variant]
  if (wallpaper?.mediaType === 'video') {
    return { state: 'unsupported-resource', reasonKey: 'sync.availability.wallpaperVideo' }
  }
  if (!context.scope.wallpapers || !wallpaper?.selected) {
    return excludedByUser('sync.availability.wallpaperScopeDisabled')
  }
  if ((wallpaper.size ?? 0) > MAX_SYNC_WALLPAPER_BYTES) {
    return { state: 'too-large', reasonKey: 'sync.availability.wallpaperTooLarge' }
  }
  if (wallpaper.failed) {
    return { state: 'failed', reasonKey: 'sync.availability.wallpaperFailed' }
  }
  return included()
}

function permissionAvailability(
  permission: 'favicon' | 'monet' | 'wallpaper',
  context: AvailabilityContext,
): SyncAvailability {
  return context.pendingPermissions?.has(permission)
    ? { state: 'pending-permission', reasonKey: 'sync.availability.pendingPermission' }
    : included()
}

export function getSyncAvailability(
  key: SyncCatalogKey,
  context: AvailabilityContext,
): SyncAvailability {
  if (key === 'settings')
    return context.scope.settings
      ? included()
      : excludedByUser('sync.availability.settingsScopeDisabled')
  if (key === 'quickLinks')
    return context.scope.quickLinks
      ? included()
      : excludedByUser('sync.availability.quickLinksScopeDisabled')
  if (key === 'customSearchEngines')
    return context.scope.customSearchEngines
      ? included()
      : excludedByUser('sync.availability.searchEnginesScopeDisabled')
  if (key === 'ui.language' || key === 'ui.colorMode')
    return context.scope.uiPreferences
      ? included()
      : excludedByUser('sync.availability.uiScopeDisabled')
  if (key === 'searchHistory') return excludedByDesign('sync.availability.searchHistoryLocal')
  if (key === 'blockedTopSites') {
    return context.scope.blockedTopSites
      ? included()
      : excludedByUser('sync.availability.blockedTopSitesScopeDisabled')
  }
  if (key === 'onlineWallpaperUrl') {
    return context.scope.onlineWallpaperUrl
      ? included()
      : excludedByUser('sync.availability.onlineWallpaperUrlScopeDisabled')
  }
  if (key === 'userIcons') {
    return context.scope.userIcons &&
      (context.scope.quickLinks || context.scope.customSearchEngines)
      ? included()
      : excludedByUser('sync.availability.userIconsScopeDisabled')
  }
  if (key === 'wallpaper.light' || key === 'wallpaper.dark') {
    return wallpaperAvailability(key === 'wallpaper.light' ? 'light' : 'dark', context)
  }
  if (key === 'faviconCache') {
    return excludedByDesign('sync.availability.faviconCacheLocal')
  }
  if (key === 'bookmarks') {
    return excludedByDesign('sync.availability.bookmarksBrowserManaged')
  }
  if (key === 'onlineWallpaperCache') {
    return excludedByDesign('sync.availability.onlineWallpaperCacheLocal')
  }
  return permissionAvailability(
    key === 'permission.monet' ? 'monet' : key === 'permission.favicon' ? 'favicon' : 'wallpaper',
    context,
  )
}

export function toSyncQuickLinks(
  data: CaptureContext['quickLinks'],
  includeUserSelectedIcons: boolean,
): SyncQuickLinksDataV1 {
  const groups = data.groups?.length ? data.groups : []
  const sourceItems = groups.length ? groups.flatMap((group) => group.items) : data.items
  const items = new Map<string, CapturableQuickLink & { id: string }>()

  for (const item of sourceItems) {
    if (!item.id) throw new Error('Quick Link is missing its stable ID')
    if (items.has(item.id)) throw new Error(`Duplicate Quick Link ID: ${item.id}`)
    items.set(item.id, { ...item, id: item.id })
  }

  return {
    items: [...items.values()].map((item) => ({
      id: item.id,
      url: item.url,
      title: item.title,
      ...(includeUserSelectedIcons && item.faviconSource === 'user-selected' && item.favicon
        ? { favicon: item.favicon }
        : {}),
    })),
    rootOrder: groups.length ? [] : data.items.map((item) => item.id!),
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      itemIds: group.items.map((item) => item.id!),
    })),
    groupOrder: groups.map((group) => group.id),
  }
}

export function toSyncCustomSearchEngines(
  data: CaptureContext['customSearchEngines'],
  includeUserIcons: boolean,
): SyncCustomSearchEngineDataV1 {
  return {
    items: data.items.map((item) => ({
      id: item.id,
      name: item.name,
      url: item.url,
      ...(includeUserIcons && item.icon ? { icon: item.icon } : {}),
    })),
    order: data.items.map((item) => item.id),
  }
}

export function toSyncBlockedTopSites(urls: readonly string[]): SyncBlockedTopSitesV1 {
  const normalized = new Set<string>()
  for (const value of urls) {
    try {
      const url = new URL(value)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
      url.hash = ''
      normalized.add(url.toString())
    } catch {}
  }
  return { urls: [...normalized].sort() }
}
