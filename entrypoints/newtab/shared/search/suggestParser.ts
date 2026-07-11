import { enhancedFetch } from '@/shared/network/fetch'
import fetchJsonp from '@/shared/network/fetchJsonp'

interface BingSuggestItem {
  Txt: string
  Type: string
  Sk: string
  HCS?: number
}

interface BingSuggest {
  AS: {
    Query: string
    FullResults: number
    Results: [
      {
        Type: string
        Suggests: BingSuggestItem[]
      },
    ]
  }
}

async function bingSuggestParser(text: string, signal?: AbortSignal): Promise<string[]> {
  const url = `https://api.bing.com/qsonhs.aspx?q=${encodeURIComponent(text)}`
  const resp: BingSuggest = await enhancedFetch(url, { signal })

  if (resp.AS.FullResults <= 0) {
    return []
  }
  return resp.AS.Results[0].Suggests.map((s) => s.Txt)
}

function baiduJsonpParser(text: string): string[] {
  const match = /\[.*\]/.exec(text)
  if (match?.[0]) {
    return JSON.parse(match[0])
  }
  throw new Error(`Invalid Baidu suggestion response: ${text}`)
}

async function baiduSuggestParser(text: string, signal?: AbortSignal): Promise<string[]> {
  const url = `https://suggestion.baidu.com/su?wd=${encodeURIComponent(text)}&cb=window.baidu.sug`
  const suggestions = await fetchJsonp({
    url,
    params: {},
    callbackParam: 'cb',
    callbackName: 'window.baidu.sug',
    parser: baiduJsonpParser,
    encoding: 'gbk', // 百度搜索建议 API 使用 GBK 编码
    signal,
  })

  if (suggestions[0] === text) {
    return suggestions.slice(1)
  }

  return suggestions
}

interface GoogleSuggest {
  [index: number]: unknown
  0: string
  1: string[]
  2: string[]
  3: unknown[]
  4: {
    'google:clientdata': {
      bpc: boolean
      tlw: boolean
    }
    'google:suggestrelevance': number[]
    'google:suggestsubtypes': number[][]
    'google:suggesttype': string[]
    'google:verbatimrelevance': number
  }
}

async function googleSuggestParser(text: string, signal?: AbortSignal): Promise<string[]> {
  const url = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(text)}`
  const resp: GoogleSuggest = await enhancedFetch(url, { signal })
  return resp[1]
}

export { baiduSuggestParser, bingSuggestParser, googleSuggestParser }
