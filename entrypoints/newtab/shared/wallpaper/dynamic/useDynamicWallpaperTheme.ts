import { useSettingsStore } from '@/shared/settings'

import { isDark } from '@newtab/shared/colorMode'

const isNightAtStartup = (() => {
  const hour = new Date().getHours()
  return hour >= 19 || hour < 7
})()

export function useDynamicWallpaperNightTheme() {
  const settings = useSettingsStore()

  return computed(
    () =>
      settings.background.dynamic.autoNightTheme &&
      (settings.background.dynamic.nightByTime ? isNightAtStartup : isDark.value),
  )
}
