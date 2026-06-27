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

function applyBookmarkTransparency(value: number) {
  setTransparencyVariable('bookmark', value)
  setTransparencyVariable(
    'bookmark-menu',
    deriveTransparency(
      value,
      defaultSettings.perf.bookmark.transparency,
      30,
      DENSE_SURFACE_MAX_TRANSPARENCY,
    ),
  )
}

function applyDialogTransparency(value: number) {
  setTransparencyVariable('dialog', value)
  setTransparencyVariable(
    'dialog-secondary',
    deriveTransparency(
      value,
      defaultSettings.perf.dialog.transparency,
      20,
      DENSE_SURFACE_MAX_TRANSPARENCY,
    ),
  )
  setTransparencyVariable(
    'dialog-menu',
    deriveTransparency(
      value,
      defaultSettings.perf.dialog.transparency,
      30,
      DENSE_SURFACE_MAX_TRANSPARENCY,
    ),
  )
}

function applySearchTransparency(value: number) {
  setTransparencyVariable('search', value)
  setTransparencyVariable(
    'search-hover',
    deriveTransparency(value, defaultSettings.perf.searchBar.transparency, 35, 80),
  )
  setTransparencyVariable(
    'search-focus',
    deriveTransparency(value, defaultSettings.perf.searchBar.transparency, 20, 80),
  )
  setTransparencyVariable(
    'search-subtle',
    deriveTransparency(value, defaultSettings.perf.searchBar.transparency, 60, 80),
  )
  setTransparencyVariable(
    'search-menu',
    deriveTransparency(value, defaultSettings.perf.searchBar.transparency, 30, 80),
  )
  setTransparencyVariable(
    'search-menu-active',
    deriveTransparency(value, defaultSettings.perf.searchBar.transparency, 20, 80),
  )
}

function applyQuickLinksTransparency(value: number) {
  setTransparencyVariable('quick-links', value)
  setTransparencyVariable(
    'quick-links-hover',
    deriveTransparency(value, defaultSettings.perf.quickLinks.transparency, 30, 80),
  )
  setTransparencyVariable(
    'quick-links-strong',
    deriveTransparency(value, defaultSettings.perf.quickLinks.transparency, 20, 80),
  )
  setTransparencyVariable(
    'quick-links-subtle',
    deriveTransparency(value, defaultSettings.perf.quickLinks.transparency, 80),
  )
  setTransparencyVariable(
    'quick-links-tooltip',
    deriveTransparency(value, defaultSettings.perf.quickLinks.transparency, 50, 80),
  )
}

function applyYiyanTransparency(value: number) {
  setTransparencyVariable('yiyan', value)
  setTransparencyVariable(
    'yiyan-control',
    deriveTransparency(value, defaultSettings.perf.yiyan.transparency, 60, 80),
  )
}

function applyActionBtnsTransparency(value: number) {
  setTransparencyVariable('action-btns', value)
  setTransparencyVariable(
    'action-btns-hover',
    deriveTransparency(value, defaultSettings.perf.actionBtns.transparency, 60, 80),
  )
  setTransparencyVariable(
    'action-btns-menu',
    deriveTransparency(value, defaultSettings.perf.actionBtns.transparency, 20, 80),
  )
}

function getEnabledTransparency(config: { transparent: boolean; transparency: number }) {
  return config.transparent ? config.transparency : 0
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
    () => getEnabledTransparency(settings.perf.bookmark),
    applyBookmarkTransparency,
    { immediate: true },
  )
  watch(
    () => getEnabledTransparency(settings.perf.dialog),
    applyDialogTransparency,
    { immediate: true },
  )
  watch(
    () => getEnabledTransparency(settings.perf.searchBar),
    applySearchTransparency,
    { immediate: true },
  )
  watch(
    () => getEnabledTransparency(settings.perf.quickLinks),
    applyQuickLinksTransparency,
    { immediate: true },
  )
  watch(
    () => getEnabledTransparency(settings.perf.yiyan),
    applyYiyanTransparency,
    { immediate: true },
  )
  watch(
    () => getEnabledTransparency(settings.perf.actionBtns),
    applyActionBtnsTransparency,
    { immediate: true },
  )
}
