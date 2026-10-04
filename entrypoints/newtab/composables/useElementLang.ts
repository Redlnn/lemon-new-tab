import type { Language } from 'element-plus/es/locale'
import i18next from 'i18next'

import { getLang } from '@/shared/i18n'

const elementLocales = import.meta.glob<{ default: Language }>(
  '/node_modules/element-plus/es/locale/lang/{en,zh-cn,zh-tw,zh-hk,zh-mo,tr}.mjs',
)

async function loadElementLocale(lng: string): Promise<Language> {
  const normalizedLocale = lng.toLowerCase().replaceAll('_', '-')
  const localeNames = [normalizedLocale, normalizedLocale.split('-')[0], 'en']

  for (const localeName of localeNames) {
    const loader = elementLocales[`/node_modules/element-plus/es/locale/lang/${localeName}.mjs`]
    if (loader) return (await loader()).default
  }

  throw new Error(`Element Plus locale not found: ${lng}`)
}

const elLocale = shallowRef<Language>()

export function useElementLang() {
  let languageVersion = 0
  // 在语言切换时同步 Element Plus 语言包；不支持的区域变体回退到基础语言或英文。
  const onLngChanged = async (lng: string) => {
    const version = ++languageVersion
    try {
      const locale = await loadElementLocale(lng)
      if (version === languageVersion) elLocale.value = locale
    } catch (error) {
      console.error('[i18n] Failed to load component language:', error)
    }
  }
  onBeforeMount(() => onLngChanged(getLang()))
  i18next.on('languageChanged', onLngChanged)

  onUnmounted(() => {
    languageVersion++
    i18next.off('languageChanged', onLngChanged)
  })

  return elLocale
}
