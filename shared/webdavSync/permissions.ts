import { browser } from 'wxt/browser'

import { classifyWebDavAddress } from './webdav.ts'

export async function hasExactWebDavPermission(address: string): Promise<boolean> {
  const origins = [classifyWebDavAddress(address).permissionOrigin]
  return browser.permissions.contains({ origins })
}

/** 必须由用户手势直接调用；只申请当前 WebDAV 服务器的 scheme、host 和 port。 */
export async function requestExactWebDavPermission(address: string): Promise<boolean> {
  const origins = [classifyWebDavAddress(address).permissionOrigin]
  if (await browser.permissions.contains({ origins })) return true
  return browser.permissions.request({ origins })
}
