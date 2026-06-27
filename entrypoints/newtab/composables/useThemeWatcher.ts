import { defaultSettings, useSettingsStore } from '@/shared/settings'
import { changeTheme, toggleDocumentClass } from '@/shared/theme'

const MAX_TRANSPARENCY = 95
const DENSE_SURFACE_MAX_TRANSPARENCY = 80

function roundTransparency(value: number): number {
  return Math.round(value * 100) / 100
}

function deriveTransparency(
  value: number,
  defaultValue: number,
  childDefaultValue: number,
  maxValue = MAX_TRANSPARENCY,
): number {
  const derived =
    value <= defaultValue
      ? (value * childDefaultValue) / defaultValue
      : value + childDefaultValue - defaultValue
  return roundTransparency(Math.min(maxValue, Math.max(0, derived)))
}

function setTransparencyVariable(name: string, value: number) {
  document.documentElement.style.setProperty(`--le-${name}-transparency`, `${value}%`)
}

/**
 * 以现有固定透明度为锚点派生交互态和子面板透明度：默认值视觉不变，
 * 向下可线性收敛到完全不透明，向上则保留层级差并限制密集内容的最大透明度。
 */
function applyTransparencyVariables(values: {
  bookmark: number
  dialog: number
  searchBar: number
  quickLinks: number
  yiyan: number
  actionBtns: number
}) {
  setTransparencyVariable('bookmark', values.bookmark)
  setTransparencyVariable(
    'bookmark-menu',
    deriveTransparency(
      values.bookmark,
      defaultSettings.perf.bookmark.transparency,
      30,
      DENSE_SURFACE_MAX_TRANSPARENCY,
    ),
  )

  setTransparencyVariable('dialog', values.dialog)
  setTransparencyVariable(
    'dialog-secondary',
    deriveTransparency(
      values.dialog,
      defaultSettings.perf.dialog.transparency,
      20,
      DENSE_SURFACE_MAX_TRANSPARENCY,
    ),
  )
  setTransparencyVariable(
    'dialog-menu',
    deriveTransparency(
      values.dialog,
      defaultSettings.perf.dialog.transparency,
      30,
      DENSE_SURFACE_MAX_TRANSPARENCY,
    ),
  )

  setTransparencyVariable('search', values.searchBar)
  setTransparencyVariable(
    'search-hover',
    deriveTransparency(values.searchBar, defaultSettings.perf.searchBar.transparency, 35, 80),
  )
  setTransparencyVariable(
    'search-focus',
    deriveTransparency(values.searchBar, defaultSettings.perf.searchBar.transparency, 20, 80),
  )
  setTransparencyVariable(
    'search-subtle',
    deriveTransparency(values.searchBar, defaultSettings.perf.searchBar.transparency, 60, 80),
  )
  setTransparencyVariable(
    'search-menu',
    deriveTransparency(values.searchBar, defaultSettings.perf.searchBar.transparency, 30, 80),
  )
  setTransparencyVariable(
    'search-menu-active',
    deriveTransparency(values.searchBar, defaultSettings.perf.searchBar.transparency, 20, 80),
  )

  setTransparencyVariable('quick-links', values.quickLinks)
  setTransparencyVariable(
    'quick-links-hover',
    deriveTransparency(values.quickLinks, defaultSettings.perf.quickLinks.transparency, 30, 80),
  )
  setTransparencyVariable(
    'quick-links-strong',
    deriveTransparency(values.quickLinks, defaultSettings.perf.quickLinks.transparency, 20, 80),
  )
  setTransparencyVariable(
    'quick-links-subtle',
    deriveTransparency(values.quickLinks, defaultSettings.perf.quickLinks.transparency, 80),
  )
  setTransparencyVariable(
    'quick-links-tooltip',
    deriveTransparency(values.quickLinks, defaultSettings.perf.quickLinks.transparency, 50, 80),
  )

  setTransparencyVariable('yiyan', values.yiyan)
  setTransparencyVariable(
    'yiyan-control',
    deriveTransparency(values.yiyan, defaultSettings.perf.yiyan.transparency, 60, 80),
  )

  setTransparencyVariable('action-btns', values.actionBtns)
  setTransparencyVariable(
    'action-btns-hover',
    deriveTransparency(values.actionBtns, defaultSettings.perf.actionBtns.transparency, 60, 80),
  )
  setTransparencyVariable(
    'action-btns-menu',
    deriveTransparency(values.actionBtns, defaultSettings.perf.actionBtns.transparency, 20, 80),
  )
}

/**
 * 监听主题与外观相关设置变化，自动应用 CSS 类和主题色。
 * 应在 App.vue setup 中调用一次。
 */
export function useThemeWatcher() {
  const settings = useSettingsStore()
  const dialogTransparencyEnabled = computed(
    () => settings.perf.dialog.transparent && settings.perf.dialog.transparency > 0,
  )

  watch(
    () => settings.theme.primaryColor,
    (color) => {
      if (color === null) return
      changeTheme(color)
    },
  )

  watch(
    () => settings.theme.colorfulMode,
    (colorful) => {
      toggleDocumentClass('colorful', colorful)
    },
    { immediate: true },
  )

  watch(dialogTransparencyEnabled, (enabled) => toggleDocumentClass('dialog-transparent', enabled), {
    immediate: true,
  })

  watch(
    [dialogTransparencyEnabled, () => settings.perf.dialog.blur],
    ([transparent, blur]) => {
      toggleDocumentClass('dialog-acrylic', transparent && blur)
    },
    { immediate: true },
  )

  watch(
    [
      () =>
        settings.perf.bookmark.transparent ? settings.perf.bookmark.transparency : 0,
      () => settings.perf.dialog.transparent ? settings.perf.dialog.transparency : 0,
      () => settings.perf.searchBar.transparent ? settings.perf.searchBar.transparency : 0,
      () =>
        settings.perf.quickLinks.transparent ? settings.perf.quickLinks.transparency : 0,
      () => settings.perf.yiyan.transparent ? settings.perf.yiyan.transparency : 0,
      () =>
        settings.perf.actionBtns.transparent ? settings.perf.actionBtns.transparency : 0,
    ],
    ([bookmark, dialog, searchBar, quickLinks, yiyan, actionBtns]) => {
      applyTransparencyVariables({
        bookmark,
        dialog,
        searchBar,
        quickLinks,
        yiyan,
        actionBtns,
      })
    },
    { immediate: true },
  )
}
