import type { SyncQuickLinksDataV1, SyncSnapshotV1 } from './types.ts'

const byId = (left: { id: string }, right: { id: string }) =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0

export function normalizeSyncQuickLinks(links: SyncQuickLinksDataV1): SyncQuickLinksDataV1 {
  const groups = links.groups.map((group) => ({ ...group, itemIds: [...group.itemIds] }))
  // 本机只支持平铺或分组；混合结果的根链接归入现有默认组，没有默认组则归入首组。
  if (groups.length && links.rootOrder.length) {
    const target =
      groups.find((group) => group.id === 'default') ??
      groups.find((group) => group.id === links.groupOrder[0]) ??
      groups[0]!
    target.itemIds.push(...links.rootOrder)
  }
  return {
    ...links,
    items: [...links.items].sort(byId),
    groups: groups.sort(byId),
    rootOrder: groups.length ? [] : [...links.rootOrder],
  }
}

/** 仅规范化工作副本；签名和哈希始终使用原始远端内容。 */
export function normalizeSnapshotOrder(snapshot: SyncSnapshotV1): SyncSnapshotV1 {
  return {
    ...snapshot,
    ...(snapshot.quickLinks
      ? {
          quickLinks: normalizeSyncQuickLinks(snapshot.quickLinks),
        }
      : {}),
    ...(snapshot.customSearchEngines
      ? {
          customSearchEngines: {
            ...snapshot.customSearchEngines,
            items: [...snapshot.customSearchEngines.items].sort(byId),
          },
        }
      : {}),
  }
}
