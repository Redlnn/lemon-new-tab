/** Share in-flight work. Undefined means the caller's deadline expired. */
export function createFaviconRequests<T>(timeout: number) {
  const pending = new Map<
    string,
    { controller: AbortController; result: Promise<T>; waiters: number }
  >()

  return (key: string, load: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
    const shared = pending.get(key)
    const controller = shared?.controller ?? new AbortController()
    const request = shared ?? {
      controller,
      waiters: 0,
      result: Promise.resolve().then(() => load(controller.signal)),
    }
    if (!shared) pending.set(key, request)
    request.waiters++

    let timer: ReturnType<typeof setTimeout>
    return new Promise<T | undefined>((resolve, reject) => {
      timer = setTimeout(() => resolve(undefined), timeout)
      request.result.then(resolve, reject)
    }).finally(() => {
      clearTimeout(timer)
      request.waiters--
      if (!request.waiters) {
        pending.delete(key)
        controller.abort()
      }
    })
  }
}
