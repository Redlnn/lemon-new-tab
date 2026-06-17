import './styles/index.scss'
import { createPinia } from 'pinia'

import { version } from '@/package.json'

import { i18n } from '@/shared/i18n'
import { setFaviconCacheEnabled } from '@/shared/media'
import { useQuickLinksStore } from '@/shared/quickLinks'
import { useSettingsStore } from '@/shared/settings'
import { useSyncDataStore } from '@/shared/sync'
import { applyStoredMonetColors, getMonetColors } from '@/shared/theme'

import { colorMode, preferredDark } from '@newtab/shared/colorMode'
import { useCustomSearchEngineStore } from '@newtab/shared/customSearchEngine'

import App from './App.vue'
import { setupAutoSaveSettings } from './shared/autoSaveSettings'
import { changeTheme } from './shared/theme'

const { store } = colorMode
watch(
  preferredDark,
  () => {
    if (store.value === 'auto') {
      if (preferredDark.value) {
        document.documentElement.classList.add('dark')
        document.documentElement.classList.remove('light')
      } else {
        document.documentElement.classList.add('light')
        document.documentElement.classList.remove('dark')
      }
    }
  },
  { immediate: true },
)

export const main = async () => {
  const banner = `\n%c Lemon New Tab %c ${version}%c\n\n`

  console.log(
    banner,
    'padding: 2px 6px; border-radius: 4px 0 0 4px; color: #fff; background: #ff9d00; font-weight: bold;',
    'padding: 2px 6px; border-radius: 0 4px 4px 0; color: #fff; background: #ffbf00; font-weight: bold;',
    '',
  )

  const app = createApp(App)
  const pinia = createPinia()

  i18n(app)
  app.use(pinia)

  // 必须先加载设置：组件渲染依赖设置（主题、v-if 控制等）
  await useSettingsStore().init()
  const settings = useSettingsStore()

  // 设置 favicon 缓存标志（移到 initCustomSearchEngine 之前，修复时序问题）
  watch(() => settings.faviconCacheEnabled, setFaviconCacheEnabled, { immediate: true })

  changeTheme(settings.theme.primaryColor)

  // 清除 index.html 内联脚本设置的临时内联样式，让 CSS 变量接管
  document.documentElement.style.removeProperty('background-color')
  document.documentElement.style.removeProperty('color-scheme')

  // 如果开启了莫奈模式，先应用之前存储的莫奈配色，避免加载壁纸期间的视觉跳变
  if (settings.theme.monetColor) {
    const storedColors = await getMonetColors()
    if (storedColors) {
      applyStoredMonetColors(storedColors)
    }
  }

  setupAutoSaveSettings(settings)

  // 先恢复快速导航和搜索引擎数据，避免组件首刷在空 store 上写回存储
  await Promise.all([useCustomSearchEngineStore().init(), useQuickLinksStore().init()])

  app.mount('body')

  if (settings.sync.enabled) {
    useSyncDataStore().init()
  }
}
