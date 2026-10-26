import { useColorMode, useStorage } from '@vueuse/core'

import { getUiPreferences, patchUiPreferences, uiPreferencesStorage } from '@/shared/uiPreferences'
import type { ColorModePreference } from '@/shared/webdavSync/types'

function isColorMode(value: string): value is ColorModePreference {
  return value === 'auto' || value === 'dark' || value === 'light'
}

// 同步写入启动缓存；所有组件共享此状态，避免多个 useDark 实例重写根元素。
const preference = useStorage<ColorModePreference>('vueuse-color-scheme', 'auto', undefined, {
  flush: 'sync',
  serializer: {
    read: (value) => (isColorMode(value) ? value : 'auto'),
    write: (value) => value,
  },
})

export const colorMode = useColorMode({
  storageRef: preference,
  // 单例统一更新主题，保留 CSS 渐变，避免 VueUse 的全局过渡禁用样式打断动画。
  disableTransition: false,
  modes: {
    dark: 'dark',
    light: 'light',
    auto: '',
  },
})

export const currentColorMode = readonly(preference)
export const isDark = computed(() => colorMode.value === 'dark')

export function setColorMode(value: ColorModePreference) {
  if (value === currentColorMode.value) return
  preference.value = value
  void patchUiPreferences({ colorMode: value })
}

let initialized = false

export async function initColorModePreference() {
  if (initialized) return
  initialized = true

  const stored = await getUiPreferences()
  if (stored.colorMode) {
    preference.value = stored.colorMode
  } else {
    await patchUiPreferences({ colorMode: preference.value })
  }

  uiPreferencesStorage.watch((next) => {
    if (next?.colorMode) preference.value = next.colorMode
  })
}
