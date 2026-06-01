import ClockCircleOutlined from '~icons/ant-design/clock-circle-outlined'
import ControlOutlined from '~icons/ant-design/control-outlined'
import PictureOutlined from '~icons/ant-design/picture-outlined'
import SearchOutlined from '~icons/ant-design/search-outlined'
import DockRow24Regular from '~icons/fluent/dock-row-24-regular'
import ExtendedDock24Regular from '~icons/fluent/extended-dock-24-regular'
import ColorLensOutlined from '~icons/ic/outline-color-lens'
import ApiRound from '~icons/ic/round-api'
import BookmarkBorderRound from '~icons/ic/round-bookmark-border'
import DashboardOutlined from '~icons/ic/round-dashboard'
import FormatQuoteRound from '~icons/ic/round-format-quote'

export const SettingsRoute = {
  MENU: 'menu',
  THEME: 'theme',
  LAYOUT: 'layout',
  CLOCK: 'clock',
  SEARCH: 'search',
  BACKGROUND: 'background',
  QUICK_LINKS: 'quickLinks',
  DOCK: 'dock',
  BOOKMARK_SIDEBAR: 'bookmarkSidebar',
  YIYAN: 'yiyan',
  PERFORMANCE: 'performance',
  OTHER: 'other',
} as const
export type SettingsRoute = (typeof SettingsRoute)[keyof typeof SettingsRoute]

interface MenuItem {
  key: SettingsRoute
  icon: Component
  titleKey: string
}

export const MENU_ITEMS: MenuItem[] = [
  {
    key: SettingsRoute.THEME,
    icon: ColorLensOutlined,
    titleKey: 'theme.title',
  },
  {
    key: SettingsRoute.LAYOUT,
    icon: DashboardOutlined,
    titleKey: 'layout.title',
  },
  {
    key: SettingsRoute.CLOCK,
    icon: ClockCircleOutlined,
    titleKey: 'clock.title',
  },
  {
    key: SettingsRoute.SEARCH,
    icon: SearchOutlined,
    titleKey: 'search.title',
  },
  {
    key: SettingsRoute.BACKGROUND,
    icon: PictureOutlined,
    titleKey: 'background.title',
  },
  {
    key: SettingsRoute.QUICK_LINKS,
    icon: DockRow24Regular,
    titleKey: 'quickLinks.title',
  },
  {
    key: SettingsRoute.DOCK,
    icon: ExtendedDock24Regular,
    titleKey: 'dock.title',
  },
  {
    key: SettingsRoute.BOOKMARK_SIDEBAR,
    icon: BookmarkBorderRound,
    titleKey: 'bookmark.title',
  },
  {
    key: SettingsRoute.YIYAN,
    icon: FormatQuoteRound,
    titleKey: 'yiyan.title',
  },
  {
    key: SettingsRoute.PERFORMANCE,
    icon: ApiRound,
    titleKey: 'perf.title',
  },
  {
    key: SettingsRoute.OTHER,
    icon: ControlOutlined,
    titleKey: 'other.title',
  },
] as const

interface RouteState {
  current: SettingsRoute
  history: SettingsRoute[]
  isForward: boolean // 追踪导航方向以进行动画处理
}

const state = ref<RouteState>({
  // 默认空视图以避免影响初始加载性能和壁纸进入动画
  current: SettingsRoute.MENU,
  history: [],
  isForward: true,
})

export function useSettingsRouter() {
  const currentRoute = computed(() => state.value.current)
  const canGoBack = computed(() => state.value.history.length > 0)
  const isAtMenu = computed(() => state.value.current === SettingsRoute.MENU)
  const isForward = computed(() => state.value.isForward)

  const push = (route: SettingsRoute) => {
    if (state.value.current !== route) {
      state.value.history.push(state.value.current)
      state.value.current = route
      state.value.isForward = true // 向前导航
    }
  }

  const back = () => {
    const previous = state.value.history.pop()
    if (previous) {
      state.value.isForward = false // 向后导航
      state.value.current = previous
    }
  }

  const reset = (initialRoute: SettingsRoute = SettingsRoute.THEME) => {
    state.value.current = initialRoute
    state.value.history = []
  }

  return {
    currentRoute,
    canGoBack,
    isAtMenu,
    isForward,
    push,
    back,
    reset,
  }
}
