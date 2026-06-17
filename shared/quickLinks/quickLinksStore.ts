import { defineStore } from 'pinia'

import i18next from 'i18next'

import { acquireFaviconRef, releaseFaviconRef } from '@/shared/media'
import { useSettingsStore } from '@/shared/settings'
import { normalizeUrlForDedup } from '@/shared/url'

import {
  DEFAULT_QUICK_LINK_GROUP_ID,
  MAX_QUICK_LINK_GROUP_NAME_LENGTH,
  defaultQuickLinksData,
  type QuickLink,
  type QuickLinkGroup,
  type QuickLinksData,
  getQuickLinksStorageValue,
  quickLinksStorage,
} from './quickLinksStorage'

export type QuickLinkTarget =
  | number
  | {
      groupId: string
      index: number
    }

type QuickLinksSaveOptions = {
  groupingEnabled?: boolean
}

type MoveQuickLinkOptions = {
  fromGroupId: string
  fromIndex: number
  toGroupId: string
  toIndex: number
}

type MoveFlatQuickLinkOptions = {
  fromIndex: number
  toIndex: number
}

type InsertFlatQuickLinkOptions = {
  quickLink: QuickLink
  index: number
}

type InsertQuickLinkToGroupOptions = {
  groupId: string
  quickLink: QuickLink
  index: number
}

function normalizeQuickLinkGroupName(name: string, fallback: string): string {
  const trimmed = name.trim()
  return (trimmed || fallback).slice(0, MAX_QUICK_LINK_GROUP_NAME_LENGTH)
}

function flattenGroups(groups: QuickLinkGroup[], options?: { dedupe?: boolean }): QuickLink[] {
  if (!options?.dedupe) {
    return groups.flatMap((group) => group.items)
  }

  const seen = new Set<string>()
  const result: QuickLink[] = []
  for (const group of groups) {
    for (const item of group.items) {
      const key = normalizeUrlForDedup(item.url)
      if (seen.has(key)) continue
      seen.add(key)
      result.push(item)
    }
  }
  return result
}

