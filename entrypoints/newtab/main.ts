import './styles/index.scss'
import { createPinia } from 'pinia'

import { version } from '@/package.json'

import { warmBookmarkCache } from '@/shared/bookmarks/cacheBridge'
import { BgType, isDynamicBgType } from '@/shared/enums'
import { i18n } from '@/shared/i18n'
import { hydrateFaviconCache, setFaviconCacheEnabled } from '@/shared/media'
import { useSettingsStore } from '@/shared/settings'
import { applyStoredMonetColors, getMonetColors } from '@/shared/theme'

import { useCustomSearchEngineStore } from '@newtab/shared/customSearchEngine'

import App from './App.vue'
import { setupAutoSaveSettings } from './shared/autoSaveSettings'
import { changeTheme } from './shared/theme'

export const main = async (hasSettings: boolean) => {
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
  await useSettingsStore().init(hasSettings)
  const settings = useSettingsStore()

  // 缓存预热不阻塞应用外壳；图标消费者会复用同一个预热任务。
  void hydrateFaviconCache(settings.faviconCacheEnabled)
  watch(() => settings.faviconCacheEnabled, setFaviconCacheEnabled, { immediate: true })

  changeTheme(settings.theme.primaryColor)

  // 正式样式已加载，释放首帧画布保护，让主题变量与颜色模式接管。
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

  // 与首屏挂载并行加载当前壁纸的分包，避免动态壁纸首帧再等待模块下载。
  if (isDynamicBgType(settings.background.bgType)) {
    // 动态壁纸各自是独立分包，只预热当前选中的那一份，其余保持按需加载。
    const dynamicWallpaperLoaders: Partial<Record<BgType, () => Promise<unknown>>> = {
      [BgType.Meadow]: () => import('./components/MeadowBackground.vue'),
      [BgType.Beach]: () => import('./components/BeachBackground.vue'),
      [BgType.Ocean]: () => import('./components/OceanBackground.vue'),
      [BgType.Map]: () => import('./components/MapBackground.vue'),
    }
    void dynamicWallpaperLoaders[settings.background.bgType]?.().catch((error) => {
      console.error('[newtab] Failed to preload dynamic wallpaper:', error)
    })
  }

  // 搜索引擎与首屏挂载并行；快捷链接由 App 在相关组件创建前统一初始化。
  const dataStoresInit = useCustomSearchEngineStore().init()

  app.mount('body')

  // 在应用挂载后预热，避免把书签读取放到首屏关键路径。
  void warmBookmarkCache()

  void dataStoresInit.catch((error) => {
    console.error('[newtab] Failed to initialize data stores:', error)
  })
}
