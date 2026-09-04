import { canonicalize, jsonEquals } from './canonical.ts'
import type { JsonObject, JsonValue } from './types.ts'

const EXCLUDED_SYNC_SETTING_PATHS = [
  // 本机缓存、运行状态和旧同步元数据。
  'background.bing.cachedResolution',
  'background.bing.id',
  'background.bing.updateDate',
  'background.bing.url',
  'bookmark.drawerWidth',
  'pluginVersion',
  'readChangeLog',
  'sync.enabled',
  'version',
  // 仅允许通过壁纸专用范围同步，不能作为普通设置透传。
  'background.local.id',
  'background.local.mediaType',
  'background.local.url',
  'background.localDark.id',
  'background.localDark.mediaType',
  'background.localDark.url',
  'background.online.url',
] as const

/**
 * 设置同步的唯一白名单。新增设置必须在这里明确归类，不能因为位于已知对象下就自动上传。
 */
export const SYNC_SETTING_PATHS = [
  'theme.primaryColor',
  'theme.colorfulMode',
  'theme.monetColor',
  'theme.idleHide',
  'theme.keepClockVisibleOnIdle',
  'clock.enabled',
  'clock.colorfulNum',
  'clock.newStyle',
  'clock.hour12',
  'clock.meridiem.show',
  'clock.meridiem.followSize',
  'clock.showDate',
  'clock.showLunar',
  'clock.showSeconds',
  'clock.size',
  'clock.dateSize',
  'clock.weight.time',
  'clock.weight.date',
  'clock.style.shadow',
  'clock.style.blink',
  'clock.style.transparency',
  'clock.style.invertColor.light',
  'clock.style.invertColor.night',
  'search.enabled',
  'search.expandAlways',
  'search.showIconAlways',
  'search.suggestionsEnabled',
  'search.suggestionAPI',
  'search.engine',
  'search.builtInEngineOrder',
  'search.hiddenBuiltInEngines',
  'search.openInNewTab',
  'search.recordHistory',
  'search.leftAlignInput',
  'search.style.shadow',
  'search.style.border',
  'search.placeholder',
  'search.expandWidth',
  'search.borderRadius',
  'background.bgType',
  'background.showDownloadBtn',
  'background.vignette',
  'background.parallax',
  'background.blur',
  'background.mask.enabled',
  'background.mask.light',
  'background.mask.night',
  'background.pauseOnBlur',
  'background.fastAnimation',
  'background.bing.resolution',
  'background.online.cache.enabled',
  'background.online.cache.duration',
  'background.online.cache.noExpires',
  'quickLinks.enabled',
  'quickLinks.topSites',
  'quickLinks.pinnedIcon',
  'quickLinks.openInNewTab',
  'quickLinks.paging',
  'quickLinks.grouping',
  'quickLinks.useScroll',
  'quickLinks.pagingLoop',
  'quickLinks.showOnSearchFocus',
  'quickLinks.iconSize',
  'quickLinks.iconRatio',
  'quickLinks.iconBorderRadius',
  'quickLinks.style.shadow',
  'quickLinks.style.border',
  'quickLinks.layout.rows',
  'quickLinks.layout.columns',
  'quickLinks.marginTop',
  'quickLinks.fallbackToTitleInitial',
  'quickLinks.spacing.itemGapX',
  'quickLinks.spacing.itemGapY',
  'quickLinks.spacing.iconTitleGap',
  'quickLinks.title.show',
  'quickLinks.title.extraWidth',
  'quickLinks.title.whiteInLightMode',
  'dock.enabled',
  'dock.topSites',
  'dock.showOnSearchFocus',
  'dock.openInNewTab',
  'dock.limitCount',
  'dock.maxCount',
  'dock.gap',
  'dock.iconSize',
  'dock.iconRatio',
  'dock.borderRadius',
  'dock.launchpad.enabled',
  'dock.launchpad.iconSize',
  'dock.launchpad.topSites',
  'dock.launchpad.openInNewTab',
  'dock.launchpad.rightClickToOpen',
  'yiyan.enabled',
  'yiyan.alwaysShow',
  'yiyan.provider',
  'yiyan.customLines',
  'yiyan.borderRadius',
  'yiyan.style.shadow',
  'yiyan.style.invertColor.light',
  'yiyan.style.invertColor.night',
  'perf.bgSwitchAnim',
  'perf.dockScale',
  'perf.bookmark.transparent',
  'perf.bookmark.transparency',
  'perf.bookmark.blur',
  'perf.bookmark.blurIntensity',
  'perf.dialog.transparent',
  'perf.dialog.transparency',
  'perf.dialog.blur',
  'perf.dialog.blurIntensity',
  'perf.dialog.animation',
  'perf.focus.scale',
  'perf.focus.blur',
  'perf.quickLinks.transparent',
  'perf.quickLinks.transparency',
  'perf.quickLinks.blur',
  'perf.quickLinks.blurIntensity',
  'perf.searchBar.transparent',
  'perf.searchBar.transparency',
  'perf.searchBar.blur',
  'perf.searchBar.blurIntensity',
  'perf.searchBar.launchAnim',
  'perf.yiyan.transparent',
  'perf.yiyan.transparency',
  'perf.yiyan.blur',
  'perf.yiyan.blurIntensity',
  'perf.yiyan.ripple',
  'perf.actionBtns.blur',
  'perf.actionBtns.transparent',
  'perf.actionBtns.transparency',
  'perf.actionBtns.blurIntensity',
  'layout.mainPosition.type',
  'layout.mainPosition.value',
  'layout.actionBtnPosition',
  'layout.actionBtnBorderRadius',
  'layout.globalBorderRadius',
  'layout.minimalModeOnDoubleClick',
  'bookmark.direction',
  'bookmark.rightClickToOpen',
  'bookmark.showBtn',
  'bookmark.defaultSortMode',
  'hideMajorChangelog',
  'faviconCacheEnabled',
] as const

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function getPath(source: unknown, path: string): JsonValue | undefined {
  let current: unknown = source
  for (const key of path.split('.')) {
    const record = asRecord(current)
    if (!record || !Object.hasOwn(record, key)) return undefined
    current = record[key]
  }
  if (current === undefined) return undefined
  return canonicalize(current)
}

