export const SEARCH_SUGGESTION_PROVIDER_IDS = [
  'calculator',
  'url',
  'quick-links',
  'top-sites',
  'browser-history',
  'search-history',
  'remote',
] as const

export type SearchSuggestionProviderId = (typeof SEARCH_SUGGESTION_PROVIDER_IDS)[number]

export function normalizeSuggestionProviders(
  value: readonly string[],
): SearchSuggestionProviderId[] {
  return SEARCH_SUGGESTION_PROVIDER_IDS.filter((id) => value.includes(id))
}

export function suggestionProviderNameKey(id: SearchSuggestionProviderId): string {
  return `settings:search.providers.${id}`
}
