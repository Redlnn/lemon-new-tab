import { useTranslation } from 'i18next-vue'

import { version } from '@/package.json'

import { useSettingsStore } from '@/shared/settings'
import { setSyncEventCallback } from '@/shared/sync/syncDataStore'

import { shownFaviconCacheHintStorage } from '@newtab/shared/storages/notificationStorage'

import { shouldShowChangelog } from '../shared/utils'

/**
 * 处理应用级通知（欢迎、图标缓存提示、版本更新、同步错误）。
 * @param showChangelog 用于自动弹出更新日志，调用方可在其中懒加载 Changelog。
 */
export function useAppNotifications(showChangelog: () => void | Promise<void>) {
  const settings = useSettingsStore()
  const { t } = useTranslation('sync')

  onMounted(async () => {
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

    // 注册同步事件回调
    setSyncEventCallback((type, payload) => {
      if (type === 'version-too-new') {
        const p = payload as { cloud: number; local: number }
        ElNotification.error({
          title: t('fail.title'),
          message: t('fail.message', { cloud: String(p.cloud), local: String(p.local) }),
        })
      } else if (type === 'legacy-detected') {
        ElNotification.warning({
          title: t('legacyFormat.title'),
          message: t('legacyFormat.message'),
        })
      } else if (type === 'conflict') {
        ElNotification.warning({
          title: t('conflict.title'),
          message: t('conflict.message'),
        })
      } else if (type === 'sync-error') {
        const err = payload as Error
        ElNotification.error({
          title: t('error.title'),
          message: err.message || 'Unknown error.',
        })
      }
    })
  })
}
