import { EnhancedFetchError } from '../../../../shared/network/fetch.ts'

export function waitForSuggestionDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
    if (signal.aborted) finish()
  })
}

export async function requestSearchSuggestions(
  request: () => Promise<string[]>,
  signal: AbortSignal,
): Promise<string[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal.aborted) return []
    try {
      return await request()
    } catch (error) {
      if (signal.aborted) return []
      const retryable =
        error instanceof EnhancedFetchError &&
        (error.kind === 'network' ||
          error.kind === 'timeout' ||
          (error.kind === 'http' && [408, 500, 502, 503, 504].includes(error.status ?? 0)))
      if (attempt > 0 || !retryable) throw error
      await waitForSuggestionDelay(100, signal)
    }
  }
  return []
}