function setPath(target: JsonObject, path: string, value: JsonValue): void {
  const parts = path.split('.')
  let current = target
  for (const key of parts.slice(0, -1)) {
    const existing = current[key]
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) current[key] = {}
    current = current[key] as JsonObject
  }
  current[parts.at(-1)!] = value
}

function deletePath(target: JsonObject, path: string): void {
  const parts = path.split('.')
  const parents: JsonObject[] = [target]
  let current = target
  for (const key of parts.slice(0, -1)) {
    const next = current[key]
    if (!next || typeof next !== 'object' || Array.isArray(next)) return
    current = next
    parents.push(current)
  }
  delete current[parts.at(-1)!]
  for (let index = parents.length - 1; index > 0; index -= 1) {
    const parent = parents[index - 1]!
    const key = parts[index - 1]!
    const value = parent[key]
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    ) {
      delete parent[key]
    }
  }
}

export function pickSyncSettings(settings: unknown): JsonObject {
  const result: JsonObject = {}
  for (const path of SYNC_SETTING_PATHS) {
    const value = getPath(settings, path)
    if (value !== undefined) setPath(result, path, value)
  }
  return result
}

export function syncSettingsChanged(previous: unknown, next: unknown): boolean {
  return !jsonEquals(pickSyncSettings(previous), pickSyncSettings(next))
}

export function stripExcludedSyncSettings(settings: JsonObject): JsonObject {
  const result = structuredClone(settings)
  for (const path of EXCLUDED_SYNC_SETTING_PATHS) deletePath(result, path)
  return result
}

export function applySyncSettings<T>(current: T, incoming: JsonObject): T {
  const result = structuredClone(current) as T
  for (const path of SYNC_SETTING_PATHS) {
    const value = getPath(incoming, path)
    if (value !== undefined) setPath(result as JsonObject, path, value)
  }
  return result
}

/** 保留同一格式版本中本客户端尚不认识的字段，但永不把它们应用到本机设置。 */
export function preserveUnknownSyncSettings(local: JsonObject, remote: JsonObject): JsonObject {
  const result = stripExcludedSyncSettings(remote)
  for (const path of SYNC_SETTING_PATHS) {
    deletePath(result, path)
    const value = getPath(local, path)
    if (value !== undefined) setPath(result, path, value)
  }
  return result
}

function unknownSyncSettings(settings: JsonObject): JsonObject {
  const result = stripExcludedSyncSettings(settings)
  for (const path of SYNC_SETTING_PATHS) deletePath(result, path)
  return result
}

function mergeObjects(base: JsonObject, incoming: JsonObject): JsonObject {
  const result = structuredClone(base)
  for (const [key, value] of Object.entries(incoming)) {
    const current = result[key]
    const next =
      current &&
      value &&
      typeof current === 'object' &&
      typeof value === 'object' &&
      !Array.isArray(current) &&
      !Array.isArray(value)
        ? mergeObjects(current, value)
        : structuredClone(value)
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: next,
      writable: true,
    })
  }
  return result
}

/** 远端缺少白名单字段时沿用基线；未知字段仅透传，不参与本机应用。 */
export function normalizeRemoteSyncSettings(baseline: JsonObject, remote: JsonObject): JsonObject {
  const known = applySyncSettings(baseline, remote)
  const unknown = mergeObjects(unknownSyncSettings(baseline), unknownSyncSettings(remote))
  return preserveUnknownSyncSettings(known, unknown)
}
