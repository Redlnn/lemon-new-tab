import type { JsonObject, JsonValue, SyncConflict, SyncSnapshotV1 } from './types.ts'

export type ConflictTranslator = (key: string, options?: Record<string, unknown>) => string

export interface SyncConflictDisplayContext {
  customSearchEngines: Record<string, { name: string; url: string }>
  quickLinkGroups: Record<string, string>
  quickLinks: Record<string, { title: string; url: string }>
}

export interface SyncConflictPresentation {
  base: string
  local: string
  remote: string
  section: string
  title: string
}

const SETTING_TITLE_KEYS: Record<string, string> = {
  'theme.primaryColor': 'theme.primaryColor',
  'theme.colorfulMode': 'theme.colorful.label',
  'theme.monetColor': 'theme.monet.label',
  'theme.idleHide': 'theme.idleHide',
  'theme.keepClockVisibleOnIdle': 'theme.keepClockVisibleOnIdle',
  'clock.enabled': 'newtab:common.enable',
  'clock.colorfulNum': 'clock.colorful',
  'clock.newStyle': 'clock.newStyle',
  'clock.hour12': 'clock.hour12',
  'clock.meridiem.show': 'clock.meridiem.show',
  'clock.meridiem.followSize': 'clock.meridiem.followSize',
  'clock.showDate': 'clock.showDate',
  'clock.showLunar': 'clock.showLunar',
  'clock.showSeconds': 'clock.showSeconds',
  'clock.size': 'clock.size.title',
  'clock.dateSize': 'clock.dateSize',
  'clock.weight.time': 'clock.weight.title',
  'clock.weight.date': 'clock.weight.dateTitle',
  'clock.style.shadow': 'clock.shadow',
  'clock.style.blink': 'clock.blink',
  'clock.style.transparency': 'clock.transparency',
  'clock.style.invertColor.light': 'clock.invertColor.light',
  'clock.style.invertColor.night': 'clock.invertColor.dark',
  'search.enabled': 'newtab:common.enable',
  'search.expandAlways': 'search.alwaysExpandSearchBar',
  'search.showIconAlways': 'search.alwaysShowIcon',
  'search.suggestionsEnabled': 'search.searchSuggestions',
  'search.suggestionAPI': 'search.searchSuggestionProvider',
  'search.engine': 'search.defaultSearchEngine',
  'search.builtInEngineOrder': 'webdavSync.conflicts.fields.searchEngineOrder',
  'search.hiddenBuiltInEngines': 'search.restoreHiddenEngines',
  'search.openInNewTab': 'common.openInNewTab',
  'search.recordHistory': 'search.recordSearchHistory',
  'search.leftAlignInput': 'search.leftAlignInput',
  'search.style.shadow': 'search.shadow',
  'search.style.border': 'search.border',
  'search.placeholder': 'search.placeholder',
  'search.expandWidth': 'search.expandWidth',
  'search.borderRadius': 'search.borderRadius',
  'background.bgType': 'background.change',
  'background.showDownloadBtn': 'background.showDownloadBtn',
  'background.vignette': 'background.vignette',
  'background.parallax': 'background.parallax',
  'background.blur': 'background.blur',
  'background.mask.enabled': 'background.mask.enable',
  'background.mask.light': 'background.mask.color',
  'background.mask.night': 'background.mask.color',
  'background.pauseOnBlur': 'background.pauseWhenBlur',
  'background.fastAnimation': 'background.fasterBgAnim',
  'background.bing.resolution': 'background.resolution',
  'background.online.cache.enabled': 'background.cache.label',
  'background.online.cache.duration': 'background.cache.duration',
  'background.online.cache.noExpires': 'background.cache.noExpires',
  'quickLinks.enabled': 'newtab:common.enable',
  'quickLinks.topSites': 'quickLinks.topSites',
  'quickLinks.pinnedIcon': 'quickLinks.pinnedIcon',
  'quickLinks.openInNewTab': 'common.openInNewTab',
  'quickLinks.paging': 'quickLinks.paging',
  'quickLinks.grouping': 'quickLinks.grouping',
  'quickLinks.useScroll': 'quickLinks.useScroll',
  'quickLinks.pagingLoop': 'quickLinks.pagingLoop',
  'quickLinks.showOnSearchFocus': 'quickLinks.showOnSearchFocus',
  'quickLinks.iconSize': 'quickLinks.iconSize',
  'quickLinks.iconRatio': 'quickLinks.iconRatio',
  'quickLinks.iconBorderRadius': 'quickLinks.iconBorderRadius',
  'quickLinks.style.shadow': 'quickLinks.shadow',
  'quickLinks.style.border': 'quickLinks.border',
  'quickLinks.layout.rows': 'quickLinks.maxRows',
  'quickLinks.layout.columns': 'quickLinks.maxColumns',
  'quickLinks.marginTop': 'quickLinks.marginTop',
  'quickLinks.spacing.itemGapX': 'quickLinks.spacing.itemGapX',
  'quickLinks.spacing.itemGapY': 'quickLinks.spacing.itemGapY',
  'quickLinks.spacing.iconTitleGap': 'quickLinks.spacing.iconTitleGap',
  'quickLinks.title.show': 'quickLinks.showTitle',
  'quickLinks.title.extraWidth': 'quickLinks.titleExtraWidth',
  'quickLinks.title.whiteInLightMode': 'quickLinks.titleWhiteInLight',
  'dock.enabled': 'newtab:common.enable',
  'dock.topSites': 'quickLinks.topSites',
  'dock.showOnSearchFocus': 'quickLinks.showOnSearchFocus',
  'dock.openInNewTab': 'common.openInNewTab',
  'dock.limitCount': 'dock.limitCount',
  'dock.maxCount': 'dock.maxCount',
  'dock.gap': 'quickLinks.spacing.itemGapX',
  'dock.iconSize': 'quickLinks.iconSize',
  'dock.iconRatio': 'quickLinks.iconRatio',
  'dock.borderRadius': 'dock.borderRadius',
  'dock.launchpad.enabled': 'dock.launchpad.show',
  'dock.launchpad.topSites': 'quickLinks.topSites',
  'dock.launchpad.openInNewTab': 'common.openInNewTab',
  'yiyan.enabled': 'newtab:common.enable',
  'yiyan.alwaysShow': 'yiyan.alwaysShow',
  'yiyan.provider': 'yiyan.provider',
  'yiyan.customLines': 'yiyan.customLinesLabel',
  'yiyan.borderRadius': 'yiyan.borderRadius',
  'yiyan.style.shadow': 'yiyan.shadow',
  'yiyan.style.invertColor.light': 'yiyan.invertColor.light',
  'yiyan.style.invertColor.night': 'yiyan.invertColor.dark',
  'perf.bgSwitchAnim': 'perf.bgSwitchAnim',
  'perf.dockScale': 'perf.dock.scale',
  'perf.bookmark.transparent': 'perf.bookmark.transparent',
  'perf.bookmark.transparency': 'perf.transparency',
  'perf.bookmark.blur': 'perf.bookmark.blur',
  'perf.bookmark.blurIntensity': 'perf.blurIntensity',
  'perf.dialog.transparent': 'perf.dialog.transparent',
  'perf.dialog.transparency': 'perf.transparency',
  'perf.dialog.blur': 'perf.dialog.blur',
  'perf.dialog.blurIntensity': 'perf.blurIntensity',
  'perf.dialog.animation': 'perf.dialog.animation',
  'perf.focus.scale': 'perf.focus.scale',
  'perf.focus.blur': 'perf.focus.blur',
  'perf.quickLinks.transparent': 'perf.quickLinks.transparent',
  'perf.quickLinks.transparency': 'perf.transparency',
  'perf.quickLinks.blur': 'perf.quickLinks.blur',
  'perf.quickLinks.blurIntensity': 'perf.blurIntensity',
  'perf.searchBar.transparent': 'perf.searchBar.transparent',
  'perf.searchBar.transparency': 'perf.transparency',
  'perf.searchBar.blur': 'perf.searchBar.blur',
  'perf.searchBar.blurIntensity': 'perf.blurIntensity',
  'perf.searchBar.launchAnim': 'search.launchAnim',
  'perf.yiyan.transparent': 'perf.yiyan.transparent',
  'perf.yiyan.transparency': 'perf.transparency',
  'perf.yiyan.blur': 'perf.yiyan.blur',
  'perf.yiyan.blurIntensity': 'perf.blurIntensity',
  'perf.yiyan.ripple': 'perf.yiyan.ripple',
  'perf.actionBtns.blur': 'perf.actionBtns.blur',
  'perf.actionBtns.transparent': 'perf.actionBtns.transparent',
  'perf.actionBtns.transparency': 'perf.transparency',
  'perf.actionBtns.blurIntensity': 'perf.blurIntensity',
  'layout.mainPosition.type': 'layout.mainPosition.label',
  'layout.mainPosition.value': 'layout.mainPosition.label',
  'layout.actionBtnPosition': 'layout.actionBtn.label',
  'layout.actionBtnBorderRadius': 'layout.actionBtn.borderRadius',
  'layout.globalBorderRadius': 'layout.globalBorderRadius',
  'layout.minimalModeOnDoubleClick': 'layout.minimalModeOnDoubleClick',
  'bookmark.direction': 'bookmark.direction.title',
  'bookmark.rightClickToOpen': 'bookmark.rightClickToOpen',
  'bookmark.showBtn': 'bookmark.showBtn',
  'bookmark.defaultSortMode': 'bookmark.defaultSort',
  hideMajorChangelog: 'newtab:changelog.hideMajor',
  faviconCacheEnabled: 'other.faviconCache.label',
}

