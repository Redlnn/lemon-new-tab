import { defineStore } from 'pinia'

import i18next from 'i18next'

import { useSettingsStore } from '@/shared/settings'
import { normalizeUrlForDedup } from '@/shared/url'

import { flattenQuickLinkGroups, moveQuickLinkArrayItem } from './quickLinkAlgorithms'
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

function hasQuickLinksData(data: QuickLinksData): boolean {
  return data.items.length > 0 || (data.groups?.length ?? 0) > 0
}

export const useQuickLinksStore = defineStore('quickLinks', () => {
  const settings = useSettingsStore()
  const flatItems = ref(structuredClone(defaultQuickLinksData.items))
  const groupState = ref<QuickLinkGroup[]>(structuredClone(defaultQuickLinksData.groups ?? []))
  const loaded = ref(false)
  let initTask: Promise<void> | null = null
  const localSaveHashes: string[] = []

  const items = computed<readonly QuickLink[]>(() =>
    groupState.value.length > 0 ? flattenQuickLinkGroups(groupState.value) : flatItems.value,
  )
  const groups = computed<readonly QuickLinkGroup[]>(() => groupState.value)

  const getDefaultGroupName = () => i18next.t('newtab:quickLinks.groups.default')

  const getGroup = (groupId: string) => groupState.value.find((group) => group.id === groupId)

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

  const ensureDefaultGroup = (): QuickLinkGroup => {
    let target = getGroup(DEFAULT_QUICK_LINK_GROUP_ID)
    if (!target) {
      target = { id: DEFAULT_QUICK_LINK_GROUP_ID, name: getDefaultGroupName(), items: [] }
      groupState.value.unshift(target)
    }
    return target
  }

  const getGroupForInsert = (groupId: string): QuickLinkGroup | undefined => {
    return groupId === DEFAULT_QUICK_LINK_GROUP_ID ? ensureDefaultGroup() : getGroup(groupId)
  }

  const getDefaultGroupItems = () => getGroup(DEFAULT_QUICK_LINK_GROUP_ID)?.items ?? []

  const getGroupItemCount = (groupId: string) => {
    if (groupId === DEFAULT_QUICK_LINK_GROUP_ID) {
      return getDefaultGroupItems().length
    }
    return getGroup(groupId)?.items.length ?? 0
  }

  const findFlatQuickLinkIndexByUrl = (url: string) => {
    const normalizedUrl = normalizeUrlForDedup(url)
    return flatItems.value.findIndex((item) => normalizeUrlForDedup(item.url) === normalizedUrl)
  }

  const findGroupedQuickLinkByUrl = (url: string) => {
    const normalizedUrl = normalizeUrlForDedup(url)
    for (const group of groupState.value) {
      const index = group.items.findIndex(
        (item) => normalizeUrlForDedup(item.url) === normalizedUrl,
      )
      if (index >= 0) return { group, index }
    }
    return null
  }

  const applyItems = (nextItems: QuickLinksData['items'], nextGroups?: QuickLinkGroup[]) => {
    const sanitizedGroups = sanitizeGroups(nextGroups)
    if (sanitizedGroups.length > 0) {
      groupState.value = sanitizedGroups
      flatItems.value = []
    } else {
      flatItems.value = nextItems
      groupState.value = []
    }
  }

  const getSnapshot = (groupingEnabled = settings.quickLinks.grouping): QuickLinksData => {
    if (groupingEnabled && groupState.value.length > 0) {
      const snapshotGroups = structuredClone(toRaw(groupState.value))
      return {
        items: flattenQuickLinkGroups(snapshotGroups),
        groups: snapshotGroups,
      }
    }
    return { items: structuredClone(toRaw(flatItems.value)), groups: [] }
  }

  const persistSnapshot = async (snapshot: QuickLinksData) => {
    const hash = JSON.stringify(snapshot)
    localSaveHashes.push(hash)
    if (localSaveHashes.length > 8) localSaveHashes.shift()
    await quickLinksStorage.setValue(snapshot)
  }

  const init = async () => {
    if (loaded.value) return
    if (initTask) return await initTask

    initTask = (async () => {
      const quickLinksData = await getQuickLinksStorageValue()
      applyItems(quickLinksData.items, quickLinksData.groups)
      loaded.value = true
    })()

    try {
      await initTask
    } finally {
      initTask = null
    }
  }

  const replace = (data: QuickLinksData) => {
    if (!loaded.value && !hasQuickLinksData(data)) {
      return
    }
    applyItems(data.items, data.groups)
    loaded.value = true
  }

  const stopStorageWatch = quickLinksStorage.watch((newValue) => {
    if (!newValue) return
    const hash = JSON.stringify(newValue)
    const localSaveIndex = localSaveHashes.indexOf(hash)
    if (localSaveIndex >= 0) {
      localSaveHashes.splice(localSaveIndex, 1)
      return
    }
    replace(newValue)
  })
  onScopeDispose(stopStorageWatch)

  const save = async (data?: QuickLinksData, options?: QuickLinksSaveOptions) => {
    if (!loaded.value && !data) {
      await init()
    }
    const groupingEnabled = options?.groupingEnabled ?? settings.quickLinks.grouping
    if (data) {
      applyItems(data.items, groupingEnabled ? data.groups : [])
      loaded.value = true
    } else if (!groupingEnabled && groupState.value.length > 0) {
      flatItems.value = flattenQuickLinkGroups(groupState.value)
      groupState.value = []
    }
    await persistSnapshot(getSnapshot(groupingEnabled))
  }

  const enableGroupingFromItems = async () => {
    if (!loaded.value) {
      await init()
    }
    const defaultGroup = getGroup(DEFAULT_QUICK_LINK_GROUP_ID)
    const hasGroupedItems = groupState.value.some((group) => group.items.length > 0)
    if (defaultGroup && (hasGroupedItems || flatItems.value.length === 0)) {
      return
    }

    if (groupState.value.length === 0) {
      groupState.value = [
        {
          id: DEFAULT_QUICK_LINK_GROUP_ID,
          name: getDefaultGroupName(),
          items: structuredClone(toRaw(flatItems.value)),
        },
      ]
    } else if (defaultGroup) {
      defaultGroup.items = structuredClone(toRaw(flatItems.value))
    } else {
      const group = ensureDefaultGroup()
      if (!hasGroupedItems) group.items = structuredClone(toRaw(flatItems.value))
    }
    flatItems.value = []
    // 直接写入，避免设置开关尚未更新时 save() 将刚创建的分组清空。
    await persistSnapshot(getSnapshot(true))
  }

  const disableGroupingToItems = async () => {
    if (!loaded.value) {
      await init()
    }
    if (groupState.value.length === 0) return

    flatItems.value = flattenQuickLinkGroups(groupState.value, { dedupe: true })
    groupState.value = []
    await save()
  }

  const createGroup = async (name: string): Promise<QuickLinkGroup> => {
    const group: QuickLinkGroup = {
      id: crypto.randomUUID(),
      name: normalizeQuickLinkGroupName(
        name,
        i18next.t('newtab:quickLinks.groups.untitled', { index: groupState.value.length + 1 }),
      ),
      items: [],
    }
    groupState.value.push(group)
    await save()
    return group
  }

  const renameGroup = async (groupId: string, name: string) => {
    const group = getGroup(groupId)
    if (!group) return
    group.name = normalizeQuickLinkGroupName(
      name,
      group.id === DEFAULT_QUICK_LINK_GROUP_ID ? getDefaultGroupName() : group.name,
    )
    await save()
  }

  const deleteGroup = async (groupId: string) => {
    if (groupId === DEFAULT_QUICK_LINK_GROUP_ID) return
    const index = groupState.value.findIndex((group) => group.id === groupId)
    if (index < 0) return
    groupState.value.splice(index, 1)
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

  const addFlatQuickLink = async (quickLink: QuickLink) => {
    flatItems.value.push(quickLink)
    await save(undefined, { groupingEnabled: false })
  }

  const updateFlatQuickLink = async (index: number, quickLink: QuickLink) => {
    if (!flatItems.value[index]) return false
    flatItems.value.splice(index, 1, quickLink)
    await save(undefined, { groupingEnabled: false })
    return true
  }

  const removeFlatQuickLink = async (index: number): Promise<QuickLink | null> => {
    if (!flatItems.value[index]) return null
    const [removed] = flatItems.value.splice(index, 1)
    await save(undefined, { groupingEnabled: false })
    return removed ?? null
  }

  const updateQuickLinkInGroup = async (groupId: string, index: number, quickLink: QuickLink) => {
    const group = getGroup(groupId)
    if (!group?.items[index]) return
    group.items.splice(index, 1, quickLink)
    await save()
  }

  const removeQuickLinkFromGroup = async (
    groupId: string,
    index: number,
  ): Promise<QuickLink | null> => {
    const group = getGroup(groupId)
    if (!group?.items[index]) return null
    const [removed] = group.items.splice(index, 1)
    await save()
    return removed ?? null
  }

  const moveQuickLinkToGroup = async (fromGroupId: string, index: number, toGroupId: string) => {
    const fromGroup = getGroup(fromGroupId)
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
    const fromGroup = getGroup(fromGroupId)
    const toGroup = getGroupForInsert(toGroupId)
    if (!fromGroup?.items[fromIndex] || !toGroup) return false

    if (fromGroup.id === toGroup.id) {
      const nextItems = moveQuickLinkArrayItem(fromGroup.items, fromIndex, toIndex)
      if (!nextItems) return false
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
    const nextItems = moveQuickLinkArrayItem(flatItems.value, fromIndex, toIndex)
    if (!nextItems) return false
    flatItems.value = nextItems
    await save()
    return true
  }

  const insertFlatQuickLink = async ({ quickLink, index }: InsertFlatQuickLinkOptions) => {
    const duplicateIndex = findFlatQuickLinkIndexByUrl(quickLink.url)
    const insertIndex = Math.max(0, Math.min(index, flatItems.value.length))

    if (duplicateIndex >= 0) {
      const toIndex = duplicateIndex < insertIndex ? insertIndex - 1 : insertIndex
      return moveFlatQuickLink({ fromIndex: duplicateIndex, toIndex })
    }

    const nextItems = flatItems.value.slice()
    nextItems.splice(insertIndex, 0, quickLink)
    flatItems.value = nextItems
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
    const rawCurrentGroups = toRaw(groupState.value).map((g) => toRaw(g))
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
    groupState.value = [...(hiddenDefault ? [hiddenDefault] : []), ...nextGroups, ...hiddenOther]
    await save()
    return true
  }

  const getQuickLink = (target: QuickLinkTarget): QuickLink | undefined => {
    if (typeof target === 'number') {
      return flatItems.value[target]
    }
    return getGroup(target.groupId)?.items[target.index]
  }

  return {
    items,
    groups,
    loaded,
    init,
    replace,
    save,
    getGroup,
    getDefaultGroupItems,
    getGroupItemCount,
    enableGroupingFromItems,
    disableGroupingToItems,
    ensureDefaultGroup,
    createGroup,
    renameGroup,
    deleteGroup,
    reorderGroups,
    addQuickLinkToGroup,
    addFlatQuickLink,
    updateFlatQuickLink,
    removeFlatQuickLink,
    updateQuickLinkInGroup,
    removeQuickLinkFromGroup,
    moveQuickLinkToGroup,
    moveQuickLink,
    moveFlatQuickLink,
    insertQuickLinkToGroup,
    insertFlatQuickLink,
    getQuickLink,
    getSnapshot,
  }
})
