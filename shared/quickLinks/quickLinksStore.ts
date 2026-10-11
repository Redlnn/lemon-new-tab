import { defineStore } from 'pinia'

import i18next from 'i18next'

import { browser } from 'wxt/browser'

import {
  builtInApps,
  builtInAppUrl,
  resolveBuiltInAppId,
  type BuiltInAppId,
} from '@/shared/builtinApps'
import { jsonEquals } from '@/shared/json'
import { useSettingsStore } from '@/shared/settings'
import { normalizeCurrentSettings } from '@/shared/settings/normalize'
import { settingsStorage } from '@/shared/settings/settingsStorage'
import { createDraftWriter, withSyncWriteLock } from '@/shared/storage/syncWrite'
import { normalizeUrlForDedup } from '@/shared/url'
import type { LocalSyncStateV1 } from '@/shared/webdavSync/types'

import { rebaseQuickLinkChanges } from './localChanges'
import { flattenQuickLinkGroups, moveQuickLinkArrayItem } from './quickLinkAlgorithms'
import {
  DEFAULT_QUICK_LINK_GROUP_ID,
  MAX_QUICK_LINK_GROUP_NAME_LENGTH,
  defaultQuickLinksData,
  ensureQuickLinksStableIds,
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

function toStorageQuickLink(item: QuickLink): QuickLink {
  const quickLink: QuickLink = {
    id: item.id ?? crypto.randomUUID(),
    url: item.url,
    title: item.title,
  }
  if (item.favicon !== undefined) {
    quickLink.favicon = item.favicon
    if (item.faviconSource !== undefined) quickLink.faviconSource = item.faviconSource
  }
  if (item.appId !== undefined) quickLink.appId = item.appId
  return quickLink
}

function withRuntimeIcon(item: QuickLink): QuickLink {
  const appId = resolveBuiltInAppId(item)
  return appId ? { ...item, appId, icon: builtInApps[appId].icon } : item
}

function toStorageQuickLinkGroup(group: QuickLinkGroup): QuickLinkGroup {
  return {
    id: group.id,
    name: group.name,
    items: group.items.map(toStorageQuickLink),
  }
}

function isSameQuickLink(current: QuickLink, next: QuickLink): boolean {
  return (
    current.url === next.url &&
    current.title === next.title &&
    current.favicon === next.favicon &&
    current.faviconSource === next.faviconSource &&
    current.appId === next.appId
  )
}

function withStableId(item: QuickLink, current?: QuickLink): QuickLink {
  return { ...item, id: item.id ?? current?.id ?? crypto.randomUUID() }
}

export const useQuickLinksStore = defineStore('quickLinks', () => {
  const settings = useSettingsStore()
  const flatItems = ref(structuredClone(defaultQuickLinksData.items))
  const groupState = ref<QuickLinkGroup[]>(structuredClone(defaultQuickLinksData.groups ?? []))
  const loaded = ref(false)
  let initTask: Promise<void> | null = null

  const items = computed<readonly QuickLink[]>(() =>
    groupState.value.length > 0 ? flattenQuickLinkGroups(groupState.value) : flatItems.value,
  )
  const groups = computed<readonly QuickLinkGroup[]>(() => groupState.value)

  const getDefaultGroupName = () => i18next.t('newtab:quickLinks.groups.default')

  const groupIndex = computed(() => new Map(groupState.value.map((group) => [group.id, group])))
  const getGroup = (groupId: string) => groupIndex.value.get(groupId)

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

  const flatUrlIndex = computed(() => {
    const result = new Map<string, number>()
    flatItems.value.forEach((item, index) => {
      const key = normalizeUrlForDedup(item.url)
      if (!result.has(key)) result.set(key, index)
    })
    return result
  })
  const findFlatQuickLinkIndexByUrl = (url: string) =>
    flatUrlIndex.value.get(normalizeUrlForDedup(url)) ?? -1

  const groupedUrlIndex = computed(() => {
    const result = new Map<string, { group: QuickLinkGroup; index: number }>()
    for (const group of groupState.value) {
      group.items.forEach((item, index) => {
        const key = normalizeUrlForDedup(item.url)
        if (!result.has(key)) result.set(key, { group, index })
      })
    }
    return result
  })
  const findGroupedQuickLinkByUrl = (url: string) =>
    groupedUrlIndex.value.get(normalizeUrlForDedup(url)) ?? null

  const applyItems = (nextItems: QuickLinksData['items'], nextGroups?: QuickLinkGroup[]) => {
    const normalized = ensureQuickLinksStableIds({
      items: nextItems.map(withRuntimeIcon),
      groups: nextGroups?.map((group) => ({
        ...group,
        items: group.items.map(withRuntimeIcon),
      })),
    })
    const sanitizedGroups = sanitizeGroups(normalized.value.groups)
    if (sanitizedGroups.length > 0) {
      groupState.value = sanitizedGroups
      flatItems.value = []
    } else {
      flatItems.value = normalized.value.items
      groupState.value = []
    }
  }

  const getSnapshot = (): QuickLinksData => {
    if (groupState.value.length > 0) {
      const snapshotGroups = groupState.value.map(toStorageQuickLinkGroup)
      return {
        items: flattenQuickLinkGroups(snapshotGroups),
        groups: snapshotGroups,
      }
    }
    return { items: flatItems.value.map(toStorageQuickLink), groups: [] }
  }

  const writer = createDraftWriter(
    quickLinksStorage.raw,
    getSnapshot,
    (value) => applyItems(value.items, value.groups),
    defaultQuickLinksData,
    rebaseQuickLinkChanges,
  )
  const persistSnapshot = (snapshot: QuickLinksData) => writer.save(snapshot)

  const init = async () => {
    if (initTask) return await initTask
    if (loaded.value) return

    initTask = (async () => {
      const quickLinksData = await getQuickLinksStorageValue()
      writer.reset(quickLinksData)
      loaded.value = true
      await queueGroupingChange()
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

  const syncApplying = ref(false)
  let groupingTail: Promise<void> = Promise.resolve()

  const convertGrouping = (data: QuickLinksData, enabled: boolean): QuickLinksData => {
    const currentGroups = data.groups ?? []
    if (enabled) {
      if (currentGroups.some((group) => group.id === DEFAULT_QUICK_LINK_GROUP_ID)) return data
      const groups = [
        {
          id: DEFAULT_QUICK_LINK_GROUP_ID,
          name: getDefaultGroupName(),
          items: currentGroups.length ? [] : data.items,
        },
        ...currentGroups,
      ]
      return { items: flattenQuickLinkGroups(groups), groups }
    }
    return currentGroups.length
      ? { items: flattenQuickLinkGroups(currentGroups, { dedupe: true }), groups: [] }
      : data
  }

  const queueGroupingChange = (enabled?: boolean): Promise<void> => {
    const task = groupingTail.then(async () => {
      await withSyncWriteLock(async () => {
        const stored = (await browser.storage.local.get('webdavSyncState')) as {
          webdavSyncState?: LocalSyncStateV1
        }
        syncApplying.value = stored.webdavSyncState?.pending?.phase === 'applying-local'
        if (syncApplying.value) {
          if (enabled !== undefined) throw new Error('Quick links are being synchronized')
          return
        }
        const [storedSettings, storedLinks] = await Promise.all([
          settingsStorage.raw.getValue(),
          getQuickLinksStorageValue(true),
        ])
        const settingsCommit = settings.prepareCommit(
          normalizeCurrentSettings(storedSettings),
          (value) =>
            enabled === undefined
              ? value
              : {
                  ...value,
                  quickLinks: { ...value.quickLinks, grouping: enabled },
                },
        )
        const target = settingsCommit.value.quickLinks.grouping
        const linksCommit = writer.prepareCommit(storedLinks, (value) =>
          convertGrouping(value, target),
        )
        try {
          if (
            !jsonEquals(storedSettings, settingsCommit.value) ||
            !jsonEquals(storedLinks, linksCommit.value)
          ) {
            await browser.storage.local.set({
              settings: settingsCommit.value,
              quickLinks: linksCommit.value,
            })
          }
          linksCommit.commit()
          settingsCommit.commit()
        } catch (error) {
          linksCommit.cancel()
          settingsCommit.cancel()
          throw error
        }
      })
    })
    groupingTail = task.catch(() => undefined)
    return task
  }

  const reconcileGrouping = () => {
    if (!loaded.value || initTask) return
    void queueGroupingChange().catch((error) => {
      console.error('[quick-links] Failed to reconcile grouping:', error)
    })
  }
  const stopStorageWatch = quickLinksStorage.watch((newValue) => {
    if (!newValue) return
    writer.receive(newValue)
  })
  const stopGroupingWatch = watch(
    () => [settings.quickLinks.grouping, syncApplying.value],
    reconcileGrouping,
  )
  const onSyncStateChanged: Parameters<typeof browser.storage.onChanged.addListener>[0] = (
    changes,
    area,
  ) => {
    if (area !== 'local' || !changes.webdavSyncState) return
    const state = changes.webdavSyncState.newValue as LocalSyncStateV1 | undefined
    syncApplying.value = state?.pending?.phase === 'applying-local'
  }
  browser.storage.onChanged.addListener(onSyncStateChanged)
  onScopeDispose(() => {
    stopStorageWatch()
    stopGroupingWatch()
    browser.storage.onChanged.removeListener(onSyncStateChanged)
  })

  const setGroupingEnabled = async (enabled: boolean) => {
    await init()
    await queueGroupingChange(enabled)
  }

  const save = async (data?: QuickLinksData) => {
    if (!loaded.value && !data) await init()
    await groupingTail
    if (data) {
      applyItems(data.items, data.groups)
      loaded.value = true
    }
    await persistSnapshot(getSnapshot())
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
    const nextName = normalizeQuickLinkGroupName(
      name,
      group.id === DEFAULT_QUICK_LINK_GROUP_ID ? getDefaultGroupName() : group.name,
    )
    if (group.name === nextName) return
    group.name = nextName
    await save()
  }

  const deleteGroup = async (groupId: string) => {
    if (groupId === DEFAULT_QUICK_LINK_GROUP_ID) return
    const index = groupState.value.findIndex((group) => group.id === groupId)
    if (index < 0) return
    groupState.value.splice(index, 1)
    await save()
  }

  const addQuickLinkToGroup = async (groupId: string, quickLink: QuickLink) => {
    const group = getGroupForInsert(groupId)
    if (!group) return
    group.items.push(withStableId(quickLink))
    await save()
  }

  const addFlatQuickLink = async (quickLink: QuickLink) => {
    flatItems.value.push(withStableId(quickLink))
    await save()
  }

  const updateFlatQuickLink = async (index: number, quickLink: QuickLink) => {
    const current = flatItems.value[index]
    if (!current) return false
    const next = withStableId(quickLink, current)
    if (isSameQuickLink(current, next)) return false
    flatItems.value.splice(index, 1, next)
    await save()
    return true
  }

  const removeFlatQuickLink = async (index: number): Promise<QuickLink | null> => {
    if (!flatItems.value[index]) return null
    const [removed] = flatItems.value.splice(index, 1)
    await save()
    return removed ?? null
  }

  const updateQuickLinkInGroup = async (groupId: string, index: number, quickLink: QuickLink) => {
    const group = getGroup(groupId)
    const current = group?.items[index]
    if (!current) return
    const next = withStableId(quickLink, current)
    if (isSameQuickLink(current, next)) return
    group.items.splice(index, 1, next)
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
    nextItems.splice(insertIndex, 0, withStableId(quickLink))
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

    toGroup.items.splice(insertIndex, 0, withStableId(quickLink))
    await save()
    return true
  }

  const reorderGroups = async (orderedIds: readonly string[]) => {
    const rawCurrentGroups = toRaw(groupState.value).map((g) => toRaw(g))
    const idToGroup = new Map(rawCurrentGroups.map((g) => [g.id, g]))
    if (
      orderedIds.length !== rawCurrentGroups.length ||
      new Set(orderedIds).size !== orderedIds.length ||
      orderedIds.some((id) => !idToGroup.has(id)) ||
      orderedIds.every((id, index) => id === rawCurrentGroups[index]?.id)
    ) {
      return false
    }

    groupState.value = orderedIds.map((id) => idToGroup.get(id)!)
    await save()
    return true
  }

  const getQuickLink = (target: QuickLinkTarget): QuickLink | undefined => {
    if (typeof target === 'number') {
      return flatItems.value[target]
    }
    return getGroup(target.groupId)?.items[target.index]
  }

  const findQuickLinkTargetById = (id: string): QuickLinkTarget | null => {
    if (groupState.value.length) {
      for (const group of groupState.value) {
        const index = group.items.findIndex((item) => item.id === id)
        if (index >= 0) return { groupId: group.id, index }
      }
      return null
    }
    const index = flatItems.value.findIndex((item) => item.id === id)
    return index >= 0 ? index : null
  }

  const setBuiltInAppEnabled = async (id: BuiltInAppId, enabled: boolean) => {
    await init()
    const matches = (item: QuickLink) => resolveBuiltInAppId(item) === id
    const createItem = (): QuickLink => ({
      id: crypto.randomUUID(),
      url: builtInAppUrl(id),
      title: i18next.t(`newtab:${builtInApps[id].titleKey}`),
      icon: builtInApps[id].icon,
      appId: id,
    })
    if (groupState.value.length > 0) {
      const existing = groupState.value.flatMap((group) => group.items).find(matches)
      for (const group of groupState.value)
        group.items = group.items.filter((item) => !matches(item))
      if (enabled) ensureDefaultGroup().items.unshift(existing ?? createItem())
      await save()
      return
    }
    const existing = flatItems.value.find(matches)
    flatItems.value = flatItems.value.filter((item) => !matches(item))
    if (enabled) flatItems.value.unshift(existing ?? createItem())
    await save()
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
    setGroupingEnabled,
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
    findQuickLinkTargetById,
    getSnapshot,
    setBuiltInAppEnabled,
  }
})
