import { storage } from '#imports'
import { browser } from 'wxt/browser'

import { coordinateStorage, withSyncWriteLock } from '@/shared/storage/syncWrite'

export interface QuickLink {
  /** 同步实体 ID；旧数据会在首次读取时补齐并持久化。 */
  id?: string
  url: string
  title: string
  favicon?: string
  /** 仅显式用户选择的图标可进入 WebDAV 同步；缺失表示旧版来源不明。 */
  faviconSource?: 'automatic' | 'user-selected'
}

export interface QuickLinkGroup {
  id: string
  name: string
  items: QuickLink[]
}

export interface QuickLinksData {
  items: QuickLink[]
  groups?: QuickLinkGroup[]
}

export const DEFAULT_QUICK_LINK_GROUP_ID = 'default'
export const MAX_QUICK_LINK_GROUP_NAME_LENGTH = 24

export const defaultQuickLinksData: QuickLinksData = { items: [], groups: [] }

const rawStorage = storage.defineItem<QuickLinksData>('local:quickLinks', {
  fallback: structuredClone(defaultQuickLinksData),
})

export const quickLinksStorage = coordinateStorage(rawStorage)

export function ensureQuickLinksStableIds(data: QuickLinksData): {
  changed: boolean
  value: QuickLinksData
} {
  let changed = false
  const seenIds = new Set<string>()
  const normalizeItem = (item: QuickLink): QuickLink => {
    let id = item.id
    if (!id || seenIds.has(id)) {
      id = crypto.randomUUID()
      changed = true
    }
    seenIds.add(id)
    return item.id === id ? item : { ...item, id }
  }

  const groups = data.groups?.map((group) => ({
    ...group,
    items: group.items.map(normalizeItem),
  }))
  const items = groups?.length
    ? groups.flatMap((group) => group.items)
    : data.items.map(normalizeItem)
  const value = { items, groups: groups ?? [] }

  if (groups?.length && data.items.some((item, index) => item.id !== items[index]?.id)) {
    changed = true
  }
  return { changed, value }
}

export async function getQuickLinksStorageValue(lockHeld = false): Promise<QuickLinksData> {
  if (!lockHeld) return withSyncWriteLock(() => getQuickLinksStorageValue(true))
  const current = await storage.getItem<QuickLinksData>(quickLinksStorage.key)
  if (current !== null) {
    const normalized = ensureQuickLinksStableIds(current)
    if (normalized.changed) await quickLinksStorage.raw.setValue(normalized.value)
    return normalized.value
  }

  const legacy = await browser.storage.local.get('bookmark')
  const legacyValue = legacy.bookmark
  if (
    legacyValue &&
    typeof legacyValue === 'object' &&
    Array.isArray((legacyValue as QuickLinksData).items)
  ) {
    const migrated = ensureQuickLinksStableIds(legacyValue as QuickLinksData).value
    await quickLinksStorage.raw.setValue(migrated)
    return migrated
  }

  const empty = structuredClone(defaultQuickLinksData)
  await quickLinksStorage.raw.setValue(empty)
  return empty
}
