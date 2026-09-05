export type SyncTrigger = 'data-change' | 'manual' | 'natural' | 'online' | 'startup'

export interface SyncCoordinatorPort {
  isConfigured(trigger: SyncTrigger): Promise<boolean>
  synchronize(trigger: SyncTrigger): Promise<void>
}

export class SyncCoordinator {
  private active: Promise<void> | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | undefined
  private queuedTrigger: SyncTrigger | undefined
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
    if (!this.active) {
      this.active = this.drain().finally(() => {
        this.active = null
      })
    }
    return this.active
  }

  dispose(): void {
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer)
    this.debounceTimer = undefined
  }

  private async drain(): Promise<void> {
    while (this.queuedTrigger) {
      const trigger = this.queuedTrigger
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
