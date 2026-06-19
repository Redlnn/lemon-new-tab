import { SettingsRoute } from '../composables/useSettingsRouter'
import ThemeSettings from '../Settings/ThemeSettings.vue'

const settingsViewsMap: Record<
  SettingsRoute,
  (() => Promise<{ default: Component }>) | Component | null
> = {
  [SettingsRoute.MENU]: null,
  [SettingsRoute.THEME]: ThemeSettings,
  [SettingsRoute.LAYOUT]: defineAsyncComponent(() => import('../Settings/LayoutSettings.vue')),
  [SettingsRoute.CLOCK]: defineAsyncComponent(() => import('../Settings/ClockSettings.vue')),
  [SettingsRoute.SEARCH]: defineAsyncComponent(() => import('../Settings/SearchSettings.vue')),
  [SettingsRoute.BACKGROUND]: defineAsyncComponent(
    () => import('../Settings/BackgroundSettings.vue'),
  ),
  [SettingsRoute.QUICK_LINKS]: defineAsyncComponent(
    () => import('../Settings/QuickLinksSettings.vue'),
  ),
  [SettingsRoute.DOCK]: defineAsyncComponent(() => import('../Settings/DockSettings.vue')),
  [SettingsRoute.BOOKMARK_SIDEBAR]: defineAsyncComponent(
    () => import('../Settings/BookmarkSidebarSettings.vue'),
  ),
  [SettingsRoute.YIYAN]: defineAsyncComponent(() => import('../Settings/YiyanSettings.vue')),
  [SettingsRoute.PERFORMANCE]: defineAsyncComponent(
    () => import('../Settings/PerformanceSettings.vue'),
  ),
  [SettingsRoute.OTHER]: defineAsyncComponent(() => import('../Settings/OtherSettings.vue')),
} as const

export const getSettingsView = (route: SettingsRoute): Component | null => {
  return settingsViewsMap[route]
}
