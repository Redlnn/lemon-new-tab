import { ElButton } from 'element-plus'
import i18next from 'i18next'

import {
  clearLegacySettingsData,
  downloadLegacySettingsBackup,
  reloadNewtabTabs,
} from './legacySettingsRecovery'

export async function handleInvaildSettings(): Promise<boolean> {
  const { default: DownloadRound } = await import('~icons/ic/round-download')

  await ElMessageBox.alert(
    () =>
      h('div', null, [
        h('p', { style: 'margin-bootom:.5em' }, i18next.t('bootstrap.invalidVer.msg')),
        h('p', { style: 'margin:.5em 0' }, [i18next.t('bootstrap.invalidVer.bak')]),
        h(
          ElButton,
          {
            type: 'primary',
            icon: DownloadRound,
            onClick: downloadLegacySettingsBackup,
          },
          'Download',
        ),
      ]),
    i18next.t('bootstrap.invalidVer.title'),
    {
      confirmButtonText: i18next.t('bootstrap.invalidVer.btn'),
      type: 'warning',
      showClose: false,
      closeOnPressEscape: false,
      closeOnClickModal: false,
      roundButton: true,
    },
  )

  const loading = ElLoading.service({
    lock: true,
    text: i18next.t('settings:other.purge.confirm.wallpaper.purging'),
    body: true,
    background: 'var(--el-overlay-color-light)',
  })

  try {
    await clearLegacySettingsData()
  } catch (e) {
    loading.close()
    const error = e instanceof Error ? e : new Error(String(e))
    console.error('Failed to clear data:', error)
    await ElMessageBox.alert(
      h('div', null, [h('h5', null, error.name), h('p', null, error.message)]),
      {
        title: 'Failed to clear data',
      },
    )
    throw error
  }
  loading.close()
  await reloadNewtabTabs()
  return false
}
