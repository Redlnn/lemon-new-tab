import { ElButton } from 'element-plus'
import { useTranslation } from 'i18next-vue'

import {
  clearRetiredCloudStorage,
  clearRetiredLocalSyncMeta,
  downloadRetiredCloudSnapshot,
  getRetiredCloudSnapshot,
  hasRetiredCloudData,
  useSettingsStore,
} from '@/shared/settings'

import { OPEN_SYNC_RETIREMENT } from '@newtab/shared/keys'
import { retiredCloudSyncNoticeShownStorage } from '@newtab/shared/storages/notificationStorage'

import { runAfterFirstPaint } from '../shared/schedule'

// TODO(sync-retirement): 若干版本后删除本 composable 及所有调用方。
export function useRetiredCloudSync() {
  const settings = useSettingsStore()
  const { t } = useTranslation('settings')
  const wasEnabled = settings.sync.enabled
  const dialogLoaded = ref(false)
  const dialogVisible = ref(false)
  const dialogAcknowledgementOnly = ref(false)

  if (wasEnabled) {
    settings.sync.enabled = false
    void settings.save().catch((error) => {
      console.warn('[sync-retirement] Failed to persist the disabled sync setting:', error)
    })
  }

  const showDialog = (acknowledgementOnly = false) => {
    dialogAcknowledgementOnly.value = acknowledgementOnly
    dialogLoaded.value = true
    dialogVisible.value = true
    void retiredCloudSyncNoticeShownStorage.setValue(true).catch((error) => {
      console.warn('[sync-retirement] Failed to remember the retirement notice:', error)
    })
  }

  provide(OPEN_SYNC_RETIREMENT, () => showDialog(true))

  const reportClearFailure = (error: unknown) => {
    console.error('[sync-retirement] Failed to clear cloud data:', error)
    ElNotification.error({
      title: t('other.syncRetirement.clearFailedTitle'),
      message: t('other.syncRetirement.clearFailedMessage'),
      duration: 8000,
    })
  }

  const clearInBackground = () => {
    void clearRetiredCloudStorage()
      .then(() => ElMessage.success(t('other.syncRetirement.clearSuccess')))
      .catch(reportClearFailure)
  }

  const downloadCloudData = async () => {
    try {
      const downloaded = await downloadRetiredCloudSnapshot()
      ElMessage.info(
        t(downloaded ? 'other.syncRetirement.downloadStarted' : 'other.syncRetirement.noCloudData'),
      )
    } catch (error) {
      console.error('[sync-retirement] Failed to download cloud data:', error)
      ElMessage.error(t('other.syncRetirement.downloadFailed'))
    }
  }

  const deleteCloudData = () => {
    dialogVisible.value = false
    clearInBackground()
  }

  const showResidualDataNotice = () => {
    const remove = () => {
      notification.close()
      clearInBackground()
    }

    const notification: { close: () => void } = ElNotification.warning({
      title: t('other.syncRetirement.residualTitle'),
      message: () =>
        h('div', null, [
          h('p', null, t('other.syncRetirement.residualMessage')),
          h(ElButton, { type: 'danger', size: 'small', onClick: remove }, () =>
            t('other.syncRetirement.clearCloudData'),
          ),
        ]),
      duration: 10_000,
    })
  }

  onMounted(() => {
    runAfterFirstPaint(async () => {
      void clearRetiredLocalSyncMeta().catch((error) => {
        console.warn('[sync-retirement] Failed to clear local sync metadata:', error)
      })

      if (wasEnabled) {
        showDialog()
        return
      }

      try {
        const snapshot = await getRetiredCloudSnapshot()
        if (!hasRetiredCloudData(snapshot)) return
        if (await retiredCloudSyncNoticeShownStorage.getValue()) return

        await retiredCloudSyncNoticeShownStorage.setValue(true)
        showResidualDataNotice()
      } catch (error) {
        console.warn('[sync-retirement] Failed to inspect cloud data:', error)
      }
    })
  })

  return {
    dialogLoaded,
    dialogVisible,
    dialogAcknowledgementOnly,
    downloadCloudData,
    deleteCloudData,
  }
}
