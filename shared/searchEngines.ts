export const BUILT_IN_SEARCH_ENGINE_KEYS = [
  'google',
  'baidu',
  'bing',
  'yandex',
  'duckduckgo',
] as const

export type BuiltInSearchEngineKey = (typeof BUILT_IN_SEARCH_ENGINE_KEYS)[number]

const BUILT_IN_SEARCH_ENGINE_KEY_SET = new Set<string>(BUILT_IN_SEARCH_ENGINE_KEYS)

export function isBuiltInSearchEngineKey(value: unknown): value is BuiltInSearchEngineKey {
  return typeof value === 'string' && BUILT_IN_SEARCH_ENGINE_KEY_SET.has(value)
}

export function normalizeBuiltInSearchEngineOrder(
  order: readonly string[],
): BuiltInSearchEngineKey[] {
  const seen = new Set<string>()
  return [...order, ...BUILT_IN_SEARCH_ENGINE_KEYS].filter((key): key is BuiltInSearchEngineKey => {
    if (!isBuiltInSearchEngineKey(key) || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function getVisibleBuiltInSearchEngineKeys(
  order: readonly string[],
  hidden: readonly string[],
): BuiltInSearchEngineKey[] {
  const hiddenKeys = new Set(hidden.filter(isBuiltInSearchEngineKey))
  return normalizeBuiltInSearchEngineOrder(order).filter((key) => !hiddenKeys.has(key))
}

export function getAvailableSearchEngineIds(
  order: readonly string[],
  hidden: readonly string[],
  customIds: readonly string[],
): string[] {
  const seen = new Set<string>()
  return [...getVisibleBuiltInSearchEngineKeys(order, hidden), ...customIds].filter((id) => {
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export function ensureSearchEngineAvailable(
  search: {
    engine: string
    builtInEngineOrder: BuiltInSearchEngineKey[]
    hiddenBuiltInEngines: BuiltInSearchEngineKey[]
  },
  customIds: readonly string[],
) {
  const available = getAvailableSearchEngineIds(
    search.builtInEngineOrder,
    search.hiddenBuiltInEngines,
    customIds,
  )
  if (available.includes(search.engine)) return
  if (available.length > 0) {
    search.engine = available[0]!
    return
  }
  search.hiddenBuiltInEngines = search.hiddenBuiltInEngines.filter((key) => key !== 'bing')
  search.engine = 'bing'
}
