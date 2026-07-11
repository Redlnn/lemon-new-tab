export function createSingleFlightCache<T>(options: {
  ttl: number
  fetchValue: () => Promise<T>
  onValue: (value: T) => void
  now?: () => number
}) {
  const now = options.now ?? Date.now
  let cachedValue: T | undefined
  let cacheTimestamp = 0
  let invalidationGeneration = 0
  let pending: Promise<T> | null = null

  const load = async (force = false): Promise<T> => {
    if (force) cacheTimestamp = 0
    if (!force && cachedValue !== undefined && now() - cacheTimestamp <= options.ttl) {
      return cachedValue
    }
    if (pending) return pending

    const task = (async () => {
      while (true) {
        const generationAtStart = invalidationGeneration
        const value = await options.fetchValue()
        if (generationAtStart !== invalidationGeneration) continue

        cachedValue = value
        cacheTimestamp = now()
        options.onValue(value)
        return value
      }
    })()
    pending = task

    try {
      return await task
    } finally {
      if (pending === task) pending = null
    }
  }

  const invalidate = () => {
    invalidationGeneration += 1
    cachedValue = undefined
    cacheTimestamp = 0
  }

  return { load, invalidate }
}
