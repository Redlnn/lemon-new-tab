import type { SyncSnapshotV1 } from './types.ts'

const byId = (left: { id: string }, right: { id: string }) =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0

/** 仅规范化工作副本；签名和哈希始终使用原始远端内容。 */
export function normalizeSnapshotOrder(snapshot: SyncSnapshotV1): SyncSnapshotV1 {
  return {
    ...snapshot,
    ...(snapshot.quickLinks
      ? {
          quickLinks: {
            ...snapshot.quickLinks,
            items: [...snapshot.quickLinks.items].sort(byId),
            groups: [...snapshot.quickLinks.groups].sort(byId),
          },
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
