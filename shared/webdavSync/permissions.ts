import { browser } from 'wxt/browser'

import { classifyWebDavAddress } from './webdav.ts'

function requiredWebDavOrigins(address: string): string[] {
  const assessment = classifyWebDavAddress(address)
  if (assessment.transport === 'https') return [assessment.permissionOrigin]
  const secure = new URL(address)
  secure.protocol = 'https:'
  return [assessment.permissionOrigin, `${secure.protocol}//${secure.hostname}/*`]
}

export async function hasExactWebDavPermission(address: string): Promise<boolean> {
  return browser.permissions.contains({
    permissions: ['webRequest'],
    origins: requiredWebDavOrigins(address),
  })
}

/** 必须由用户手势直接调用；只申请安全跳转检测和当前 WebDAV 服务器。 */
export async function requestExactWebDavPermission(address: string): Promise<boolean> {
  const permission = {
    permissions: ['webRequest'] as ['webRequest'],
    origins: requiredWebDavOrigins(address),
  }
  if (await browser.permissions.contains(permission)) return true
  return await browser.permissions.request(permission)
}
