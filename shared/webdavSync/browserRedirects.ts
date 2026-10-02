import { browser } from 'wxt/browser'

import { hasExactWebDavPermission } from './permissions.ts'
import { WebDavError, type WebDavRequestObserver } from './webdav.ts'

/** 每个客户端操作只检查一次权限；下次操作重新读取，支持权限收回与重新授权。 */
export function createBrowserWebDavRequestObserver(address: string): WebDavRequestObserver {
  let permission: Promise<boolean> | undefined
  return async (url, method, request) => {
    permission ??= hasExactWebDavPermission(address)
    if (!(await permission))
      throw new WebDavError('permission-required', 'WebDAV permission is required')
    return observeBrowserWebDavRequest(url, method, request)
  }
}

/** 仅在单次 WebDAV 请求期间读取浏览器已拦截的跳转目标。 */
export const observeBrowserWebDavRequest: WebDavRequestObserver = async (url, method, request) => {
  let redirectUrl: string | undefined
  const listener = (details: { method: string; redirectUrl: string; url: string }) => {
    if (details.url === url.href && details.method === method) redirectUrl = details.redirectUrl
  }
  browser.webRequest.onBeforeRedirect.addListener(listener, {
    urls: [`${url.protocol}//${url.hostname}/*`],
  })
  try {
    return { response: await request(), redirectUrl }
  } finally {
    browser.webRequest.onBeforeRedirect.removeListener(listener)
  }
}
