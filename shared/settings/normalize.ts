import {
  type BuiltInSearchEngineKey,
  isBuiltInSearchEngineKey,
  normalizeBuiltInSearchEngineOrder,
} from '@/shared/searchEngines'

import type { CURRENT_CONFIG_SCHEMA } from './current'
import { defaultSettings } from './default'
import type { BingWallpaperResolution } from './types'

const MIN_TRANSPARENCY = 0
const MAX_TRANSPARENCY = 95
const MIN_CLOCK_DATE_SIZE = 10
const MAX_CLOCK_DATE_SIZE = 50
const MIN_BACKDROP_BLUR = 0
const MAX_BACKDROP_BLUR = 40
const MIN_ICON_BORDER_RADIUS = 0
const MAX_ICON_BORDER_RADIUS = 50
const MIN_SEARCH_BORDER_RADIUS = 0
const MAX_SEARCH_BORDER_RADIUS = 50
const MIN_YIYAN_BORDER_RADIUS = 0
const MAX_YIYAN_BORDER_RADIUS = 40
const MIN_ACTION_BTN_BORDER_RADIUS = 0
const MAX_ACTION_BTN_BORDER_RADIUS = 50
const MIN_GLOBAL_BORDER_RADIUS = 0
const MAX_GLOBAL_BORDER_RADIUS = 40
const MIN_DOCK_BORDER_RADIUS = 0
const MAX_DOCK_BORDER_RADIUS = 40
const MIN_LAUNCHPAD_ICON_SIZE = 40
const MAX_LAUNCHPAD_ICON_SIZE = 96
type PerfTransparencyKey =
  | 'bookmark'
  | 'dialog'
  | 'searchBar'
  | 'quickLinks'
  | 'yiyan'
  | 'actionBtns'

type SearchSettings = CURRENT_CONFIG_SCHEMA['search']

