import type { App } from 'vue'

import i18next, { type BackendModule } from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import I18NextVue from 'i18next-vue'

import { browser } from 'wxt/browser'

import {
  getUiPreferences,
  patchUiPreferences,
  type UiPreferencesV1,
  uiPreferencesStorage,
} from './uiPreferences'

export const getLang = () => i18next.language || browser.i18n.getUILanguage()
export const isChinese = ref(getLang().startsWith('zh'))
let stopUiPreferencesWatch: (() => void) | null = null

function isHKorMO() {
  const { timeZone } = Intl.DateTimeFormat().resolvedOptions()
  if (timeZone === 'Asia/Hong_Kong' || timeZone === 'Asia/Macau') {
    return true
  }
  return false
}

function changeDocument() {
  document.documentElement.lang = i18next.language
  document.title = i18next.t('newtab:title')
}

const languageDetector = new LanguageDetector(null, {
  order: ['localStorage', 'navigator'],
  caches: ['localStorage'],
})

const resources = import.meta.glob<Record<string, unknown>>('/locales/*/*.json', {
  import: 'default',
})

// 交给 i18next 等待当前语言及回退资源，语言切换完成前不发布新语言。
const resourceBackend: BackendModule = {
  type: 'backend',
  callbackApi: false,
  init() {},
  read(language, namespace) {
    const load = resources[`/locales/${language}/${namespace}.json`]
    return load ? load() : Promise.resolve({})
  },
}

export async function initI18n(initialPreferences?: UiPreferencesV1) {
  const uiPreferences = initialPreferences ?? (await getUiPreferences())
  // 检测用户语言
  // 参考: https://github.com/i18next/i18next-browser-languageDetector
  await i18next
    .use(languageDetector)
    .use(resourceBackend)
    .init({
      lng: uiPreferences.language,
      fallbackLng: {
        'zh-MO': ['zh-HK'],
        zh: ['zh-CN'],
        default: ['en'],
      },
      load: 'currentOnly',
      nonExplicitSupportedLngs: true,
      ns: ['newtab', 'settings', 'faq', 'popup'],
      defaultNS: 'newtab',
      debug: import.meta.env.DEV,
      interpolation: {
        escapeValue: false,
      },
    })

  // Windows 不能正确区分 zh-HK 和 zh-TW，把所有繁体中文都当作 zh-TW
  if (i18next.language === 'zh-TW' && isHKorMO()) {
    await i18next.changeLanguage('zh-HK')
  }

  changeDocument()
  isChinese.value = i18next.language.startsWith('zh')
  await patchUiPreferences({ language: i18next.language })

  i18next.off('languageChanged') // 避免重复绑定事件
  i18next.on('languageChanged', (lng: string) => {
    // 同步 UI：当语言变化时，更新 <html lang> 与标题
    changeDocument()
    isChinese.value = lng.startsWith('zh')
    void patchUiPreferences({ language: lng })
  })

  stopUiPreferencesWatch?.()
  stopUiPreferencesWatch = uiPreferencesStorage.watch((next) => {
    if (next?.language && next.language !== i18next.language) {
      void i18next.changeLanguage(next.language)
    }
  })
}

export function i18n<T extends App>(app: T) {
  app.use(I18NextVue, { i18next })
  return app
}
