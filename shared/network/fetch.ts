interface FetchOptions extends RequestInit {
  timeout?: number
  responseType?: 'json' | 'text'
  responseEncoding?: string
}

export class EnhancedFetchError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'http' | 'network' | 'invalid-data',
    readonly url: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'EnhancedFetchError'
  }
}

/**
 * 封装的 fetch 函数，支持超时和错误处理
 */
export async function enhancedFetch<T = unknown>(
  url: string,
  options: FetchOptions = {},
): Promise<T> {
  const { timeout = 2000, responseType = 'json', responseEncoding, ...fetchOptions } = options

  // 添加默认 headers
  const headers = new Headers(fetchOptions.headers)
  // 仅当存在 body 或非 GET 请求时设置默认 Content-Type
  const method = (fetchOptions.method || 'GET').toUpperCase()
  if ((!headers.has('Content-Type') && fetchOptions.body) || method !== 'GET') {
    headers.set('Content-Type', headers.get('Content-Type') || 'application/json')
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    // 处理 HTTP 错误状态码
    if (!response.ok) {
      throw new EnhancedFetchError(
        `HTTP ${response.status} while fetching ${url}`,
        'http',
        url,
        response.status,
      )
    }

    try {
      if (responseType === 'text') {
        // 如果指定了编码，使用 TextDecoder 解码
        if (responseEncoding) {
          const buffer = await response.arrayBuffer()
          const decoder = new TextDecoder(responseEncoding)
          return decoder.decode(buffer) as T
        }
        return response.text() as Promise<T>
      }

      return response.json() as Promise<T>
    } catch (error) {
      throw new EnhancedFetchError(
        `Invalid ${responseType} response from ${url}`,
        'invalid-data',
        url,
        response.status,
        { cause: error },
      )
    }
  } catch (error) {
    if (error instanceof EnhancedFetchError) {
      console.error(`[fetch:${error.kind}] ${error.message}`)
      throw error
    }

    if (error instanceof Error && error.name === 'AbortError') {
      const wrappedError = new EnhancedFetchError(
        `Fetch timed out after ${timeout}ms: ${url}`,
        'timeout',
        url,
        undefined,
        { cause: error },
      )
      console.error(`[fetch:${wrappedError.kind}] ${wrappedError.message}`)
      throw wrappedError
    }

    const wrappedError = new EnhancedFetchError(
      `Network request failed: ${url}`,
      'network',
      url,
      undefined,
      {
        cause: error,
      },
    )
    console.error(`[fetch:${wrappedError.kind}] ${wrappedError.message}`)
    throw wrappedError
  } finally {
    clearTimeout(timeoutId)
  }
}

export default enhancedFetch
