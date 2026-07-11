import { enhancedFetch } from './fetch'

interface fetchJsonpOptions {
  url: string
  params: Record<string, string>
  callbackParam: string
  callbackName: string
  parser: (data: string) => string[]
  encoding?: string // 可选的编码参数
  signal?: AbortSignal
}

/**
 * JSONP 请求实现
 * @param options JSONP 选项
 * @returns 搜索建议列表
 */
async function fetchJsonp(options: fetchJsonpOptions): Promise<string[]> {
  const { url, params, callbackParam, callbackName } = options
  const fullUrl = new URL(url)
  for (const [key, value] of Object.entries(params)) {
    fullUrl.searchParams.set(key, value)
  }
  fullUrl.searchParams.set(callbackParam, callbackName)

  const response = await enhancedFetch<string>(fullUrl.toString(), {
    responseType: 'text',
    responseEncoding: options.encoding,
    signal: options.signal,
    headers: {
      'Content-Type': 'text/plain',
    },
  })

  return options.parser(response)
}

export default fetchJsonp
