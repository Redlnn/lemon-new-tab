import { defaultSettings, useSettingsStore } from '@/shared/settings'
import { changeTheme, toggleDocumentClass } from '@/shared/theme'

const MAX_TRANSPARENCY = 95
const DENSE_SURFACE_MAX_TRANSPARENCY = 80
const MAX_BACKDROP_BLUR = 40
const QUICK_LINK_MENU_MAX_RADIUS = 20

function roundTransparency(value: number): number {
  return Math.round(value * 100) / 100
}

function roundBackdropBlur(value: number): number {
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

function deriveBackdropBlur(
  value: number,
  defaultValue: number,
  childDefaultValue: number,
  maxValue = MAX_BACKDROP_BLUR,
): number {
  if (defaultValue <= 0) return roundBackdropBlur(Math.min(maxValue, Math.max(0, value)))
  return roundBackdropBlur(
    Math.min(maxValue, Math.max(0, (value * childDefaultValue) / defaultValue)),
  )
}

function setTransparencyVariable(name: string, value: number) {
  document.documentElement.style.setProperty(`--le-${name}-transparency`, `${value}%`)
}

function setBackdropBlurVariable(name: string, value: number) {
  document.documentElement.style.setProperty(`--le-${name}-backdrop-blur`, `${value}px`)
}

type TransparencySpec = {
  name: string
  childDefaultValue: number
  maxValue?: number
  valueOffset?: number
  defaultOffset?: number
}

type BackdropBlurSpec = {
  name: string
  childDefaultValue: number
  maxValue?: number
}

function applyDerivedTransparencyVariables(
  value: number,
  defaultValue: number,
  specs: TransparencySpec[],
) {
  for (const spec of specs) {
    setTransparencyVariable(
      spec.name,
      deriveTransparency(
        value + (spec.valueOffset ?? 0),
        defaultValue + (spec.defaultOffset ?? 0),
        spec.childDefaultValue,
        spec.maxValue ?? DENSE_SURFACE_MAX_TRANSPARENCY,
      ),
    )
  }
}

function applyDerivedBackdropBlurVariables(
  value: number,
  defaultValue: number,
  specs: BackdropBlurSpec[],
) {
  for (const spec of specs) {
    setBackdropBlurVariable(
      spec.name,
      deriveBackdropBlur(value, defaultValue, spec.childDefaultValue, spec.maxValue),
    )
  }
}

function applyGlobalBorderRadius(value: number) {
  document.documentElement.style.setProperty('--le-radius-base', `${Math.round(value)}px`)
}

function applyQuickLinkMenuBorderRadius(iconSize: number, iconBorderRadius: number) {
  const radius = Math.min(
    QUICK_LINK_MENU_MAX_RADIUS,
    Math.max(0, Math.round((iconSize * iconBorderRadius) / 100)),
  )
  document.documentElement.style.setProperty('--le-quick-link-menu-border-radius', `${radius}px`)
}

const ACTION_BTN_SIZE = 33
const ACTION_BTN_CONTAINER_PADDING = 5

function setActionBtnBorderRadiusVariable(name: string, value: number) {
  document.documentElement.style.setProperty(name, `${value}px`)
}

function applyActionBtnBorderRadius(value: number) {
  const buttonRadius = Math.round((ACTION_BTN_SIZE * value) / 100)
  setActionBtnBorderRadiusVariable('--le-action-btn-border-radius', buttonRadius)
  setActionBtnBorderRadiusVariable(
    '--le-action-btn-container-border-radius',
    buttonRadius + ACTION_BTN_CONTAINER_PADDING,
  )
  setActionBtnBorderRadiusVariable(
    '--le-action-btn-menu-item-border-radius',
    Math.max(4, buttonRadius - ACTION_BTN_CONTAINER_PADDING),
  )
}

function applyBookmarkTransparency(value: number) {
  setTransparencyVariable('bookmark', value)
  applyDerivedTransparencyVariables(value, defaultSettings.perf.bookmark.transparency, [
    { name: 'bookmark-menu', childDefaultValue: 30 },
  ])
}

function applyBookmarkBackdropBlur(value: number) {
  setBackdropBlurVariable('bookmark', value)
  setBackdropBlurVariable('bookmark-menu', value)
}

function applyDialogTransparency(value: number) {
  setTransparencyVariable('dialog', value)
  applyDerivedTransparencyVariables(value, defaultSettings.perf.dialog.transparency, [
    { name: 'dialog-settings-back', childDefaultValue: 20 },
    { name: 'dialog-settings-back-hover', childDefaultValue: 15 },
    { name: 'dialog-settings-items', childDefaultValue: 20 },
    { name: 'dialog-settings-option-background', childDefaultValue: 25 },
    { name: 'dialog-secondary', childDefaultValue: 20 },
    { name: 'dialog-settings-group', childDefaultValue: 30 },
    { name: 'dialog-menu', childDefaultValue: 30 },
    { name: 'dialog-settings-menu-hover', childDefaultValue: 45 },
    {
      name: 'dialog-settings-menu-active',
      childDefaultValue: 30,
      valueOffset: -10,
      defaultOffset: -10,
    },
    { name: 'dialog-settings-option', childDefaultValue: 35 },
  ])
}

function applyDialogBackdropBlur(value: number) {
  setBackdropBlurVariable('dialog', value)
  setBackdropBlurVariable('dialog-secondary', value)
  applyDerivedBackdropBlurVariables(value, defaultSettings.perf.dialog.blurIntensity, [
    { name: 'dialog-backtop', childDefaultValue: 3 },
  ])
}

function applySearchTransparency(value: number) {
  setTransparencyVariable('search', value)
  applyDerivedTransparencyVariables(value, defaultSettings.perf.searchBar.transparency, [
    { name: 'search-hover', childDefaultValue: 35, maxValue: 80 },
    { name: 'search-focus', childDefaultValue: 20, maxValue: 80 },
    { name: 'search-subtle', childDefaultValue: 60, maxValue: 80 },
    { name: 'search-menu', childDefaultValue: 30, maxValue: 80 },
    { name: 'search-menu-active', childDefaultValue: 20, maxValue: 80 },
  ])
}

function applySearchBackdropBlur(value: number) {
  setBackdropBlurVariable('search', value)
  setBackdropBlurVariable('search-menu', value)
  applyDerivedBackdropBlurVariables(value, defaultSettings.perf.searchBar.blurIntensity, [
    { name: 'search-suggestion', childDefaultValue: 30 },
  ])
}

function applyQuickLinksTransparency(value: number) {
  setTransparencyVariable('quick-links', value)
  applyDerivedTransparencyVariables(value, defaultSettings.perf.quickLinks.transparency, [
    { name: 'quick-links-hover', childDefaultValue: 30, maxValue: 80 },
    { name: 'quick-links-strong', childDefaultValue: 20, maxValue: 80 },
    { name: 'quick-links-subtle', childDefaultValue: 80, maxValue: MAX_TRANSPARENCY },
    { name: 'quick-links-tooltip', childDefaultValue: 50, maxValue: 80 },
  ])
}

function applyQuickLinksBackdropBlur(value: number) {
  setBackdropBlurVariable('quick-links', value)
  setBackdropBlurVariable('quick-links-tooltip', value)
  applyDerivedBackdropBlurVariables(value, defaultSettings.perf.quickLinks.blurIntensity, [
    { name: 'quick-links-launchpad', childDefaultValue: 40 },
  ])
}

function applyYiyanTransparency(value: number) {
  setTransparencyVariable('yiyan', value)
  applyDerivedTransparencyVariables(value, defaultSettings.perf.yiyan.transparency, [
    { name: 'yiyan-control', childDefaultValue: 60, maxValue: 80 },
  ])
}

function applyYiyanBackdropBlur(value: number) {
  setBackdropBlurVariable('yiyan', value)
}

function applyActionBtnsTransparency(value: number) {
  setTransparencyVariable('action-btns', value)
  applyDerivedTransparencyVariables(value, defaultSettings.perf.actionBtns.transparency, [
    { name: 'action-btns-hover', childDefaultValue: 60, maxValue: 80 },
    { name: 'action-btns-menu', childDefaultValue: 20, maxValue: 80 },
  ])
}

function applyActionBtnsBackdropBlur(value: number) {
  setBackdropBlurVariable('action-btns', value)
  applyDerivedBackdropBlurVariables(value, defaultSettings.perf.actionBtns.blurIntensity, [
    { name: 'action-btns-menu', childDefaultValue: 10 },
  ])
}

function getEnabledTransparency(config: { transparent: boolean; transparency: number }) {
  return config.transparent ? config.transparency : 0
}

function getEnabledBackdropBlur(config: {
  transparent: boolean
  transparency: number
  blur: boolean
  blurIntensity: number
}) {
  return config.transparent && config.transparency > 0 && config.blur ? config.blurIntensity : 0
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

  watch(() => settings.layout.globalBorderRadius, applyGlobalBorderRadius, {
    immediate: true,
  })

  watch(() => settings.layout.actionBtnBorderRadius, applyActionBtnBorderRadius, {
    immediate: true,
  })
  watch(
    () => [settings.quickLinks.iconSize, settings.quickLinks.iconBorderRadius] as const,
    ([iconSize, iconBorderRadius]) => applyQuickLinkMenuBorderRadius(iconSize, iconBorderRadius),
    { immediate: true },
  )

  watch(
    dialogTransparencyEnabled,
    (enabled) => toggleDocumentClass('dialog-transparent', enabled),
    {
      immediate: true,
    },
  )

  watch(
    [dialogTransparencyEnabled, () => settings.perf.dialog.blur],
    ([transparent, blur]) => {
      toggleDocumentClass('dialog-acrylic', transparent && blur)
    },
    { immediate: true },
  )

  const transparencyWatchers = [
    {
      source: () => getEnabledTransparency(settings.perf.bookmark),
      apply: applyBookmarkTransparency,
    },
    { source: () => getEnabledTransparency(settings.perf.dialog), apply: applyDialogTransparency },
    {
      source: () => getEnabledTransparency(settings.perf.searchBar),
      apply: applySearchTransparency,
    },
    {
      source: () => getEnabledTransparency(settings.perf.quickLinks),
      apply: applyQuickLinksTransparency,
    },
    { source: () => getEnabledTransparency(settings.perf.yiyan), apply: applyYiyanTransparency },
    {
      source: () => getEnabledTransparency(settings.perf.actionBtns),
      apply: applyActionBtnsTransparency,
    },
  ]

  const backdropBlurWatchers = [
    {
      source: () => getEnabledBackdropBlur(settings.perf.bookmark),
      apply: applyBookmarkBackdropBlur,
    },
    { source: () => getEnabledBackdropBlur(settings.perf.dialog), apply: applyDialogBackdropBlur },
    {
      source: () => getEnabledBackdropBlur(settings.perf.searchBar),
      apply: applySearchBackdropBlur,
    },
    {
      source: () => getEnabledBackdropBlur(settings.perf.quickLinks),
      apply: applyQuickLinksBackdropBlur,
    },
    { source: () => getEnabledBackdropBlur(settings.perf.yiyan), apply: applyYiyanBackdropBlur },
    {
      source: () => getEnabledBackdropBlur(settings.perf.actionBtns),
      apply: applyActionBtnsBackdropBlur,
    },
  ]

  for (const { source, apply } of transparencyWatchers) {
    watch(source, apply, { immediate: true })
  }

  for (const { source, apply } of backdropBlurWatchers) {
    watch(source, apply, { immediate: true })
  }
}
