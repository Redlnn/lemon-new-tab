import { useColorMode, useTimeoutFn } from '@vueuse/core'

import { getUiPreferences, patchUiPreferences, uiPreferencesStorage } from '@/shared/uiPreferences'
import type { ColorModePreference } from '@/shared/webdavSync/types'

// 单例：在模块加载时（页面启动阶段）初始化，避免在组件挂载时重复调用
// 导致 watchEffect 在设置面板动画期间触发全页面样式重计算
export const colorMode = useColorMode({
  modes: {
    dark: 'dark',
    light: 'light',
    auto: '',
  },
})

const pendingMode = ref<ColorModePreference>()
export const currentColorMode = computed(() => pendingMode.value ?? colorMode.store.value)

// 先让 CSS 过渡完成，再触发 useDark 等消费者；定时器与页面单例一起存活。
const { start, stop } = useTimeoutFn(
  () => {
    const value = pendingMode.value
    pendingMode.value = undefined
    if (value) colorMode.store.value = value
  },
  300,
  { immediate: false },
)

watch(
  colorMode.store,
  () => {
    stop()
    pendingMode.value = undefined
  },
  { flush: 'sync' },
)

export function setColorMode(value: ColorModePreference) {
  if (value === currentColorMode.value) return
  pendingMode.value = value
  const resolved = value === 'auto' ? colorMode.system.value : value
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  document.documentElement.classList.toggle('light', resolved === 'light')
  start()
}

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
