import type { BuiltInSearchEngineKey } from '@/shared/searchEngines'

import baiduIconUrl from '@newtab/assets/baidu.svg?url&no-inline'
import bingIconUrl from '@newtab/assets/bing.svg?url&no-inline'
import duckDuckGoIconUrl from '@newtab/assets/duckduckgo.svg?url&no-inline'
import googleIconUrl from '@newtab/assets/google.svg?url&no-inline'
import yandexIconUrl from '@newtab/assets/yandex.svg?url&no-inline'
import { useCustomSearchEngineStore } from '@newtab/shared/customSearchEngine'

import { baiduSuggestParser, bingSuggestParser, googleSuggestParser } from './suggestParser'

export * from './suggestCache'
export * from './suggestParser'
export * from '@/shared/searchEngines'

export const searchEngines = {
  google: {
    nameKey: 'newtab:search.engines.google',
    url: 'https://www.google.com/search?q=%s',
    iconUrl: googleIconUrl,
  },
  baidu: {
    nameKey: 'newtab:search.engines.baidu',
    url: 'https://www.baidu.com/#ie=utf-8&wd=%s',
    iconUrl: baiduIconUrl,
  },
  bing: {
    nameKey: 'newtab:search.engines.bing',
    url: 'https://www.bing.com/search?q=%s',
    iconUrl: bingIconUrl,
  },
  yandex: {
    nameKey: 'newtab:search.engines.yandex',
    url: 'https://yandex.com/search?text=%s',
    iconUrl: yandexIconUrl,
  },
  duckduckgo: {
    nameKey: 'newtab:search.engines.duckduckgo',
    url: 'https://duckduckgo.com/?q=%s',
    iconUrl: duckDuckGoIconUrl,
  },
} as const satisfies Record<BuiltInSearchEngineKey, unknown>

export const searchSuggestAPIs = {
  google: { nameKey: 'newtab:search.engines.google', parser: googleSuggestParser },
  baidu: { nameKey: 'newtab:search.engines.baidu', parser: baiduSuggestParser },
  bing: { nameKey: 'newtab:search.engines.bing', parser: bingSuggestParser },
} as const

/**
 * 获取搜索引擎的 URL（支持内置和自定义搜索引擎）
 * @param engineKey 搜索引擎键或自定义引擎 ID
 * @returns 搜索 URL 或 null
 */
export function getSearchEngineUrl(engineKey: string): string | null {
  // 优先检查内置搜索引擎
  if (engineKey in searchEngines) {
    return searchEngines[engineKey as keyof typeof searchEngines].url
  }

  // 检查自定义搜索引擎
  const customStore = useCustomSearchEngineStore()
  const customEngine = customStore.items.find((e) => e.id === engineKey)
  return customEngine?.url || null
}
