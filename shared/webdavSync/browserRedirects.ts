import { browser } from 'wxt/browser'

import type { WebDavRequestObserver } from './webdav.ts'

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
