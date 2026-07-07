import type { CURRENT_CONFIG_SCHEMA } from './current'
import { defaultSettings } from './default'

const MIN_TRANSPARENCY = 0
const MAX_TRANSPARENCY = 95
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
type PerfTransparencyKey =
  | 'bookmark'
  | 'dialog'
  | 'searchBar'
  | 'quickLinks'
  | 'yiyan'
  | 'actionBtns'

type MutableCurrentSettings = CURRENT_CONFIG_SCHEMA & {
  clock?: CURRENT_CONFIG_SCHEMA['clock'] & {
    style?: CURRENT_CONFIG_SCHEMA['clock']['style'] & {
      transparency?: number
    }
  }
  search?: CURRENT_CONFIG_SCHEMA['search']
  quickLinks?: CURRENT_CONFIG_SCHEMA['quickLinks']
  yiyan?: CURRENT_CONFIG_SCHEMA['yiyan']
  layout?: CURRENT_CONFIG_SCHEMA['layout']
  perf?: CURRENT_CONFIG_SCHEMA['perf']
}

function normalizeTransparency(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(MAX_TRANSPARENCY, Math.max(MIN_TRANSPARENCY, Math.round(value)))
}

function normalizeBackdropBlur(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(MAX_BACKDROP_BLUR, Math.max(MIN_BACKDROP_BLUR, Math.round(value)))
}

function normalizeIconBorderRadius(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(MAX_ICON_BORDER_RADIUS, Math.max(MIN_ICON_BORDER_RADIUS, Math.round(value)))
}

function normalizeSearchBorderRadius(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(MAX_SEARCH_BORDER_RADIUS, Math.max(MIN_SEARCH_BORDER_RADIUS, Math.round(value)))
}

function normalizeYiyanBorderRadius(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(MAX_YIYAN_BORDER_RADIUS, Math.max(MIN_YIYAN_BORDER_RADIUS, Math.round(value)))
}

function normalizeActionBtnBorderRadius(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(
    MAX_ACTION_BTN_BORDER_RADIUS,
    Math.max(MIN_ACTION_BTN_BORDER_RADIUS, Math.round(value)),
  )
}

function normalizePerfSurface<K extends PerfTransparencyKey>(
  perf: CURRENT_CONFIG_SCHEMA['perf'],
  key: K,
): CURRENT_CONFIG_SCHEMA['perf'][K] {
  // 读取当前配置中对应性能分组的原始值，可能来自旧配置、导入文件或云同步数据。
  const current = perf[key]
  // 先克隆默认配置，确保新增字段或缺失字段都有稳定的默认值。
  const normalized = {
    // 使用默认性能分组作为基础结构，避免缺失嵌套字段时后续读取报错。
    ...structuredClone(defaultSettings.perf[key]),
    // 只有当前值是对象时才合并进来，避免异常数据覆盖默认结构。
    ...(typeof current === 'object' && current !== null ? current : {}),
  } as CURRENT_CONFIG_SCHEMA['perf'][K]
  // 单独规范化透明度，确保导入或同步过来的值始终落在合法范围内。
  normalized.transparency = normalizeTransparency(
    // 优先保留用户已有透明度设置。
    normalized.transparency,
    // 无效或缺失时回退到该性能分组的默认透明度。
    defaultSettings.perf[key].transparency,
  )
  normalized.blurIntensity = normalizeBackdropBlur(
    normalized.blurIntensity,
    defaultSettings.perf[key].blurIntensity,
  )
  // 将补齐并规范化后的分组写回原设置对象，保持调用方拿到的是完整配置。
  perf[key] = normalized
  // 返回当前分组，方便调用方在需要时继续使用规范化后的结果。
  return normalized
}

/**
 * 补齐同一配置版本内新增的可选设置，并约束外部导入或同步数据的取值范围。
 * 这里不提升配置版本，避免为纯新增字段引入一次完整迁移。
 */
export function normalizeCurrentSettings(settings: CURRENT_CONFIG_SCHEMA): CURRENT_CONFIG_SCHEMA {
  const normalized = settings as MutableCurrentSettings
  normalized.clock ??= structuredClone(defaultSettings.clock)
  normalized.clock.style ??= structuredClone(defaultSettings.clock.style)
  normalized.search ??= structuredClone(defaultSettings.search)
  normalized.quickLinks ??= structuredClone(defaultSettings.quickLinks)
  normalized.yiyan ??= structuredClone(defaultSettings.yiyan)
  normalized.layout ??= structuredClone(defaultSettings.layout)
  normalized.perf ??= structuredClone(defaultSettings.perf)

  normalized.clock.style.transparency = normalizeTransparency(
    normalized.clock.style.transparency,
    defaultSettings.clock.style.transparency,
  )
  normalized.search.borderRadius = normalizeSearchBorderRadius(
    normalized.search.borderRadius,
    defaultSettings.search.borderRadius,
  )

  normalized.quickLinks.grouping ??= defaultSettings.quickLinks.grouping
  normalized.quickLinks.useScroll ??= defaultSettings.quickLinks.useScroll
  normalized.quickLinks.pagingLoop ??= defaultSettings.quickLinks.pagingLoop
  normalized.quickLinks.iconBorderRadius = normalizeIconBorderRadius(
    normalized.quickLinks.iconBorderRadius,
    defaultSettings.quickLinks.iconBorderRadius,
  )
  normalized.yiyan.borderRadius = normalizeYiyanBorderRadius(
    normalized.yiyan.borderRadius,
    defaultSettings.yiyan.borderRadius,
  )
  normalized.layout.actionBtnBorderRadius = normalizeActionBtnBorderRadius(
    normalized.layout.actionBtnBorderRadius,
    defaultSettings.layout.actionBtnBorderRadius,
  )

  normalizePerfSurface(normalized.perf, 'bookmark')
  normalizePerfSurface(normalized.perf, 'dialog')
  normalizePerfSurface(normalized.perf, 'searchBar')
  normalizePerfSurface(normalized.perf, 'quickLinks')
  normalizePerfSurface(normalized.perf, 'yiyan')
  normalizePerfSurface(normalized.perf, 'actionBtns')

  return settings
}