export const useQuickLinksStore = defineStore('quickLinks', () => {
  const items = ref(structuredClone(defaultQuickLinksData.items))
  const groups = ref<QuickLinkGroup[]>(structuredClone(defaultQuickLinksData.groups ?? []))
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

  const getQuickLinkUrls = (nextItems: QuickLink[], nextGroups: QuickLinkGroup[]) =>
    (nextGroups.length > 0 ? nextGroups.flatMap((group) => group.items) : nextItems).map(
      (item) => item.url,
    )

  const getDefaultGroupName = () => i18next.t('newtab:quickLinks.groups.default')

  const sanitizeGroups = (nextGroups?: QuickLinkGroup[]): QuickLinkGroup[] => {
    if (!nextGroups?.length) return []

    const seenIds = new Set<string>()
    return nextGroups.map((group, index) => {
      const fallbackName =
        group.id === DEFAULT_QUICK_LINK_GROUP_ID
          ? getDefaultGroupName()
          : i18next.t('newtab:quickLinks.groups.untitled', { index: index + 1 })
      let id = group.id || crypto.randomUUID()
      while (seenIds.has(id)) {
        id = crypto.randomUUID()
      }
      seenIds.add(id)

      return {
        id,
        name: normalizeQuickLinkGroupName(group.name, fallbackName),
        items: Array.isArray(group.items) ? group.items : [],
      }
    })
  }

  const syncItemsFromGroups = (options?: { dedupe?: boolean }) => {
    items.value = flattenGroups(groups.value, options)
  }

  const ensureDefaultGroup = (): QuickLinkGroup => {
    let target = groups.value.find((group) => group.id === DEFAULT_QUICK_LINK_GROUP_ID)
    if (!target) {
      target = { id: DEFAULT_QUICK_LINK_GROUP_ID, name: getDefaultGroupName(), items: [] }
      groups.value.unshift(target)
    }
    return target
  }

  const getGroupForInsert = (groupId: string): QuickLinkGroup | undefined => {
    return groupId === DEFAULT_QUICK_LINK_GROUP_ID
      ? ensureDefaultGroup()
      : groups.value.find((item) => item.id === groupId)
  }

  const findFlatQuickLinkIndexByUrl = (url: string) => {
    const normalizedUrl = normalizeUrlForDedup(url)
    return items.value.findIndex((item) => normalizeUrlForDedup(item.url) === normalizedUrl)
  }

  const findGroupedQuickLinkByUrl = (url: string) => {
    const normalizedUrl = normalizeUrlForDedup(url)
    for (const group of groups.value) {
      const index = group.items.findIndex(
        (item) => normalizeUrlForDedup(item.url) === normalizedUrl,
      )
      if (index >= 0) return { group, index }
    }
    return null
  }

  const applyItems = (
    nextItems: QuickLinksData['items'],
    options?: { acquire?: boolean; groups?: QuickLinkGroup[] },
  ) => {
    items.value = nextItems
    groups.value = sanitizeGroups(options?.groups)
    if (options?.acquire ?? true) {
      syncFaviconRefs(getQuickLinkUrls(nextItems, groups.value))
    } else {
      syncFaviconRefs([])
    }
  }

  const init = async (options?: { acquire?: boolean }) => {
    const quickLinksData = await getQuickLinksStorageValue()
    applyItems(quickLinksData.items, { ...options, groups: quickLinksData.groups })
  }

  const replace = (data: QuickLinksData, options?: { acquire?: boolean }) => {
    applyItems(data.items, { ...options, groups: data.groups })
  }

  const deinit = () => {
    acquiredUrls.forEach((url) => releaseFaviconRef(url))
    acquiredUrls.clear()
  }

  const save = async (data?: QuickLinksData, options?: QuickLinksSaveOptions) => {
    const groupingEnabled = options?.groupingEnabled ?? useSettingsStore().quickLinks.grouping
    if (data) {
      applyItems(data.items, { groups: groupingEnabled ? data.groups : [] })
    } else {
      if (groupingEnabled && groups.value.length > 0) {
        syncItemsFromGroups()
      } else if (!groupingEnabled && groups.value.length > 0) {
        groups.value = []
      }
      syncFaviconRefs(getQuickLinkUrls(toRaw(items.value), toRaw(groups.value)))
    }
    await quickLinksStorage.setValue({
      items: toRaw(items.value),
      groups: toRaw(groups.value),
    })
  }

  const enableGroupingFromItems = async () => {
    const defaultGroup = groups.value.find((group) => group.id === DEFAULT_QUICK_LINK_GROUP_ID)
    const hasGroupedItems = groups.value.some((group) => group.items.length > 0)
    if (defaultGroup && (hasGroupedItems || items.value.length === 0)) {
      return
    }

    if (groups.value.length === 0) {
      groups.value = [
        {
          id: DEFAULT_QUICK_LINK_GROUP_ID,
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
    // called before settings.quickLinks.grouping is set to true (as in handleGroupingChange).
    syncFaviconRefs(getQuickLinkUrls(toRaw(items.value), toRaw(groups.value)))
    await quickLinksStorage.setValue({
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

  const createGroup = async (name: string): Promise<QuickLinkGroup> => {
    const group: QuickLinkGroup = {
      id: crypto.randomUUID(),
      name: normalizeQuickLinkGroupName(
        name,
        i18next.t('newtab:quickLinks.groups.untitled', { index: groups.value.length + 1 }),
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
    group.name = normalizeQuickLinkGroupName(
      name,
      group.id === DEFAULT_QUICK_LINK_GROUP_ID ? getDefaultGroupName() : group.name,
    )
    await save()
  }

  const deleteGroup = async (groupId: string) => {
    if (groupId === DEFAULT_QUICK_LINK_GROUP_ID) return
    const index = groups.value.findIndex((group) => group.id === groupId)
    if (index < 0) return
    groups.value.splice(index, 1)
    await save()
  }

  const addQuickLinkToGroup = async (
    groupId: string,
    quickLink: QuickLink,
    options?: QuickLinksSaveOptions,
  ) => {
    const group = getGroupForInsert(groupId)
    if (!group) return
    group.items.push(quickLink)
    await save(undefined, options)
  }

  const updateQuickLinkInGroup = async (groupId: string, index: number, quickLink: QuickLink) => {
    const group = groups.value.find((item) => item.id === groupId)
    if (!group?.items[index]) return
    group.items.splice(index, 1, quickLink)
    await save()
  }

  const removeQuickLinkFromGroup = async (
    groupId: string,
    index: number,
  ): Promise<QuickLink | null> => {
    const group = groups.value.find((item) => item.id === groupId)
    if (!group?.items[index]) return null
    const [removed] = group.items.splice(index, 1)
    await save()
    return removed ?? null
  }

  const moveQuickLinkToGroup = async (fromGroupId: string, index: number, toGroupId: string) => {
    const fromGroup = groups.value.find((item) => item.id === fromGroupId)
    const toGroup = getGroupForInsert(toGroupId)
    if (!fromGroup?.items[index] || !toGroup) return
    const [quickLink] = fromGroup.items.splice(index, 1)
    if (!quickLink) return
    toGroup.items.push(quickLink)
    await save()
  }

  const moveQuickLink = async ({
    fromGroupId,
    fromIndex,
    toGroupId,
    toIndex,
  }: MoveQuickLinkOptions) => {
    const fromGroup = groups.value.find((item) => item.id === fromGroupId)
    const toGroup = getGroupForInsert(toGroupId)
    if (!fromGroup?.items[fromIndex] || !toGroup) return false

    if (fromGroup.id === toGroup.id) {
      if (fromIndex === toIndex) return false
      const nextItems = fromGroup.items.slice()
      const [quickLink] = nextItems.splice(fromIndex, 1)
      if (!quickLink) return false
      nextItems.splice(Math.max(0, Math.min(toIndex, nextItems.length)), 0, quickLink)
      fromGroup.items = nextItems
      await save()
      return true
    }

    const [quickLink] = fromGroup.items.splice(fromIndex, 1)
    if (!quickLink) return false
    toGroup.items.splice(Math.max(0, Math.min(toIndex, toGroup.items.length)), 0, quickLink)
    await save()
    return true
  }

  const moveFlatQuickLink = async ({ fromIndex, toIndex }: MoveFlatQuickLinkOptions) => {
    if (fromIndex === toIndex) return false
    const nextItems = items.value.slice()
    const [quickLink] = nextItems.splice(fromIndex, 1)
    if (!quickLink) return false
    nextItems.splice(Math.max(0, Math.min(toIndex, nextItems.length)), 0, quickLink)
    items.value = nextItems
    await save()
    return true
  }

  const insertFlatQuickLink = async ({ quickLink, index }: InsertFlatQuickLinkOptions) => {
    const duplicateIndex = findFlatQuickLinkIndexByUrl(quickLink.url)
    const insertIndex = Math.max(0, Math.min(index, items.value.length))

    if (duplicateIndex >= 0) {
      const toIndex = duplicateIndex < insertIndex ? insertIndex - 1 : insertIndex
      return moveFlatQuickLink({ fromIndex: duplicateIndex, toIndex })
    }

    const nextItems = items.value.slice()
    nextItems.splice(insertIndex, 0, quickLink)
    items.value = nextItems
    await save()
    return true
  }

  const insertQuickLinkToGroup = async ({
    groupId,
    quickLink,
    index,
  }: InsertQuickLinkToGroupOptions) => {
    const toGroup = getGroupForInsert(groupId)
    if (!toGroup) return false

    const insertIndex = Math.max(0, Math.min(index, toGroup.items.length))
    const duplicate = findGroupedQuickLinkByUrl(quickLink.url)

    if (duplicate) {
      const toIndex =
        duplicate.group.id === toGroup.id && duplicate.index < insertIndex
          ? insertIndex - 1
          : insertIndex
      return moveQuickLink({
        fromGroupId: duplicate.group.id,
        fromIndex: duplicate.index,
        toGroupId: toGroup.id,
        toIndex,
      })
    }

    toGroup.items.splice(insertIndex, 0, quickLink)
    await save()
    return true
  }

  const reorderGroups = async (visibleOrderedGroups: QuickLinkGroup[]) => {
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
      .filter((g): g is QuickLinkGroup => Boolean(g))
    const hiddenDefault = rawCurrentGroups.find(
      (g) => g.id === DEFAULT_QUICK_LINK_GROUP_ID && !orderedIds.has(g.id),
    )
    const hiddenOther = rawCurrentGroups.filter(
      (g) => !orderedIds.has(g.id) && g.id !== DEFAULT_QUICK_LINK_GROUP_ID,
    )
    groups.value = [...(hiddenDefault ? [hiddenDefault] : []), ...nextGroups, ...hiddenOther]
    await save()
    return true
  }

  const getQuickLink = (target: QuickLinkTarget): QuickLink | undefined => {
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
    addQuickLinkToGroup,
    updateQuickLinkInGroup,
    removeQuickLinkFromGroup,
    moveQuickLinkToGroup,
    moveQuickLink,
    moveFlatQuickLink,
    insertQuickLinkToGroup,
    insertFlatQuickLink,
    getQuickLink,
  }
})
