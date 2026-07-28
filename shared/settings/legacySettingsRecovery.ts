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

export async function clearLegacySettingsData() {
  const { idbClearAll } = await import('@/shared/storage/idb')

  await Promise.all([
    localStorage.clear(),
    sessionStorage.clear(),
    idbClearAll(),
    storage.clear('local'),
    storage.clear('session'),
  ])
}

export async function reloadNewtabTabs() {
  const newtabUrl = browser.runtime.getURL('/newtab.html')
  const tabs = await browser.tabs.query({})
  await Promise.allSettled(
    tabs.flatMap(({ id, url }) =>
      id === undefined || (url !== newtabUrl && url !== 'chrome://newtab/')
        ? []
        : [browser.tabs.reload(id)],
    ),
  )
}
