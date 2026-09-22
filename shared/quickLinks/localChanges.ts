import { rebaseLocalChanges } from '../storage/localChanges.ts'

import type { QuickLinksData } from './quickLinksStorage.ts'

function project(data: QuickLinksData) {
  const groups = data.groups ?? []
  return {
    items: groups.length ? groups.flatMap((group) => group.items) : data.items,
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      itemIds: group.items.map((item) => item.id!),
    })),
    rootOrder: groups.length ? [] : data.items.map((item) => item.id!),
  }
}

/** 移动分组成员与编辑实体内容分开合并，避免搬运时携带旧标题或图标。 */
export function rebaseQuickLinkChanges(
  before: QuickLinksData,
  edited: QuickLinksData,
  current: QuickLinksData,
): QuickLinksData {
  const base = project(before),
    next = project(edited)
  const merged = rebaseLocalChanges(base, next, project(current))
  const items = new Map(merged.items.map((item) => [item.id!, item]))
  const previousGroup = new Map(
    base.groups.flatMap((group) => group.itemIds.map((id) => [id, group.id] as const)),
  )
  const moved = new Map(
    next.groups.flatMap((group) =>
      group.itemIds
        .filter((id) => previousGroup.get(id) !== group.id)
        .map((id) => [id, group.id] as const),
    ),
  )
  const seen = new Set<string>()
  const take = (ids: string[], groupId?: string) =>
    ids.flatMap((id) => {
      const item = items.get(id)
      if (!item || seen.has(id) || (groupId && moved.has(id) && moved.get(id) !== groupId))
        return []
      seen.add(id)
      return [item]
    })
  const groups = merged.groups.map((group) => ({
    id: group.id,
    name: group.name,
    items: take(group.itemIds, group.id),
  }))
  if (groups.length) {
    groups[0]!.items.push(...take([...items.keys()]))
    return { groups, items: groups.flatMap((group) => group.items) }
  }
  return { groups: [], items: take([...merged.rootOrder, ...items.keys()]) }
}
