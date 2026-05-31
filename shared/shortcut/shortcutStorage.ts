import { storage } from '#imports'

export interface Shortcut {
  url: string
  title: string
  favicon?: string
}

export interface ShortcutGroup {
  id: string
  name: string
  items: Shortcut[]
}

export interface Shortcuts {
  items: Shortcut[]
  groups?: ShortcutGroup[]
}

export const DEFAULT_SHORTCUT_GROUP_ID = 'default'
export const MAX_SHORTCUT_GROUP_NAME_LENGTH = 24

export const defaultShortcuts: Shortcuts = { items: [], groups: [] }

export const shortcutStorage = storage.defineItem<Shortcuts>('local:bookmark', {
  fallback: structuredClone(defaultShortcuts),
})
