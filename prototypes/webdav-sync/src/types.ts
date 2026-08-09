export type PrototypeStatus =
  | 'unconfigured'
  | 'synced'
  | 'pending'
  | 'conflict'
  | 'permission'
  | 'wallpaper'
  | 'storage-full'
  | 'corrupted'
  | 'format-newer'
  | 'encrypted-locked'

export type DialogName =
  | 'setup'
  | 'status'
  | 'conflicts'
  | 'history'
  | 'devices'
  | 'encryption'
  | 'disconnect'
  | 'compression'
  | 'availability'
  | null

export interface PrototypeConflict {
  id: string
  category: string
  label: string
  local: string
  remote: string
  base: string
  localDevice: string
  remoteDevice: string
  modifiedAt: string
  canKeepBoth: boolean
}

export interface PrototypeRevision {
  id: string
  time: string
  device: string
  reason: string
  summary: string
  integrity: 'complete' | 'corrupted'
  wallpaperAvailable: boolean
}

export interface PrototypeDevice {
  id: string
  name: string
  firstSeen: string
  lastSeen: string
  status: 'active' | 'stale'
}

export interface PrototypeScenario {
  id: string
  label: string
  status: PrototypeStatus
  statusLabel: string
  summary: string
  detail: string
  lastSuccess?: string
  pendingChanges?: number
  conflictCount?: number
  encrypted: boolean
  remoteHasData: boolean
  coreSize: string
  wallpaper: {
    count: number
    totalSize: string
    lightSize?: string
    darkSize?: string
    tooLarge?: boolean
  }
  conflicts: PrototypeConflict[]
  history: PrototypeRevision[]
  devices: PrototypeDevice[]
}

export interface SyncScopeDraft {
  searchHistory: boolean
  blockedTopSites: boolean
  wallpapers: boolean
  onlineWallpaperUrl: boolean
  quickLinkIcons: boolean
}

export interface SyncPrototypeAdapter {
  listScenarios(): readonly PrototypeScenario[]
  getScenario(id: string): PrototypeScenario
  syncNow(id: string): Promise<{ message: string }>
  testConnection(): Promise<{ server: string; secure: boolean }>
  resolveConflicts(resolutions: Record<string, string>): Promise<{ message: string }>
}
