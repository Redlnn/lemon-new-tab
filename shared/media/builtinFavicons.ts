import biliFavicon from '@/entrypoints/newtab/assets/bili.svg?url&no-inline'

/** 内置站点图标优先于浏览器图标和缓存，不需要发起网络请求。 */
export function getBuiltinFavicon(pageUrl: string): string | null {
  try {
    const url = new URL(pageUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
    return hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com') ? biliFavicon : null
  } catch {
    return null
  }
}
