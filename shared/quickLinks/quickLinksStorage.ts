import { storage } from '#imports'
import { browser } from 'wxt/browser'

export interface QuickLink {
  url: string
  title: string
  favicon?: string
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

export const quickLinksStorage = storage.defineItem<QuickLinksData>('local:quickLinks', {
  fallback: structuredClone(defaultQuickLinksData),
})

export async function getQuickLinksStorageValue(): Promise<QuickLinksData> {
  const current = await storage.getItem<QuickLinksData>(quickLinksStorage.key)
  if (current !== null) return current

  const legacy = await browser.storage.local.get('bookmark')
  const legacyValue = legacy.bookmark
  if (
    legacyValue &&
    typeof legacyValue === 'object' &&
    Array.isArray((legacyValue as QuickLinksData).items)
  ) {
    const migrated = legacyValue as QuickLinksData
    await quickLinksStorage.setValue(migrated)
    return migrated
  }

  const empty = structuredClone(defaultQuickLinksData)
  await quickLinksStorage.setValue(empty)
  return empty
}
