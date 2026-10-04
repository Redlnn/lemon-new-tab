import type { CURRENT_CONFIG_SCHEMA } from './current'
import { projectSettings } from './projection.ts'

/** 本机和同步复用当前结构、默认值及取值规则；只在此处修正本机缓存状态。 */
export function normalizeCurrentSettings(settings: CURRENT_CONFIG_SCHEMA): CURRENT_CONFIG_SCHEMA {
  const current = projectSettings(settings, {
    defaults: true,
    strict: false,
  }) as unknown as CURRENT_CONFIG_SCHEMA
  if (!current.dock.enabled) current.dock.replaceQuickLinks = false
  if (current.dock.replaceQuickLinks) current.quickLinks.enabled = false
  const { bing } = current.background
  if (!bing.id) bing.cachedResolution = null
  else if (!bing.cachedResolution) bing.cachedResolution = '1080p'
  return current
}
