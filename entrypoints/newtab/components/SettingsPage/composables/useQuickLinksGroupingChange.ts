import { useTranslation } from 'i18next-vue'

import { useQuickLinksStore } from '@/shared/quickLinks'
import { useSettingsStore } from '@/shared/settings'

export function useQuickLinksGroupingChange() {
  const { t } = useTranslation('settings')
  const settings = useSettingsStore()
  const quickLinksStore = useQuickLinksStore()

  const handleGroupingChange = async (enabled: boolean | string | number) => {
    if (enabled) {
      await quickLinksStore.enableGroupingFromItems()
      settings.quickLinks.grouping = true
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
      settings.quickLinks.grouping = true
      return
    }

    await quickLinksStore.disableGroupingToItems()
    settings.quickLinks.grouping = false
  }

  return {
    handleGroupingChange,
  }
}
