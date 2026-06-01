import { SettingsRoute } from '../composables/useSettingsRouter'

// 维护所有设置子页面的异步加载器，便于集中预取与复用
const settingsViewLoaders: Record<SettingsRoute, (() => Promise<{ default: Component }>) | null> = {
  [SettingsRoute.MENU]: null,
  [SettingsRoute.THEME]: () => import('../Settings/ThemeSettings.vue'),
  [SettingsRoute.LAYOUT]: () => import('../Settings/LayoutSettings.vue'),
  [SettingsRoute.CLOCK]: () => import('../Settings/ClockSettings.vue'),
  [SettingsRoute.SEARCH]: () => import('../Settings/SearchSettings.vue'),
  [SettingsRoute.BACKGROUND]: () => import('../Settings/BackgroundSettings.vue'),
  [SettingsRoute.QUICK_LINKS]: () => import('../Settings/QuickLinksSettings.vue'),
  [SettingsRoute.DOCK]: () => import('../Settings/DockSettings.vue'),
  [SettingsRoute.BOOKMARK_SIDEBAR]: () => import('../Settings/BookmarkSidebarSettings.vue'),
  [SettingsRoute.YIYAN]: () => import('../Settings/YiyanSettings.vue'),
  [SettingsRoute.PERFORMANCE]: () => import('../Settings/PerformanceSettings.vue'),
  [SettingsRoute.OTHER]: () => import('../Settings/OtherSettings.vue'),
} as const

const settingsAsyncViewMap: Record<SettingsRoute, Component | null> = Object.keys(
  settingsViewLoaders,
).reduce(
  (map, route) => {
    const typedRoute = route as SettingsRoute
    const loader = settingsViewLoaders[typedRoute]
    map[typedRoute] = loader ? defineAsyncComponent(loader) : null
    return map
  },
  {} as Record<SettingsRoute, Component | null>,
)

export const getSettingsView = (route: SettingsRoute): Component | null =>
  settingsAsyncViewMap[route]
