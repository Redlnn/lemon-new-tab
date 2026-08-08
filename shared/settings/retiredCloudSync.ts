import { storage } from '#imports'

import { downloadJSON } from '@/shared/download'

export type RetiredCloudSnapshot = Record<string, unknown>

// TODO(sync-retirement): 若干版本后删除本模块、启动检查、会话提示标记、退役弹窗、
// 相关翻译及设置中的 sync.enabled 字段。
export async function getRetiredCloudSnapshot(): Promise<RetiredCloudSnapshot> {
  return await storage.snapshot('sync')
}

export function hasRetiredCloudData(snapshot: RetiredCloudSnapshot): boolean {
  return Object.keys(snapshot).length > 0
}

export async function downloadRetiredCloudSnapshot(): Promise<boolean> {
  const snapshot = await getRetiredCloudSnapshot()
  if (!hasRetiredCloudData(snapshot)) return false

  downloadJSON(snapshot, `lemon-new-tab-cloud-data-${new Date().toISOString()}.json`)
  return true
}

export async function clearRetiredCloudStorage(): Promise<void> {
  await storage.clear('sync')
}

export async function clearRetiredLocalSyncMeta(): Promise<void> {
  await storage.removeItem('local:syncMeta')
}
