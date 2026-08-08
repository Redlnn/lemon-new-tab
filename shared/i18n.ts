import type { App } from 'vue'

import i18next from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import I18NextVue from 'i18next-vue'
import resources from 'virtual:i18next-loader'

import { browser } from 'wxt/browser'

export const getLang = () => i18next.language || browser.i18n.getUILanguage()
export const isChinese = ref(getLang().startsWith('zh'))

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

export async function initI18n() {
  // 检测用户语言
  // 参考: https://github.com/i18next/i18next-browser-languageDetector
  await i18next.use(languageDetector).init({
    resources,
    fallbackLng: {
      'zh-MO': ['zh-HK'],
      zh: ['zh-CN'],
      default: ['en'],
    },
    load: 'currentOnly',
    nonExplicitSupportedLngs: true,
    ns: ['newtab', 'settings', 'faq'],
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

  i18next.off('languageChanged') // 避免重复绑定事件
  i18next.on('languageChanged', (lng: string) => {
    // 同步 UI：当语言变化时，更新 <html lang> 与标题
    changeDocument()
    isChinese.value = lng.startsWith('zh')
  })
}

export function i18n<T extends App>(app: T) {
  app.use(I18NextVue, { i18next })
  return app
}
