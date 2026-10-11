export type SyncTrigger = 'data-change' | 'manual' | 'natural' | 'online' | 'startup'

export interface SyncCoordinatorPort {
  isConfigured(trigger: SyncTrigger): Promise<boolean>
  synchronize(trigger: SyncTrigger): Promise<void>
}

export class SyncCoordinator {
  private active: Promise<void> | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | undefined
  private queuedTrigger: SyncTrigger | undefined
  private readonly exclusiveTasks: Array<() => Promise<void>> = []
  private readonly port: SyncCoordinatorPort
  private readonly debounceMs: number

  constructor(port: SyncCoordinatorPort, debounceMs = 5000) {
    this.port = port
    this.debounceMs = debounceMs
  }

  dataChanged(): void {
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined
      void this.trigger('data-change')
    }, this.debounceMs)
  }

  trigger(trigger: SyncTrigger): Promise<void> {
    this.queuedTrigger = preferTrigger(this.queuedTrigger, trigger)
    return this.start()
  }

  runExclusive<T>(task: () => Promise<T>, synchronizeAfter = true): Promise<T> {
    const result = new Promise<T>((resolve, reject) => {
      this.exclusiveTasks.push(async () => {
        try {
          resolve(await task())
        } catch (error) {
          reject(error)
        } finally {
          if (synchronizeAfter) this.queuedTrigger = preferTrigger(this.queuedTrigger, 'natural')
        }
      })
    })
    // 独占任务的错误由 result 返回；同步任务仍通过 trigger 返回并自行记录状态。
    void this.start().catch(() => undefined)
    return result
  }

  private start(): Promise<void> {
    if (!this.active) {
      this.active = this.drain().finally(() => {
        this.active = null
        if (this.exclusiveTasks.length || this.queuedTrigger)
          void this.start().catch(() => undefined)
      })
    }
    return this.active
  }

  dispose(): void {
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer)
    this.debounceTimer = undefined
  }

  private async drain(): Promise<void> {
    while (this.exclusiveTasks.length || this.queuedTrigger) {
      const task = this.exclusiveTasks.shift()
      if (task) {
        await task()
        continue
      }
      const trigger = this.queuedTrigger
      if (!trigger) continue
      this.queuedTrigger = undefined
      if (await this.port.isConfigured(trigger)) await this.port.synchronize(trigger)
    }
  }
}

function preferTrigger(current: SyncTrigger | undefined, next: SyncTrigger): SyncTrigger {
  if (current === 'manual' || next === 'manual') return 'manual'
  if (current === 'data-change' || next === 'data-change') return 'data-change'
  return next
}
