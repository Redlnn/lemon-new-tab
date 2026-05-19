import enhancedFetch from '@/shared/network/fetch'

const JINRISHICI_TOKEN_KEY = 'jinrishici-token'
const JINRISHICI_API = 'https://v2.jinrishici.com/one.json'

interface JinrishiciResponse {
  status: string
  data: {
    content: string
    origin: {
      title: string
    }
  }
  token: string
}

interface Hitokoto {
  id: number // 一言标识
  hitokoto: string // 一言正文
  type: string // 类型
  from: string // 一言的出处
  from_who: string | null // 一言的作者
  creator: string // 添加者
  creator_uid: number // 添加者用户标识
  reviewer: number // 审核员标识
  uuid: string // 一言唯一标识
  commit_from: string // 提交方式
  created_at: string // 添加时间
  length: number // 句子长度
}

export type YiyanResult = {
  yiyan?: string
  yiyanOrigin?: string
}

export type YiyanProviderKey = keyof typeof yiyanProviders | 'custom'
export const yiyanProviders = {
  jinrishici: {
    nameKey: 'settings:yiyan.providers.jinrishici.name',
    note: undefined,
    website: 'https://www.jinrishici.com',
    load: async (): Promise<YiyanResult> => {
      try {
        const token = localStorage.getItem(JINRISHICI_TOKEN_KEY)
        const url = token
          ? `${JINRISHICI_API}?X-User-Token=${encodeURIComponent(token)}`
          : JINRISHICI_API
        const resp = await fetch(url)
        if (!resp.ok) return { yiyan: undefined, yiyanOrigin: undefined }
        const data: JinrishiciResponse = await resp.json()
        if (data.status !== 'success') return { yiyan: undefined, yiyanOrigin: undefined }
        if (data.token) localStorage.setItem(JINRISHICI_TOKEN_KEY, data.token)
        return {
          yiyan: data.data.content,
          yiyanOrigin: data.data.origin.title,
        }
      } catch {
        return { yiyan: undefined, yiyanOrigin: undefined }
      }
    },
  },
  hitokoto: {
    nameKey: 'settings:yiyan.providers.hitokoto.name',
    note: 'settings:yiyan.providers.hitokoto.note',
    website: 'https://hitokoto.cn',
    load: async (): Promise<YiyanResult> => {
      try {
        const { hitokoto, from } = await enhancedFetch<Hitokoto>('https://v1.hitokoto.cn')
        return { yiyan: hitokoto, yiyanOrigin: from }
      } catch (error) {
        console.error('Error fetching hitokoto:', error)
        return { yiyan: undefined, yiyanOrigin: undefined }
      }
    },
  },
} as const

export function isProviderKey(key: YiyanProviderKey): key is keyof typeof yiyanProviders {
  return key in yiyanProviders
}
