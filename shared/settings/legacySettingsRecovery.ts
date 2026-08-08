import { browser, storage } from '#imports'

export async function downloadLegacySettingsBackup() {
  const { downloadJSON } = await import('@/shared/download')

  const settings = await browser.storage.local.get('settings')
  const quickLinksData = await browser.storage.local.get(['quickLinks', 'bookmark'])
  const customSearchEngine = await browser.storage.local.get('customSearchEngine')

  downloadJSON(
    { ...settings, ...quickLinksData, ...customSearchEngine },
    `lemon-new-tab-backup-${new Date().toISOString()}.json`,
  )
}

/** 清除扩展持久化数据；默认保留历史云端数据，避免用户未选择时一并删除。 */
export async function clearExtensionData({ includeSync = false }: { includeSync?: boolean } = {}) {
  const { idbClearAll } = await import('@/shared/storage/idb')

  const tasks = [
    localStorage.clear(),
    sessionStorage.clear(),
    idbClearAll(),
    storage.clear('local'),
    storage.clear('session'),
  ]
  if (includeSync) tasks.push(storage.clear('sync'))
  await Promise.all(tasks)
}

const newtabUrls = new Set([
  browser.runtime.getURL('/newtab.html'),
  'chrome://newtab',
  'chrome://newtab/',
  'edge://newtab',
  'edge://newtab/',
])

/** 重载所有已打开的新标签页；单个标签页失败不会阻断其他标签页。 */
export async function reloadNewtabTabs(): Promise<boolean> {
  const tabs = await browser.tabs.query({})
  const targetIds = tabs.flatMap(({ id, url }) =>
    id !== undefined && url && newtabUrls.has(url) ? [id] : [],
  )
  const results = await Promise.allSettled(targetIds.map((id) => browser.tabs.reload(id)))
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) throw failed.reason
  return targetIds.length > 0
}
