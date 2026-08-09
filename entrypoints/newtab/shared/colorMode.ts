import { useColorMode, usePreferredDark } from '@vueuse/core'

import type { ColorModePreference } from '@/shared/webdavSync'
import { getUiPreferences, patchUiPreferences, uiPreferencesStorage } from '@/shared/uiPreferences'

// 单例：在模块加载时（页面启动阶段）初始化，避免在组件挂载时重复调用
// 导致 watchEffect 在设置面板动画期间触发全页面样式重计算
export const preferredDark = usePreferredDark()

export const colorMode = useColorMode({
  modes: {
    dark: 'dark',
    light: 'light',
    auto: '',
  },
})

let initialized = false
let applyingStoredValue = false

function isColorMode(value: string): value is ColorModePreference {
  return value === 'auto' || value === 'dark' || value === 'light'
}

export async function initColorModePreference() {
  if (initialized) return
  initialized = true

  const stored = await getUiPreferences()
  if (stored.colorMode) colorMode.store.value = stored.colorMode
  else if (isColorMode(colorMode.store.value)) {
    await patchUiPreferences({ colorMode: colorMode.store.value })
  }

  watch(colorMode.store, (value) => {
    if (!applyingStoredValue && isColorMode(value)) {
      void patchUiPreferences({ colorMode: value })
    }
  })

  uiPreferencesStorage.watch((next) => {
    if (!next?.colorMode || next.colorMode === colorMode.store.value) return
    applyingStoredValue = true
    colorMode.store.value = next.colorMode
    applyingStoredValue = false
  })
}
