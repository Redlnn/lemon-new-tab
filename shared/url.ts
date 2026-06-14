export function normalizeUrlForDedup(url: string): string {
  let normalized = url.trim().toLowerCase()
  normalized = normalized.replace(/^https?:\/\//, '')
  normalized = normalized.replace(/^www\./, '')
  normalized = normalized.replace(/\/+$/, '')
  return normalized
}
