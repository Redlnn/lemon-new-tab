import { jsonEquals } from '../webdavSync/canonical.ts'

import { rebaseLocalChanges } from './localChanges.ts'

export function withSyncWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  return navigator.locks.request('lemon-sync-data', operation)
}

interface ValueStorage<T> {
  getValue(): Promise<T>
  setValue(value: T): Promise<void>
}

/** raw 仅供已持有写入锁的事务调用，避免递归获取 Web Lock。 */
export function coordinateStorage<S extends ValueStorage<unknown>>(raw: S) {
  type T = Awaited<ReturnType<S['getValue']>>
  const valueStorage = raw as ValueStorage<T>
  return {
    ...raw,
    raw,
    setValue(value: T) {
      const snapshot = structuredClone(value)
      return withSyncWriteLock(() => raw.setValue(snapshot))
    },
    updateValue(update: (current: T) => T) {
      return withSyncWriteLock(async () => {
        const next = update(await valueStorage.getValue())
        await raw.setValue(next)
        return next
      })
    },
  }
}

/** 页面草稿与存储分离：通知和保存完成都不能抹掉下一次编辑。 */
export function createDraftWriter<T>(
  storage: ValueStorage<T>,
  readDraft: () => T,
  applyDraft: (value: T) => void,
  initial: T,
  rebase = rebaseLocalChanges<T>,
) {
  let base = structuredClone(initial)
  let pending = 0
  let receivedVersion = 0
  let received: T
  let failed: { before: T; next: T } | undefined
  const echoes = new Set<string>()
  const receive = (value: T) => {
    const hash = JSON.stringify(value)
    if (echoes.delete(hash)) return
    received = value
    receivedVersion++
    if (pending) return
    const draft = rebase(base, readDraft(), value)
    base = structuredClone(value)
    applyDraft(draft)
  }
  return {
    receive,
    reset(value: T) {
      base = structuredClone(value)
      applyDraft(structuredClone(value))
    },
    async save(value = readDraft()) {
      const before = base
      const next = structuredClone(value)
      base = next
      pending++
      try {
        await withSyncWriteLock(async () => {
          const changes = failed
            ? {
                before: failed.before,
                next: rebase(before, next, failed.next),
              }
            : { before, next }
          let hash: string | undefined
          try {
            const current = await storage.getValue()
            const merged = rebase(changes.before, changes.next, current)
            if (jsonEquals(current, merged)) {
              failed = undefined
              return
            }
            hash = JSON.stringify(merged)
            echoes.add(hash)
            // 通知可能先于 setValue 返回，也可能延后到下一次保存。
            if (echoes.size > 32) echoes.delete(echoes.values().next().value!)
            await storage.setValue(merged)
            failed = undefined
          } catch (error) {
            if (hash) echoes.delete(hash)
            failed = changes
            throw error
          }
        })
        if (pending === 1) {
          const version = receivedVersion
          const latest = await storage.getValue()
          if (pending === 1) {
            const saved = version === receivedVersion ? latest : received
            const draft = rebase(base, readDraft(), saved)
            base = structuredClone(saved)
            applyDraft(draft)
          }
        }
      } catch (error) {
        if (pending === 1) base = before
        throw error
      } finally {
        pending--
      }
    },
  }
}