const SETTING_SECTION_KEYS: Record<string, string> = {
  background: 'background.title',
  bookmark: 'bookmark.title',
  clock: 'clock.title',
  dock: 'dock.title',
  faviconCacheEnabled: 'other.title',
  hideMajorChangelog: 'other.title',
  layout: 'layout.title',
  perf: 'perf.title',
  quickLinks: 'quickLinks.title',
  search: 'search.title',
  theme: 'theme.title',
  yiyan: 'yiyan.title',
}

const EMPTY_CONTEXT: SyncConflictDisplayContext = {
  customSearchEngines: {},
  quickLinkGroups: {},
  quickLinks: {},
}

export function createSyncConflictDisplayContext(
  snapshots: readonly SyncSnapshotV1[],
): SyncConflictDisplayContext {
  const context: SyncConflictDisplayContext = structuredClone(EMPTY_CONTEXT)
  for (const snapshot of snapshots) {
    for (const item of snapshot.quickLinks?.items ?? []) {
      context.quickLinks[item.id] = { title: item.title, url: item.url }
    }
    for (const group of snapshot.quickLinks?.groups ?? []) {
      context.quickLinkGroups[group.id] = group.name
    }
    for (const engine of snapshot.customSearchEngines?.items ?? []) {
      context.customSearchEngines[engine.id] = { name: engine.name, url: engine.url }
    }
  }
  return context
}

