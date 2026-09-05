import { useTranslation } from 'i18next-vue'

import { browser } from 'wxt/browser'

import { version } from '@/package.json'

import { useSettingsStore } from '@/shared/settings'
import type { LocalSyncStateV1 } from '@/shared/webdavSync/types'

import { shownFaviconCacheHintStorage } from '@newtab/shared/storages/notificationStorage'

import { shouldShowChangelog } from '../shared/utils'

/**
 * 处理应用级通知（欢迎、图标缓存提示、版本更新）。
 * @param showChangelog 用于自动弹出更新日志，调用方可在其中懒加载 Changelog。
 */
export function useAppNotifications(showChangelog: () => void | Promise<void>) {
  const settings = useSettingsStore()
  const { t } = useTranslation()
  const syncStateListener: Parameters<typeof browser.storage.onChanged.addListener>[0] = (
    changes,
    area,
  ) => {
    if (area === 'local' && changes.webdavSyncState) void showWebDavSyncNotification(t)
  }

  onMounted(async () => {
    browser.storage.onChanged.addListener(syncStateListener)
    await showWebDavSyncNotification(t)
    // 全新用户欢迎通知
    if (settings.pluginVersion === '') {
      ElNotification.success({
        title: t('newtab:notification.welcome.title'),
        message: t('newtab:notification.welcome.message'),
        duration: 8000,
      })
    }

    // 图标缓存提示通知（仅展示一次）
    if (!settings.faviconCacheEnabled) {
      const alreadyShown = await shownFaviconCacheHintStorage.getValue()
      if (!alreadyShown) {
        await shownFaviconCacheHintStorage.setValue(true)
        ElNotification.info({
          title: t('newtab:notification.faviconCacheHint.title'),
          message: t('newtab:notification.faviconCacheHint.message'),
          duration: 10000,
        })
      }
    }

    if (settings.pluginVersion !== version) {
      settings.readChangeLog = false
      ElMessage.primary(t('newtab:changelog.newVersionMsg', { version }))

      const canAutoShow = shouldShowChangelog(settings.pluginVersion, version)

      if (canAutoShow && !settings.hideMajorChangelog) {
        void showChangelog()
      } else {
        settings.pluginVersion = version
      }
    }
  })
  onBeforeUnmount(() => browser.storage.onChanged.removeListener(syncStateListener))
}

async function showWebDavSyncNotification(t: (key: string) => string): Promise<void> {
  const stored = await browser.storage.local.get('webdavSyncState')
  const state = stored.webdavSyncState as LocalSyncStateV1 | undefined
  if (!state?.configured) return
  const category =
    state.pauseReason === 'conflict'
      ? 'conflict'
      : state.pauseReason === 'corrupted-remote'
        ? 'corrupted'
        : state.lastError?.category === 'server'
          ? 'server'
          : undefined
  if (!category) return

  const key = `webdavSyncNotification:${category}`
  const shown = (await browser.storage.session.get(key).catch(() => ({}))) as Record<
    string,
    unknown
  >
  if (shown[key]) return
  await browser.storage.session.set({ [key]: true }).catch(() => undefined)
  ElNotification.warning({
    title: t('settings:webdavSync.title'),
    message: t(
      category === 'conflict'
        ? 'settings:webdavSync.status.conflict'
        : category === 'corrupted'
          ? 'settings:webdavSync.status.corrupted'
          : 'settings:webdavSync.errors.server',
    ),
    duration: 10_000,
  })
}
