import { createFaviconUrlResolver } from '@/shared/media'

interface CustomEngine {
  id: string
  url: string
  icon?: string
}

/**
 * 返回用于解析自定义搜索引擎 favicon 的稳定组合函数。
 * 每个组件调用一次；返回的 `getCustomEngineFavicon` 函数可安全用于模板中。
 */
export function useCustomEngineFavicon() {
  const resolveFaviconUrl = createFaviconUrlResolver()

  const getCustomEngineFavicon = (engine: CustomEngine): string => {
    if (engine.icon) return engine.icon

    return resolveFaviconUrl(engine.url, `${engine.id}:${engine.url}`)
  }

  return { getCustomEngineFavicon }
}