export function presentSyncConflict(
  conflict: SyncConflict,
  context: SyncConflictDisplayContext = EMPTY_CONTEXT,
  t: ConflictTranslator,
): SyncConflictPresentation {
  return {
    section: displaySection(conflict, t),
    title: displayTitle(conflict, context, t),
    base: displayValue(conflict.base, conflict, context, t, 'base'),
    local: displayValue(conflict.local, conflict, context, t, 'local'),
    remote: displayValue(conflict.remote, conflict, context, t, 'remote'),
  }
}

function displaySection(conflict: Pick<SyncConflict, 'category' | 'path'>, t: ConflictTranslator) {
  if (conflict.path.startsWith('settings.')) {
    const parent = conflict.path.slice('settings.'.length).split('.', 1)[0]!
    return t(SETTING_SECTION_KEYS[parent] ?? 'webdavSync.conflicts.categories.settings')
  }
  return displaySyncCategory(conflict.category, t)
}

export function displaySyncDifference(
  input: Pick<SyncConflict, 'category' | 'path'> & { value?: JsonValue },
  context: SyncConflictDisplayContext = EMPTY_CONTEXT,
  t: ConflictTranslator,
): { title: string; value: string } {
  const conflict = { ...input, id: '', kind: 'field', canKeepBoth: false } as SyncConflict
  return {
    title: displayTitle(conflict, context, t),
    value: displayValue(input.value, conflict, context, t),
  }
}

