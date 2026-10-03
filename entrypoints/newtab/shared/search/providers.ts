import {
  SEARCH_SUGGESTION_PROVIDER_IDS,
  type SearchSuggestionProviderId,
} from '../../../../shared/searchSuggestionProviders.ts'

export type SuggestionAction = 'copy' | 'navigate' | 'search'

export interface SearchSuggestion {
  provider: SearchSuggestionProviderId
  action: SuggestionAction
  text: string
  url?: string
  inputText?: string
  copyText?: string
}

export type SuggestionProvider = (
  remaining: number,
) => Iterable<SearchSuggestion> | Promise<Iterable<SearchSuggestion>>

/** 按需生成本地候选，由收集器在去重后满额时停止遍历。 */
export function* websiteSuggestions(
  provider: 'quick-links' | 'top-sites',
  items: readonly { title?: string; url: string }[],
  query: string,
): Generator<SearchSuggestion> {
  const normalizedQuery = query.toLocaleLowerCase()
  for (const item of items) {
    if (`${item.title ?? ''} ${item.url}`.toLocaleLowerCase().includes(normalizedQuery))
      yield { provider, action: 'navigate', text: item.title || item.url, url: item.url }
  }
}

export function* searchHistorySuggestions(
  histories: readonly string[],
  query: string,
): Generator<SearchSuggestion> {
  const normalizedQuery = query.toLocaleLowerCase()
  for (const text of histories) {
    if (text.toLocaleLowerCase().includes(normalizedQuery))
      yield { provider: 'search-history', action: 'search', text }
  }
}

/** 按优先级逐个获取；名额计算在去重后进行，满额时不触碰后续提供器。 */
export async function collectSuggestions({
  enabled,
  providers,
  signal,
  browserHistoryLimit = 3,
  onUpdate,
  onError,
}: {
  enabled: readonly SearchSuggestionProviderId[]
  providers: Partial<Record<SearchSuggestionProviderId, SuggestionProvider>>
  signal: AbortSignal
  browserHistoryLimit?: number
  onUpdate: (items: SearchSuggestion[]) => void
  onError?: (provider: SearchSuggestionProviderId, error: unknown) => void
}): Promise<void> {
  const items: SearchSuggestion[] = []
  const seen = new Set<string>()
  for (const id of SEARCH_SUGGESTION_PROVIDER_IDS) {
    if (signal.aborted || items.length >= 10) return
    const provider = providers[id]
    if (!enabled.includes(id) || !provider) continue
    try {
      const result = provider(10 - items.length)
      const candidates = result instanceof Promise ? await result : result
      if (signal.aborted) return
      let added = 0
      for (const item of candidates) {
        if (items.length >= 10 || (id === 'browser-history' && added >= browserHistoryLimit)) break
        let targetUrl = item.url
        if (targetUrl) {
          try {
            targetUrl = new URL(targetUrl).href
          } catch {
            /* 保留现有自定义链接行为。 */
          }
        }
        const key =
          item.action === 'navigate'
            ? `url:${targetUrl}`
            : item.action === 'search'
              ? `text:${item.text.trim().toLocaleLowerCase()}`
              : `copy:${item.copyText}`
        if (!item.text.trim() || seen.has(key)) continue
        seen.add(key)
        items.push(item)
        added++
        if (items.length >= 10 || (id === 'browser-history' && added >= browserHistoryLimit)) break
      }
      onUpdate(items.slice())
    } catch (error) {
      if (signal.aborted) return
      onError?.(id, error)
    }
  }
}

export function browserHistorySuggestions(
  history: readonly { url?: string; title?: string; lastVisitTime?: number }[],
): SearchSuggestion[] {
  return [...history]
    .sort((a, b) => (b.lastVisitTime ?? 0) - (a.lastVisitTime ?? 0))
    .flatMap((item): SearchSuggestion[] => {
      if (!item.url) return []
      try {
        const url = new URL(item.url)
        if (!['http:', 'https:'].includes(url.protocol)) return []
        return [
          {
            provider: 'browser-history',
            action: 'navigate',
            text: item.title?.trim() || url.href,
            url: url.href,
            inputText: url.href,
          },
        ]
      } catch {
        return []
      }
    })
}
