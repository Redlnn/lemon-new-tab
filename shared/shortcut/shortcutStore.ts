import { defineStore } from 'pinia'

import i18next from 'i18next'

import { acquireFaviconRef, releaseFaviconRef } from '@/shared/media'
import { useSettingsStore } from '@/shared/settings'

import {
  DEFAULT_SHORTCUT_GROUP_ID,
  MAX_SHORTCUT_GROUP_NAME_LENGTH,
  defaultShortcuts,
  type Shortcut,
  type ShortcutGroup,
  type Shortcuts,
  shortcutStorage,
} from './shortcutStorage'

export type ShortcutTarget =
  | number
  | {
      groupId: string
      index: number
    }

type ShortcutSaveOptions = {
  groupingEnabled?: boolean
}

export function normalizeShortcutGroupName(name: string, fallback: string): string {
  const trimmed = name.trim()
  return (trimmed || fallback).slice(0, MAX_SHORTCUT_GROUP_NAME_LENGTH)
}

export function normalizeShortcutUrlForDedup(url: string): string {
  let normalized = url.trim().toLowerCase()
  normalized = normalized.replace(/^https?:\/\//, '')
  normalized = normalized.replace(/^www\./, '')
  normalized = normalized.replace(/\/+$/, '')
  return normalized
}

function flattenGroups(groups: ShortcutGroup[], options?: { dedupe?: boolean }): Shortcut[] {
  if (!options?.dedupe) {
    return groups.flatMap((group) => group.items)
  }

  const seen = new Set<string>()
  const result: Shortcut[] = []
  for (const group of groups) {
    for (const item of group.items) {
      const key = normalizeShortcutUrlForDedup(item.url)
      if (seen.has(key)) continue
      seen.add(key)
      result.push(item)
    }
  }
  return result
}

export const useShortcutStore = defineStore('shortcut', () => {
  const items = ref(structuredClone(defaultShortcuts.items))
  const groups = ref<ShortcutGroup[]>(structuredClone(defaultShortcuts.groups ?? []))
  const acquiredUrls = new Set<string>()

  const syncFaviconRefs = (nextUrls: string[]) => {
    const nextUrlSet = new Set(nextUrls)

    acquiredUrls.forEach((url) => {
      if (!nextUrlSet.has(url)) {
        releaseFaviconRef(url)
        acquiredUrls.delete(url)
      }
    })

    nextUrlSet.forEach((url) => {
      if (!acquiredUrls.has(url)) {
        acquireFaviconRef(url)
        acquiredUrls.add(url)
      }
    })
  }

  const getShortcutUrls = (nextItems: Shortcut[], nextGroups: ShortcutGroup[]) =>
    (nextGroups.length > 0 ? nextGroups.flatMap((group) => group.items) : nextItems).map(
      (item) => item.url,
    )

  const getDefaultGroupName = () => i18next.t('newtab:shortcut.groups.default')

  const sanitizeGroups = (nextGroups?: ShortcutGroup[]): ShortcutGroup[] => {
    if (!nextGroups?.length) return []

    const seenIds = new Set<string>()
    return nextGroups.map((group, index) => {
      const fallbackName =
        group.id === DEFAULT_SHORTCUT_GROUP_ID
          ? getDefaultGroupName()
          : i18next.t('newtab:shortcut.groups.untitled', { index: index + 1 })
      let id = group.id || crypto.randomUUID()
      while (seenIds.has(id)) {
        id = crypto.randomUUID()
      }
      seenIds.add(id)

      return {
        id,
        name: normalizeShortcutGroupName(group.name, fallbackName),
        items: Array.isArray(group.items) ? group.items : [],
      }
    })
  }

  const syncItemsFromGroups = (options?: { dedupe?: boolean }) => {
    items.value = flattenGroups(groups.value, options)
  }

  const ensureDefaultGroup = (): ShortcutGroup => {
    let target = groups.value.find((group) => group.id === DEFAULT_SHORTCUT_GROUP_ID)
    if (!target) {
      target = { id: DEFAULT_SHORTCUT_GROUP_ID, name: getDefaultGroupName(), items: [] }
      groups.value.unshift(target)
    }
    return target
  }

  const applyItems = (
    nextItems: Shortcuts['items'],
    options?: { acquire?: boolean; groups?: ShortcutGroup[] },
  ) => {
    items.value = nextItems
    groups.value = sanitizeGroups(options?.groups)
    if (options?.acquire ?? true) {
      syncFaviconRefs(getShortcutUrls(nextItems, groups.value))
    } else {
      syncFaviconRefs([])
    }
  }

  const init = async (options?: { acquire?: boolean }) => {
    const shortcut = await shortcutStorage.getValue()
    applyItems(shortcut.items, { ...options, groups: shortcut.groups })
  }

  const replace = (data: Shortcuts, options?: { acquire?: boolean }) => {
    applyItems(data.items, { ...options, groups: data.groups })
  }

  const deinit = () => {
    acquiredUrls.forEach((url) => releaseFaviconRef(url))
    acquiredUrls.clear()
  }

  const save = async (data?: Shortcuts, options?: ShortcutSaveOptions) => {
    const groupingEnabled = options?.groupingEnabled ?? useSettingsStore().shortcut.grouping
    if (data) {
      applyItems(data.items, { groups: groupingEnabled ? data.groups : [] })
    } else {
      if (groupingEnabled && groups.value.length > 0) {
        syncItemsFromGroups()
      } else if (!groupingEnabled && groups.value.length > 0) {
        groups.value = []
      }
      syncFaviconRefs(getShortcutUrls(toRaw(items.value), toRaw(groups.value)))
    }
    await shortcutStorage.setValue({
      items: toRaw(items.value),
      groups: toRaw(groups.value),
    })
  }

  const enableGroupingFromItems = async () => {
    const defaultGroup = groups.value.find((group) => group.id === DEFAULT_SHORTCUT_GROUP_ID)
    const hasGroupedItems = groups.value.some((group) => group.items.length > 0)
    if (defaultGroup && (hasGroupedItems || items.value.length === 0)) {
      return
    }

    if (groups.value.length === 0) {
      groups.value = [
        {
          id: DEFAULT_SHORTCUT_GROUP_ID,
          name: getDefaultGroupName(),
          items: structuredClone(toRaw(items.value)),
        },
      ]
    } else if (defaultGroup) {
      defaultGroup.items = structuredClone(toRaw(items.value))
    } else {
      const group = ensureDefaultGroup()
      if (!hasGroupedItems) group.items = structuredClone(toRaw(items.value))
    }
    syncItemsFromGroups()
    // Save directly to bypass save()'s groupingEnabled check, which would clear groups if
    // called before settings.shortcut.grouping is set to true (as in handleGroupingChange).
    syncFaviconRefs(getShortcutUrls(toRaw(items.value), toRaw(groups.value)))
    await shortcutStorage.setValue({
      items: toRaw(items.value),
      groups: toRaw(groups.value),
    })
  }

  const disableGroupingToItems = async () => {
    if (groups.value.length === 0) return

    items.value = flattenGroups(groups.value, { dedupe: true })
    groups.value = []
    await save()
  }

  const createGroup = async (name: string): Promise<ShortcutGroup> => {
    const group: ShortcutGroup = {
      id: crypto.randomUUID(),
      name: normalizeShortcutGroupName(
        name,
        i18next.t('newtab:shortcut.groups.untitled', { index: groups.value.length + 1 }),
      ),
      items: [],
    }
    groups.value.push(group)
    await save()
    return group
  }

  const renameGroup = async (groupId: string, name: string) => {
    const group = groups.value.find((item) => item.id === groupId)
    if (!group) return
    group.name = normalizeShortcutGroupName(
      name,
      group.id === DEFAULT_SHORTCUT_GROUP_ID ? getDefaultGroupName() : group.name,
    )
    await save()
  }

  const deleteGroup = async (groupId: string) => {
    if (groupId === DEFAULT_SHORTCUT_GROUP_ID) return
    const index = groups.value.findIndex((group) => group.id === groupId)
    if (index < 0) return
    groups.value.splice(index, 1)
    await save()
  }

  const addShortcutToGroup = async (
    groupId: string,
    shortcut: Shortcut,
    options?: ShortcutSaveOptions,
  ) => {
    const group =
      groupId === DEFAULT_SHORTCUT_GROUP_ID
        ? ensureDefaultGroup()
        : groups.value.find((item) => item.id === groupId)
    if (!group) return
    group.items.push(shortcut)
    await save(undefined, options)
  }

  const updateShortcutInGroup = async (groupId: string, index: number, shortcut: Shortcut) => {
    const group = groups.value.find((item) => item.id === groupId)
    if (!group?.items[index]) return
    group.items.splice(index, 1, shortcut)
    await save()
  }

  const removeShortcutFromGroup = async (
    groupId: string,
    index: number,
  ): Promise<Shortcut | null> => {
    const group = groups.value.find((item) => item.id === groupId)
    if (!group?.items[index]) return null
    const [removed] = group.items.splice(index, 1)
    await save()
    return removed ?? null
  }

  const moveShortcutToGroup = async (fromGroupId: string, index: number, toGroupId: string) => {
    const fromGroup = groups.value.find((item) => item.id === fromGroupId)
    const toGroup =
      toGroupId === DEFAULT_SHORTCUT_GROUP_ID
        ? ensureDefaultGroup()
        : groups.value.find((item) => item.id === toGroupId)
    if (!fromGroup?.items[index] || !toGroup) return
    const [shortcut] = fromGroup.items.splice(index, 1)
    if (!shortcut) return
    toGroup.items.push(shortcut)
    await save()
  }

  const reorderGroups = async (visibleOrderedGroups: ShortcutGroup[]) => {
    const rawCurrentGroups = toRaw(groups.value).map((g) => toRaw(g))
    const orderedIds = new Set(visibleOrderedGroups.map((g) => g.id))
    const currentVisibleIds = rawCurrentGroups.filter((g) => orderedIds.has(g.id)).map((g) => g.id)
    const nextVisibleIds = visibleOrderedGroups.map((g) => g.id)

    if (
      currentVisibleIds.length === nextVisibleIds.length &&
      currentVisibleIds.every((id, index) => id === nextVisibleIds[index])
    ) {
      return false
    }

    const idToGroup = new Map(rawCurrentGroups.map((g) => [g.id, g]))
    const nextGroups = visibleOrderedGroups
      .map((g) => idToGroup.get(g.id))
      .filter((g): g is ShortcutGroup => Boolean(g))
    const hiddenDefault = rawCurrentGroups.find(
      (g) => g.id === DEFAULT_SHORTCUT_GROUP_ID && !orderedIds.has(g.id),
    )
    const hiddenOther = rawCurrentGroups.filter(
      (g) => !orderedIds.has(g.id) && g.id !== DEFAULT_SHORTCUT_GROUP_ID,
    )
    groups.value = [...(hiddenDefault ? [hiddenDefault] : []), ...nextGroups, ...hiddenOther]
    await save()
    return true
  }

  const setGroupItems = async (groupId: string, nextItems: Shortcut[]) => {
    const group = groups.value.find((item) => item.id === groupId)
    if (!group) return
    group.items = nextItems
    await save()
  }

  const getShortcut = (target: ShortcutTarget): Shortcut | undefined => {
    if (typeof target === 'number') {
      return items.value[target]
    }
    return groups.value.find((group) => group.id === target.groupId)?.items[target.index]
  }

  return {
    items,
    groups,
    init,
    replace,
    deinit,
    save,
    enableGroupingFromItems,
    disableGroupingToItems,
    ensureDefaultGroup,
    createGroup,
    renameGroup,
    deleteGroup,
    reorderGroups,
    addShortcutToGroup,
    updateShortcutInGroup,
    removeShortcutFromGroup,
    moveShortcutToGroup,
    setGroupItems,
    getShortcut,
  }
})
