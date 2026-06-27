import type { CURRENT_CONFIG_SCHEMA } from './current'
import { defaultSettings } from './default'

const MIN_TRANSPARENCY = 0
const MAX_TRANSPARENCY = 95

function normalizeTransparency(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(MAX_TRANSPARENCY, Math.max(MIN_TRANSPARENCY, Math.round(value)))
}

/**
 * 补齐同一配置版本内新增的可选设置，并约束外部导入或同步数据的取值范围。
 * 这里不提升配置版本，避免为纯新增字段引入一次完整迁移。
 */
export function normalizeCurrentSettings(settings: CURRENT_CONFIG_SCHEMA): CURRENT_CONFIG_SCHEMA {
  settings.quickLinks.grouping ??= defaultSettings.quickLinks.grouping
  settings.quickLinks.useScroll ??= defaultSettings.quickLinks.useScroll
  settings.quickLinks.pagingLoop ??= defaultSettings.quickLinks.pagingLoop

  settings.perf.bookmark.transparency = normalizeTransparency(
    settings.perf.bookmark.transparency,
    defaultSettings.perf.bookmark.transparency,
  )
  settings.perf.dialog.transparency = normalizeTransparency(
    settings.perf.dialog.transparency,
    defaultSettings.perf.dialog.transparency,
  )
  settings.perf.searchBar.transparency = normalizeTransparency(
    settings.perf.searchBar.transparency,
    defaultSettings.perf.searchBar.transparency,
  )
  settings.perf.quickLinks.transparency = normalizeTransparency(
    settings.perf.quickLinks.transparency,
    defaultSettings.perf.quickLinks.transparency,
  )
  settings.perf.yiyan.transparency = normalizeTransparency(
    settings.perf.yiyan.transparency,
    defaultSettings.perf.yiyan.transparency,
  )
  settings.perf.actionBtns.transparency = normalizeTransparency(
    settings.perf.actionBtns.transparency,
    defaultSettings.perf.actionBtns.transparency,
  )

  return settings
}
