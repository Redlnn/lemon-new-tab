import { WebDavError } from './errors.ts'

function isPrivateIpv4(hostname: string): boolean {
  const values = hostname.split('.').map(Number)
  if (
    values.length !== 4 ||
    values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return false
  }
  const [a, b] = values as [number, number, number, number]
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  )
}

export function classifyWebDavAddress(value: string): {
  origin: string
  permissionOrigin: string
  transport: 'https' | 'local-http'
} {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new WebDavError('invalid-response', 'WebDAV address is invalid')
  }
  if (url.username || url.password || url.hash || url.search) {
    throw new WebDavError('invalid-response', 'WebDAV address contains unsupported URL parts')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new WebDavError('invalid-response', 'WebDAV address must use HTTP or HTTPS')
  }
  const localHttp =
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' ||
      url.hostname.endsWith('.local') ||
      isPrivateIpv4(url.hostname) ||
      isPrivateIpv6(url.hostname))
  if (url.protocol === 'http:' && !localHttp) {
    throw new WebDavError('insecure-http', 'Public HTTP WebDAV addresses are not supported')
  }
  return {
    origin: url.origin,
    permissionOrigin: `${url.protocol}//${url.hostname}/*`,
    transport: url.protocol === 'https:' ? 'https' : 'local-http',
  }
}
