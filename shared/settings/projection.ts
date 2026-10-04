import { BgType, ClockWeight, DrawerDirection, SortMode } from '../enums.ts'
import { BUILT_IN_SEARCH_ENGINE_KEYS, normalizeBuiltInSearchEngineOrder } from '../searchEngines.ts'
import { normalizeSuggestionProviders } from '../searchSuggestionProviders.ts'

import { BLUR_RANGE, EFFECT_SURFACES, TRANSPARENCY_RANGE } from './constraints.ts'
import { defaultSettings } from './default.ts'

type RecordValue = Record<string, unknown>

export function isSettingsObject(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// 安全的用户设置分组允许新增字段；新的顶层分组必须明确归类。
const SYNC_GROUPS = new Set([
  'theme',
  'clock',
  'search',
  'background',
  'quickLinks',
  'dock',
  'yiyan',
  'perf',
  'layout',
  'bookmark',
  'hideMajorChangelog',
  'faviconCacheEnabled',
])
const LOCAL_PATHS = new Set([
  'background.bing.id',
  'background.bing.url',
  'background.bing.updateDate',
  'background.bing.cachedResolution',
  'background.online.url',
  'background.rotation.enabled',
  'background.rotation.order',
  'bookmark.drawerWidth',
])
const ENUMS: Record<string, readonly unknown[]> = {
  'background.bgType': Object.values(BgType),
  'background.bing.resolution': ['1080p', 'uhd'],
  'background.bing.cachedResolution': [null, '1080p', 'uhd'],
  'background.rotation.order': ['random', 'ordered'],
  'clock.weight.time': Object.values(ClockWeight),
  'clock.weight.date': Object.values(ClockWeight),
  'bookmark.direction': Object.values(DrawerDirection),
  'bookmark.defaultSortMode': Object.values(SortMode),
  'search.suggestionAPI': ['bing', 'baidu', 'google'],
  'yiyan.provider': ['jinrishici', 'hitokoto', 'custom'],
  'layout.mainPosition.type': ['center', 'dvh', 'px', 'bottom-dvh', 'bottom-px'],
  'layout.actionBtnPosition': ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
}
const INTEGER_RANGES: Record<string, readonly [number, number]> = {
  'clock.dateSize': [10, 50],
  'clock.style.transparency': TRANSPARENCY_RANGE,
  'search.borderRadius': [0, 50],
  'search.browserHistoryLimit': [1, 5],
  'quickLinks.iconBorderRadius': [0, 50],
  'yiyan.borderRadius': [0, 40],
  'layout.actionBtnBorderRadius': [0, 50],
  'layout.globalBorderRadius': [0, 40],
  'dock.borderRadius': [0, 40],
  'dock.launchpad.iconSize': [40, 96],
  'bookmark.drawerWidth': [200, Number.MAX_SAFE_INTEGER],
}
for (const surface of EFFECT_SURFACES) {
  INTEGER_RANGES[`perf.${surface}.transparency`] = TRANSPARENCY_RANGE
  INTEGER_RANGES[`perf.${surface}.blurIntensity`] = BLUR_RANGE
}

export function isSyncedSetting(path: string): boolean {
  return SYNC_GROUPS.has(path.split('.')[0]!) && !LOCAL_PATHS.has(path)
}

export function settingLeaves(value: unknown, prefix = ''): Array<[string, unknown]> {
  if (!isSettingsObject(value)) return [[prefix, value]]
  return Object.entries(value).flatMap(([key, item]) =>
    settingLeaves(item, prefix ? `${prefix}.${key}` : key),
  )
}

export const SYNC_SETTING_PATHS = settingLeaves(defaultSettings)
  .map(([path]) => path)
  .filter(isSyncedSetting)

function validLeaf(value: unknown, fallback: unknown, path: string): boolean {
  if (ENUMS[path]) return ENUMS[path].includes(value)
  if (path === 'background.bing.updateDate')
    return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
  if (Array.isArray(fallback)) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string')
  }
  if (fallback === null) return value === null
  if (typeof value !== typeof fallback) return false
  return typeof value !== 'number' || Number.isFinite(value)
}

function normalizeLeaf(value: unknown, path: string): unknown {
  if (path === 'search.suggestionProviders') return normalizeSuggestionProviders(value as string[])
  const range = INTEGER_RANGES[path]
  if (range && typeof value === 'number')
    return Math.min(range[1], Math.max(range[0], Math.round(value)))
  if (path === 'background.solid.light' || path === 'background.solid.dark')
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : ''
  if (path === 'search.builtInEngineOrder' || path === 'search.hiddenBuiltInEngines') {
    const keys = (value as string[]).filter((key) =>
      (BUILT_IN_SEARCH_ENGINE_KEYS as readonly string[]).includes(key),
    ) as (typeof BUILT_IN_SEARCH_ENGINE_KEYS)[number][]
    return path === 'search.builtInEngineOrder'
      ? normalizeBuiltInSearchEngineOrder(keys)
      : [...new Set(keys)]
  }
  return structuredClone(value)
}

/** 只读取当前结构的字段。远端非法值拒绝；本机缺失/无效值可以补齐默认值。 */
export function projectSettings(
  input: unknown,
  { syncOnly = false, defaults = false, strict = true } = {},
): RecordValue {
  const visit = (template: RecordValue, source: RecordValue, prefix: string): RecordValue => {
    const result: RecordValue = {}
    for (const [key, fallback] of Object.entries(template)) {
      const path = prefix ? `${prefix}.${key}` : key
      const present = Object.hasOwn(source, key) && source[key] !== undefined
      if (isSettingsObject(fallback)) {
        if (present && !isSettingsObject(source[key]) && strict)
          throw new TypeError(`Invalid setting: ${path}`)
        const next = visit(fallback, isSettingsObject(source[key]) ? source[key] : {}, path)
        if (Object.keys(next).length) result[key] = next
      } else {
        if (syncOnly && !isSyncedSetting(path)) continue
        const valid = present && validLeaf(source[key], fallback, path)
        if (present && !valid && strict) throw new TypeError(`Invalid setting: ${path}`)
        if (valid) result[key] = normalizeLeaf(source[key], path)
        else if (defaults) result[key] = structuredClone(fallback)
      }
    }
    return result
  }
  if (!isSettingsObject(input)) throw new TypeError('Settings must be an object')
  const result = visit(defaultSettings, input, '')
  const bookmark = result.bookmark as RecordValue | undefined
  const launchpad = (result.dock as RecordValue | undefined)?.launchpad as RecordValue | undefined
  if (bookmark?.rightClickToOpen === true && launchpad) launchpad.rightClickToOpen = false
  return result
}