type MutableCurrentSettings = CURRENT_CONFIG_SCHEMA & {
  theme?: Omit<CURRENT_CONFIG_SCHEMA['theme'], 'keepClockVisibleOnIdle'> & {
    keepClockVisibleOnIdle?: unknown
  }
  background?: CURRENT_CONFIG_SCHEMA['background'] & {
    showDownloadBtn?: unknown
    bing?: Omit<CURRENT_CONFIG_SCHEMA['background']['bing'], 'resolution' | 'cachedResolution'> & {
      resolution?: unknown
      cachedResolution?: unknown
    }
  }
  clock?: Omit<CURRENT_CONFIG_SCHEMA['clock'], 'dateSize'> & {
    dateSize?: unknown
    style?: CURRENT_CONFIG_SCHEMA['clock']['style'] & {
      transparency?: number
    }
  }
  search?: SearchSettings & {
    builtInEngineOrder?: SearchSettings['builtInEngineOrder']
    hiddenBuiltInEngines?: SearchSettings['hiddenBuiltInEngines']
  }
  quickLinks?: CURRENT_CONFIG_SCHEMA['quickLinks']
  yiyan?: CURRENT_CONFIG_SCHEMA['yiyan']
  layout?: Omit<CURRENT_CONFIG_SCHEMA['layout'], 'minimalModeOnDoubleClick'> & {
    minimalModeOnDoubleClick?: unknown
  }
  dock?: Omit<CURRENT_CONFIG_SCHEMA['dock'], 'launchpad'> & {
    launchpad?: Omit<CURRENT_CONFIG_SCHEMA['dock']['launchpad'], 'iconSize'> & {
      iconSize?: unknown
    }
  }
  perf?: CURRENT_CONFIG_SCHEMA['perf']
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeBuiltInEngineKeys(value: unknown, appendMissing: boolean) {
  const keys: BuiltInSearchEngineKey[] = Array.isArray(value)
    ? value.filter(isBuiltInSearchEngineKey)
    : []
  return appendMissing ? normalizeBuiltInSearchEngineOrder(keys) : [...new Set(keys)]
}

function isBingWallpaperResolution(value: unknown): value is BingWallpaperResolution {
  return value === '1080p' || value === 'uhd'
}

function normalizePerfSurface<K extends PerfTransparencyKey>(
  perf: CURRENT_CONFIG_SCHEMA['perf'],
  key: K,
): CURRENT_CONFIG_SCHEMA['perf'][K] {
  const current = perf[key]
  // 先克隆默认配置，确保新增字段或缺失字段都有稳定的默认值。
  const normalized = {
    // 使用默认性能分组作为基础结构，避免缺失嵌套字段时后续读取报错。
    ...structuredClone(defaultSettings.perf[key]),
    // 只有当前值是对象时才合并进来，避免异常数据覆盖默认结构。
    ...(typeof current === 'object' && current !== null ? current : {}),
  } as CURRENT_CONFIG_SCHEMA['perf'][K]
  // 单独规范化透明度，确保导入或同步过来的值始终落在合法范围内。
  normalized.transparency = clampInteger(
    // 优先保留用户已有透明度设置。
    normalized.transparency,
    // 无效或缺失时回退到该性能分组的默认透明度。
    defaultSettings.perf[key].transparency,
    MIN_TRANSPARENCY,
    MAX_TRANSPARENCY,
  )
  normalized.blurIntensity = clampInteger(
    normalized.blurIntensity,
    defaultSettings.perf[key].blurIntensity,
    MIN_BACKDROP_BLUR,
    MAX_BACKDROP_BLUR,
  )
  // 将补齐并规范化后的分组写回原设置对象，保持调用方拿到的是完整配置。
  perf[key] = normalized
  // 返回当前分组，方便调用方在需要时继续使用规范化后的结果。
  return normalized
}

/**
 * 补齐同一配置版本内新增的可选设置，并约束外部导入数据的取值范围。
 * 这里不提升配置版本，避免为纯新增字段引入一次完整迁移。
 */
export function normalizeCurrentSettings(settings: CURRENT_CONFIG_SCHEMA): CURRENT_CONFIG_SCHEMA {
  const normalized = settings as MutableCurrentSettings
  normalized.theme ??= structuredClone(defaultSettings.theme)
  normalized.background ??= structuredClone(defaultSettings.background)
  normalized.background.bing ??= structuredClone(defaultSettings.background.bing)
  normalized.clock ??= structuredClone(defaultSettings.clock)
  normalized.clock.style ??= structuredClone(defaultSettings.clock.style)
  normalized.search ??= structuredClone(defaultSettings.search)
  normalized.quickLinks ??= structuredClone(defaultSettings.quickLinks)
  normalized.yiyan ??= structuredClone(defaultSettings.yiyan)
  normalized.layout ??= structuredClone(defaultSettings.layout)
  normalized.dock ??= structuredClone(defaultSettings.dock)
  normalized.dock.launchpad ??= structuredClone(defaultSettings.dock.launchpad)
  normalized.perf ??= structuredClone(defaultSettings.perf)

  normalized.theme.keepClockVisibleOnIdle = normalizeBoolean(
    normalized.theme.keepClockVisibleOnIdle,
    defaultSettings.theme.keepClockVisibleOnIdle,
  )
  normalized.background.showDownloadBtn = normalizeBoolean(
    normalized.background.showDownloadBtn,
    defaultSettings.background.showDownloadBtn,
  )
  normalized.layout.minimalModeOnDoubleClick = normalizeBoolean(
    normalized.layout.minimalModeOnDoubleClick,
    defaultSettings.layout.minimalModeOnDoubleClick,
  )
  normalized.dock.launchpad.rightClickToOpen = normalizeBoolean(
    normalized.dock.launchpad.rightClickToOpen,
    defaultSettings.dock.launchpad.rightClickToOpen,
  )
  normalized.bookmark.rightClickToOpen = normalizeBoolean(
    normalized.bookmark.rightClickToOpen,
    defaultSettings.bookmark.rightClickToOpen,
  )
  // 两个背景右键动作不能同时生效；旧设置中的书签行为优先保留。
  if (normalized.bookmark.rightClickToOpen) {
    normalized.dock.launchpad.rightClickToOpen = false
  }

  const { bing } = normalized.background
  if (!isBingWallpaperResolution(bing.resolution)) {
    bing.resolution = defaultSettings.background.bing.resolution
  }
  if (!bing.id) {
    bing.cachedResolution = null
  } else if (!isBingWallpaperResolution(bing.cachedResolution)) {
    bing.cachedResolution = '1080p'
  }

  normalized.clock.style.transparency = clampInteger(
    normalized.clock.style.transparency,
    defaultSettings.clock.style.transparency,
    MIN_TRANSPARENCY,
    MAX_TRANSPARENCY,
  )
  normalized.clock.dateSize = clampInteger(
    normalized.clock.dateSize,
    defaultSettings.clock.dateSize,
    MIN_CLOCK_DATE_SIZE,
    MAX_CLOCK_DATE_SIZE,
  )
  normalized.search.borderRadius = clampInteger(
    normalized.search.borderRadius,
    defaultSettings.search.borderRadius,
    MIN_SEARCH_BORDER_RADIUS,
    MAX_SEARCH_BORDER_RADIUS,
  )
  normalized.search.suggestionsEnabled = normalizeBoolean(
    normalized.search.suggestionsEnabled,
    defaultSettings.search.suggestionsEnabled,
  )
  normalized.search.leftAlignInput = normalizeBoolean(
    normalized.search.leftAlignInput,
    defaultSettings.search.leftAlignInput,
  )
  normalized.search.builtInEngineOrder = normalizeBuiltInEngineKeys(
    normalized.search.builtInEngineOrder,
    true,
  )
  normalized.search.hiddenBuiltInEngines = normalizeBuiltInEngineKeys(
    normalized.search.hiddenBuiltInEngines,
    false,
  )

  normalized.quickLinks.grouping ??= defaultSettings.quickLinks.grouping
  normalized.quickLinks.useScroll ??= defaultSettings.quickLinks.useScroll
  normalized.quickLinks.pagingLoop ??= defaultSettings.quickLinks.pagingLoop
  normalized.quickLinks.iconBorderRadius = clampInteger(
    normalized.quickLinks.iconBorderRadius,
    defaultSettings.quickLinks.iconBorderRadius,
    MIN_ICON_BORDER_RADIUS,
    MAX_ICON_BORDER_RADIUS,
  )
  normalized.yiyan.borderRadius = clampInteger(
    normalized.yiyan.borderRadius,
    defaultSettings.yiyan.borderRadius,
    MIN_YIYAN_BORDER_RADIUS,
    MAX_YIYAN_BORDER_RADIUS,
  )
  normalized.layout.actionBtnBorderRadius = clampInteger(
    normalized.layout.actionBtnBorderRadius,
    defaultSettings.layout.actionBtnBorderRadius,
    MIN_ACTION_BTN_BORDER_RADIUS,
    MAX_ACTION_BTN_BORDER_RADIUS,
  )
  normalized.layout.globalBorderRadius = clampInteger(
    normalized.layout.globalBorderRadius,
    defaultSettings.layout.globalBorderRadius,
    MIN_GLOBAL_BORDER_RADIUS,
    MAX_GLOBAL_BORDER_RADIUS,
  )
  normalized.dock.borderRadius = clampInteger(
    normalized.dock.borderRadius,
    defaultSettings.dock.borderRadius,
    MIN_DOCK_BORDER_RADIUS,
    MAX_DOCK_BORDER_RADIUS,
  )
  normalized.dock.launchpad.iconSize = clampInteger(
    normalized.dock.launchpad.iconSize,
    defaultSettings.dock.launchpad.iconSize,
    MIN_LAUNCHPAD_ICON_SIZE,
    MAX_LAUNCHPAD_ICON_SIZE,
  )

  normalizePerfSurface(normalized.perf, 'bookmark')
  normalizePerfSurface(normalized.perf, 'dialog')
  normalizePerfSurface(normalized.perf, 'searchBar')
  normalizePerfSurface(normalized.perf, 'quickLinks')
  normalizePerfSurface(normalized.perf, 'yiyan')
  normalizePerfSurface(normalized.perf, 'actionBtns')

  return settings
}