function displayTitle(
  conflict: Pick<SyncConflict, 'category' | 'path' | 'base' | 'local' | 'remote'>,
  context: SyncConflictDisplayContext,
  t: ConflictTranslator,
): string {
  const { path } = conflict
  if (path.startsWith('settings.'))
    return t(
      SETTING_TITLE_KEYS[path.slice('settings.'.length)] ??
        'webdavSync.conflicts.categories.settings',
    )
  if (path === 'optional.onlineWallpaperUrl') return t('webdavSync.scope.onlineWallpaperUrl')
  if (path.startsWith('scope.')) return displayScopeLabel(path.slice('scope.'.length), t)
  if (path === 'scope') return t('webdavSync.scope.title')
  if (path === 'ui.language') return t('other.language')
  if (path === 'ui.colorMode') return t('webdavSync.conflicts.fields.colorMode')
  if (path === 'ui') return t('webdavSync.conflicts.categories.ui')
  if (path.startsWith('quickLinks.items.')) return quickLinkTitle(conflict, context, t)
  if (path.startsWith('quickLinks.groups.')) return quickLinkGroupTitle(conflict, context, t)
  if (path.startsWith('quickLinks.location.')) return t('webdavSync.conflicts.fields.linkGroup')
  if (path === 'quickLinks.rootOrder') return t('webdavSync.conflicts.fields.linkOrder')
  if (path === 'quickLinks.groupOrder') return t('webdavSync.conflicts.fields.groupOrder')
  if (path === 'quickLinks') return t('quickLinks.title')
  if (path.startsWith('customSearchEngines.items.')) return searchEngineTitle(conflict, context, t)
  if (path === 'customSearchEngines.order')
    return t('webdavSync.conflicts.fields.searchEngineOrder')
  if (path === 'customSearchEngines') return t('webdavSync.conflicts.categories.search-engines')
  if (path === 'optional.blockedTopSites')
    return t('webdavSync.conflicts.categories.blocked-top-sites')
  if (path === 'optional.wallpapers.light') return t('webdavSync.conflicts.fields.wallpaperLight')
  if (path === 'optional.wallpapers.dark') return t('webdavSync.conflicts.fields.wallpaperDark')
  if (path.startsWith('optional.wallpapers')) return t('webdavSync.conflicts.fields.wallpaper')
  return displaySyncCategory(conflict.category, t)
}

export function displaySyncCategory(
  category: SyncConflict['category'],
  t: ConflictTranslator,
): string {
  if (category === 'quick-links') return t('quickLinks.title')
  if (category === 'scope') return t('webdavSync.scope.title')
  if (category === 'wallpaper') return t('webdavSync.conflicts.fields.wallpaper')
  return t(`webdavSync.conflicts.categories.${category}`)
}

function displayScopeLabel(key: string, t: ConflictTranslator): string {
  return key === 'quickLinks' ? t('quickLinks.title') : t(`webdavSync.scope.${key}`)
}

function quickLinkTitle(
  conflict: Pick<SyncConflict, 'path' | 'base' | 'local' | 'remote'>,
  context: SyncConflictDisplayContext,
  t: ConflictTranslator,
): string {
  const [id, field] = conflict.path.slice('quickLinks.items.'.length).split('.', 2)
  const item = id ? context.quickLinks[id] : undefined
  const label = item?.title || stringField(conflict, 'title')
  if (!field) return withName(t('webdavSync.conflicts.fields.quickLink'), label)
  const fieldLabel =
    field === 'url'
      ? t('webdavSync.conflicts.fields.linkUrl')
      : field.startsWith('favicon')
        ? t('webdavSync.conflicts.fields.linkIcon')
        : t('webdavSync.conflicts.fields.linkTitle')
  return withName(fieldLabel, label)
}

function quickLinkGroupTitle(
  conflict: Pick<SyncConflict, 'path' | 'base' | 'local' | 'remote'>,
  context: SyncConflictDisplayContext,
  t: ConflictTranslator,
): string {
  const [id, field] = conflict.path.slice('quickLinks.groups.'.length).split('.', 2)
  const name = (id ? context.quickLinkGroups[id] : undefined) || stringField(conflict, 'name')
  if (field === 'itemIds') return withName(t('webdavSync.conflicts.fields.linkOrder'), name)
  if (field === 'name') return withName(t('webdavSync.conflicts.fields.groupName'), name)
  return withName(t('webdavSync.conflicts.fields.quickLinkGroup'), name)
}

function searchEngineTitle(
  conflict: Pick<SyncConflict, 'path' | 'base' | 'local' | 'remote'>,
  context: SyncConflictDisplayContext,
  t: ConflictTranslator,
): string {
  const [id, field] = conflict.path.slice('customSearchEngines.items.'.length).split('.', 2)
  const engine = id ? context.customSearchEngines[id] : undefined
  const name = engine?.name || stringField(conflict, 'name')
  if (!field) return withName(t('webdavSync.conflicts.fields.customSearchEngine'), name)
  const fieldLabel =
    field === 'url'
      ? t('webdavSync.conflicts.fields.searchEngineUrl')
      : field.startsWith('icon')
        ? t('webdavSync.conflicts.fields.searchEngineIcon')
        : t('webdavSync.conflicts.fields.searchEngineName')
  return withName(fieldLabel, name)
}

