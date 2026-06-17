import { enhancedFetch } from './fetch'

interface fetchJsonpOptions {
  url: string
  params: Record<string, string>
  callbackParam: string
  callbackName: string
  parser: (data: string) => string[]
  encoding?: string // 可选的编码参数
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

  try {
    const response = await enhancedFetch<string>(fullUrl.toString(), {
      responseType: 'text',
      responseEncoding: options.encoding,
      headers: {
        'Content-Type': 'text/plain',
      },
    })

    return options.parser(response)
  } catch (error) {
    console.error('JSONP request failed:', error)
    return [] // 返回空数组作为降级处理
  }
}

export default fetchJsonp
