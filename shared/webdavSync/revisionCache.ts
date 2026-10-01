import { jsonByteLength } from './canonical.ts'
import type { SyncRevisionV1 } from './types.ts'

const MAX_BYTES = 16 * 1024 * 1024
const MAX_ITEMS = 8
const cache = new Map<string, { revision: SyncRevisionV1; bytes: number }>()
let bytes = 0

/** 仅缓存已校验、已清理的不可变工作副本；头版本及显式历史检查仍重新读取。 */
export function cachedRevision(key: string): SyncRevisionV1 | undefined {
  const item = cache.get(key)
  if (!item) return undefined
  cache.delete(key)
  cache.set(key, item)
  return structuredClone(item.revision)
}

export function cacheRevision(key: string, revision: SyncRevisionV1): void {
  const size = jsonByteLength(revision)
  if (size > MAX_BYTES) return
  const previous = cache.get(key)
  if (previous) {
    bytes -= previous.bytes
    cache.delete(key)
  }
  cache.set(key, { revision: structuredClone(revision), bytes: size })
  bytes += size
  while (cache.size > MAX_ITEMS || bytes > MAX_BYTES) {
    const first = cache.entries().next().value!
    bytes -= first[1].bytes
    cache.delete(first[0])
  }
}
