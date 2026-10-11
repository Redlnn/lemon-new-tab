import { useTranslation } from 'i18next-vue'

import { useQuickLinksStore } from '@/shared/quickLinks'

export function useQuickLinksGroupingChange() {
  const { t } = useTranslation('settings')
  const quickLinksStore = useQuickLinksStore()

  const handleGroupingChange = async (enabled: boolean | string | number) => {
    if (enabled) {
      await quickLinksStore.setGroupingEnabled(true)
      return
    }

    try {
      await ElMessageBox.confirm(
        t('quickLinks.groupingDisableConfirm'),
        t('newtab:common.warning'),
        {
          confirmButtonText: t('newtab:common.confirm'),
          cancelButtonText: t('newtab:common.cancel'),
          type: 'warning',
        },
      )
    } catch {
      return
    }

    await quickLinksStore.setGroupingEnabled(false)
  }

  return {
    handleGroupingChange,
  }
}