function displayValue(
  value: JsonValue | undefined,
  conflict: Pick<SyncConflict, 'category' | 'path'>,
  context: SyncConflictDisplayContext,
  t: ConflictTranslator,
  side?: 'base' | 'local' | 'remote',
): string {
  if (value === undefined)
    return t(
      side === 'base' ? 'webdavSync.conflicts.values.noBaseline' : 'webdavSync.conflicts.deleted',
    )
  if (isOrderPath(conflict.path)) return t('webdavSync.conflicts.values.orderChanged')
  if (isIconPath(conflict.path)) {
    return t(
      value ? 'webdavSync.conflicts.values.customIcon' : 'webdavSync.conflicts.values.noCustomIcon',
    )
  }
  if (conflict.path === 'optional.onlineWallpaperUrl' || conflict.path.endsWith('.url')) {
    return typeof value === 'string' ? displayUrl(value) : t('webdavSync.conflicts.values.changed')
  }
  if (conflict.path.startsWith('quickLinks.location.'))
    return displayQuickLinkLocation(value, context, t)
  if (conflict.path === 'quickLinks') return displayQuickLinks(value, t)
  if (conflict.path.startsWith('quickLinks.items.')) return displayQuickLink(value, t)
  if (conflict.path.startsWith('quickLinks.groups.')) return displayQuickLinkGroup(value, t)
  if (conflict.path === 'customSearchEngines') return displaySearchEngines(value, t)
  if (conflict.path.startsWith('customSearchEngines.items.')) return displaySearchEngine(value, t)
  if (conflict.path === 'optional.blockedTopSites') return displayBlockedSites(value, t)
  if (conflict.path.startsWith('optional.wallpapers')) return displayWallpapers(value, t)
  if (conflict.path === 'ui') return displayUi(value, t)
  if (conflict.path === 'scope') return displayScope(value, t)
  if (conflict.path === 'settings')
    return t('webdavSync.conflicts.values.settingCount', { count: leafCount(value) })
  if (conflict.path === 'ui.language') return displayLanguage(value)
  if (conflict.path === 'ui.colorMode') return displayColorMode(value, t)
  if (conflict.path === 'settings.background.bgType') return displayBackgroundType(value, t)
  if (typeof value === 'boolean')
    return t(value ? 'webdavSync.conflicts.values.enabled' : 'webdavSync.conflicts.values.disabled')
  if (typeof value === 'string' || typeof value === 'number') return shorten(String(value))
  if (Array.isArray(value))
    return t('webdavSync.conflicts.values.itemCount', { count: value.length })
  return t('webdavSync.conflicts.values.changed')
}

function displayQuickLinks(value: JsonValue, t: ConflictTranslator): string {
  if (!isObject(value)) return t('webdavSync.conflicts.values.changed')
  const items = Array.isArray(value.items) ? value.items.length : 0
  const groups = Array.isArray(value.groups) ? value.groups.length : 0
  return t('webdavSync.conflicts.values.quickLinksSummary', { groups, items })
}

function displayQuickLink(value: JsonValue, t: ConflictTranslator): string {
  if (!isObject(value)) return displayPrimitive(value, t)
  const title =
    typeof value.title === 'string' ? value.title : t('webdavSync.conflicts.values.untitled')
  const url = typeof value.url === 'string' ? ` · ${displayUrl(value.url)}` : ''
  return `${shorten(title)}${url}`
}

function displayQuickLinkGroup(value: JsonValue, t: ConflictTranslator): string {
  if (!isObject(value)) return displayPrimitive(value, t)
  const name =
    typeof value.name === 'string' ? shorten(value.name) : t('webdavSync.conflicts.values.untitled')
  const count = Array.isArray(value.itemIds) ? value.itemIds.length : 0
  return t('webdavSync.conflicts.values.groupSummary', { count, name })
}

function displaySearchEngines(value: JsonValue, t: ConflictTranslator): string {
  if (!isObject(value)) return t('webdavSync.conflicts.values.changed')
  const count = Array.isArray(value.items) ? value.items.length : 0
  return t('webdavSync.conflicts.values.searchEnginesSummary', { count })
}

function displaySearchEngine(value: JsonValue, t: ConflictTranslator): string {
  if (!isObject(value)) return displayPrimitive(value, t)
  const name =
    typeof value.name === 'string' ? value.name : t('webdavSync.conflicts.values.untitled')
  const url = typeof value.url === 'string' ? ` · ${displayUrl(value.url)}` : ''
  return `${shorten(name)}${url}`
}

