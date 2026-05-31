import { useTranslation } from 'i18next-vue'

import { useSettingsStore } from '@/shared/settings'
import { useShortcutStore } from '@/shared/shortcut'

export function useShortcutGroupingChange() {
  const { t } = useTranslation('settings')
  const settings = useSettingsStore()
  const shortcutStore = useShortcutStore()

  const handleGroupingChange = async (enabled: boolean | string | number) => {
    if (enabled) {
      await shortcutStore.enableGroupingFromItems()
      settings.shortcut.grouping = true
      return
    }

    try {
      await ElMessageBox.confirm(t('shortcut.groupingDisableConfirm'), t('newtab:common.warning'), {
        confirmButtonText: t('newtab:common.confirm'),
        cancelButtonText: t('newtab:common.cancel'),
        type: 'warning',
      })
    } catch {
      settings.shortcut.grouping = true
      return
    }

    await shortcutStore.disableGroupingToItems()
    settings.shortcut.grouping = false
  }

  return {
    handleGroupingChange,
  }
}
