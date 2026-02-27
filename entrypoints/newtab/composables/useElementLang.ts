import type { Language } from 'element-plus/es/locale'
import i18next from 'i18next'

import { getLang } from '@/shared/i18n'

const elementZhLocales = import.meta.glob<{ default: Language }>(
  '/node_modules/element-plus/es/locale/lang/zh*.mjs'
)

// 由于考虑面向用户群体，只包含中文、英文
async function loadElementLocale(): Promise<Language> {
  const formattedLocale = getLang().toLowerCase()
  const loader =
    elementZhLocales[`/node_modules/element-plus/es/locale/lang/${formattedLocale}.mjs`]

  if (loader) {
    return (await loader()).default
  }

  // 当遇到不支持的 zh 语言时，回退到 zh-cn
  return (await import('element-plus/es/locale/lang/zh-cn.mjs')).default
}

const elLocale = ref<Language>()

export function useElementLang() {
  onBeforeMount(async () => {
    if (getLang().startsWith('zh')) {
      elLocale.value = await loadElementLocale()
    }
  })

  // 在语言切换时同步 Element Plus 语言包（仅中文按需加载，英文使用默认）
  const onLngChanged = async (lng: string) => {
    if (lng?.startsWith('zh')) {
      elLocale.value = await loadElementLocale()
    } else {
      elLocale.value = undefined
    }
  }
  i18next.on('languageChanged', onLngChanged)

  return elLocale
}