function displayQuickLinkLocation(
  value: JsonValue,
  context: SyncConflictDisplayContext,
  t: ConflictTranslator,
): string {
  if (value === 'root') return t('webdavSync.conflicts.values.rootGroup')
  if (typeof value === 'string') {
    return t('webdavSync.conflicts.values.group', {
      name: shorten(
        context.quickLinkGroups[value] ?? t('webdavSync.conflicts.values.unknownGroup'),
      ),
    })
  }
  return t('webdavSync.conflicts.values.changed')
}

function displayBlockedSites(value: JsonValue, t: ConflictTranslator): string {
  const urls = isObject(value) && Array.isArray(value.urls) ? value.urls : []
  return t('webdavSync.conflicts.values.itemCount', { count: urls.length })
}

function displayWallpapers(value: JsonValue, t: ConflictTranslator): string {
  if (!isObject(value)) return t('webdavSync.conflicts.values.changed')
  const count = Number(Boolean(value.light)) + Number(Boolean(value.dark))
  return t('webdavSync.conflicts.values.wallpaperCount', { count })
}

function displayUi(value: JsonValue, t: ConflictTranslator): string {
  if (!isObject(value)) return t('webdavSync.conflicts.values.changed')
  const values = [
    value.language === undefined ? undefined : displayLanguage(value.language),
    value.colorMode === undefined ? undefined : displayColorMode(value.colorMode, t),
  ].filter((item): item is string => Boolean(item))
  return values.join(' · ') || t('webdavSync.conflicts.values.changed')
}

function displayScope(value: JsonValue, t: ConflictTranslator): string {
  if (!isObject(value)) return t('webdavSync.conflicts.values.changed')
  const enabled = Object.values(value).filter((item) => item === true).length
  return t('webdavSync.conflicts.values.enabledScopeCount', { count: enabled })
}

function displayPrimitive(value: JsonValue, t: ConflictTranslator): string {
  if (typeof value === 'boolean')
    return t(value ? 'webdavSync.conflicts.values.enabled' : 'webdavSync.conflicts.values.disabled')
  if (typeof value === 'string' || typeof value === 'number') return shorten(String(value))
  return t('webdavSync.conflicts.values.changed')
}

function displayColorMode(value: JsonValue, t: ConflictTranslator): string {
  const keys: Record<string, string> = {
    auto: 'theme.mode.system',
    dark: 'theme.mode.alwaysOn',
    light: 'theme.mode.alwaysOff',
  }
  return typeof value === 'string' && keys[value] ? t(keys[value]) : displayPrimitive(value, t)
}

function displayBackgroundType(value: JsonValue, t: ConflictTranslator): string {
  const keys: Record<string, string> = {
    bing: 'background.bingFrom',
    local: 'background.type.local',
    online: 'background.type.online',
  }
  return typeof value === 'string' && keys[value] ? t(keys[value]) : displayPrimitive(value, t)
}

function displayLanguage(value: JsonValue): string {
  if (typeof value !== 'string') return String(value)
  return new Intl.DisplayNames([navigator.language], { type: 'language' }).of(value) ?? value
}

function stringField(
  conflict: Pick<SyncConflict, 'base' | 'local' | 'remote'>,
  field: string,
): string | undefined {
  for (const value of [conflict.local, conflict.remote, conflict.base]) {
    if (isObject(value) && typeof value[field] === 'string') return value[field]
  }
  return undefined
}

function isOrderPath(path: string): boolean {
  return (
    path.endsWith('.itemIds') ||
    path.endsWith('.order') ||
    path === 'quickLinks.rootOrder' ||
    path === 'quickLinks.groupOrder' ||
    path.endsWith('.builtInEngineOrder') ||
    path.endsWith('.hiddenBuiltInEngines')
  )
}

function isIconPath(path: string): boolean {
  return path.includes('.favicon') || path.includes('.iconHash') || path.endsWith('.icon')
}

function leafCount(value: JsonValue): number {
  if (Array.isArray(value)) return value.length
  if (!isObject(value)) return 1
  return Object.values(value).reduce<number>((count, item) => count + leafCount(item), 0)
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function withName(label: string, name: string | undefined): string {
  return name ? `${label} · ${shorten(name)}` : label
}

function displayUrl(value: string): string {
  try {
    const url = new URL(value)
    return shorten(`${url.host}${url.pathname}`)
  } catch {
    return shorten(value)
  }
}

function shorten(value: string): string {
  return value.length > 120 ? `${value.slice(0, 117)}…` : value
}
