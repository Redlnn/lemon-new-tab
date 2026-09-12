export type NavigableUrl = {
  text: string
  url: string
}

const domainLabelPattern = /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i

function isStrictIpv4(hostname: string) {
  const segments = hostname.split('.')
  return (
    segments.length === 4 &&
    segments.every(
      (segment) => /^\d+$/.test(segment) && Number(segment) >= 0 && Number(segment) <= 255,
    )
  )
}

function isDomain(hostname: string) {
  return (
    hostname.length <= 253 &&
    hostname.includes('.') &&
    hostname.split('.').every((label) => domainLabelPattern.test(label))
  )
}

function rawHostname(input: string) {
  const authority = input.replace(/^https?:\/\//i, '').split(/[/?#]/, 1)[0] ?? ''
  const withoutCredentials = authority.slice(authority.lastIndexOf('@') + 1)
  if (withoutCredentials.startsWith('[')) {
    return withoutCredentials.slice(0, withoutCredentials.indexOf(']') + 1)
  }
  return withoutCredentials.split(':', 1)[0] ?? ''
}

/** 将明确形似 HTTP(S) 地址的输入规范化，避免把普通搜索词误判为网址。 */
export function parseNavigableUrl(input: string): NavigableUrl | null {
  const text = input.trim()
  if (!text || /\s/.test(text)) return null

  const candidate = /^https?:\/\//i.test(text) ? text : `https://${text}`
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return null
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return null

  const hostname = parsed.hostname.toLowerCase()
  const inputHostname = rawHostname(candidate).toLowerCase()
  const isIpv6 = hostname.startsWith('[') && hostname.endsWith(']')
  const isLocal = hostname === 'localhost' || hostname.endsWith('.local')
  const looksLikeIpv4 = /^\d+(?:\.\d+)*$/.test(inputHostname)
  const isIpv4 = looksLikeIpv4 && isStrictIpv4(inputHostname)

  if (looksLikeIpv4 && !isIpv4) return null
  if (!isLocal && !isIpv6 && !isIpv4 && !isDomain(hostname)) return null
  return { text, url: parsed.href }
}
