import type { LocalSyncStateV1 } from './types.ts'

export const SYNC_RETRY_ALARM = 'webdav-sync-retry'
const RETRYABLE = new Set([
  'network',
  'timeout',
  'rate-limited',
  'server',
  'locked',
  'precondition',
])

/** 重试最多六次，30秒起退避；保留进度以便后台重启恢复。 */
export function nextSyncRetry(
  state: LocalSyncStateV1,
  now = Date.now(),
): LocalSyncStateV1['retry'] {
  if (
    !state.enabled ||
    !Object.values(state.scope).some(Boolean) ||
    !state.lastError ||
    !RETRYABLE.has(state.lastError.category)
  )
    return undefined
  const attempt = (state.retry?.attempt ?? 0) + 1
  if (attempt > 6) return { attempt, nextAttemptAt: undefined }
  return { attempt, nextAttemptAt: now + 30_000 * 2 ** (attempt - 1) }
}
