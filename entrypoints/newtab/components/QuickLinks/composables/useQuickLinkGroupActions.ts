import {
  DEFAULT_QUICK_LINK_GROUP_ID,
  useQuickLinksStore,
  type QuickLinkGroup,
} from '@/shared/quickLinks'
import { useSettingsStore } from '@/shared/settings'

import { pinQuickLink } from '../utils/quickLink'

type GroupSelectDialog = {
  open: (options?: { title?: string; currentGroupId?: string }) => Promise<string | null>
}

type Translate = (key: string, options?: Record<string, unknown>) => string

export type QuickLinkGroupActionItem = {
  url: string
  title: string
  favicon?: string
  groupId?: string
  originalIndex: number
}

export function useQuickLinkGroupActions(options: {
  groupSelectDialogRef: Ref<GroupSelectDialog | undefined | null>
  refresh: () => Promise<void>
  t: Translate
  afterDelete?: () => void
}) {
  const quickLinksStore = useQuickLinksStore()
  const settings = useSettingsStore()

  const pinToGroup = async (item: QuickLinkGroupActionItem) => {
    if (!settings.quickLinks.grouping) {
      await pinQuickLink(quickLinksStore, options.refresh, item.url, item.title, item.favicon)
      return
    }

    const groupId = await options.groupSelectDialogRef.value?.open({
      title: options.t('quickLinks.groups.selectPinTarget'),
    })
    if (!groupId) return
    await quickLinksStore.addQuickLinkToGroup(groupId, {
      url: item.url,
      title: item.title,
      favicon: item.favicon,
    })
    await options.refresh()
  }

  const moveToGroup = async (item: Pick<QuickLinkGroupActionItem, 'groupId' | 'originalIndex'>) => {
    if (!item.groupId) return
    const groupId = await options.groupSelectDialogRef.value?.open({
      title: options.t('quickLinks.groups.selectMoveTarget'),
      currentGroupId: item.groupId,
    })
    if (!groupId || groupId === item.groupId) return
    await quickLinksStore.moveQuickLinkToGroup(item.groupId, item.originalIndex, groupId)
    await options.refresh()
  }

  const renameGroup = async (groupId: string, name: string) => {
    await quickLinksStore.renameGroup(groupId, name)
    await options.refresh()
  }

  const confirmDeleteGroup = async (group: QuickLinkGroup) => {
    if (group.id === DEFAULT_QUICK_LINK_GROUP_ID) {
      ElMessage.warning(options.t('quickLinks.groups.defaultDeleteBlocked'))
      return
    }
    try {
      await ElMessageBox.confirm(
        options.t('quickLinks.groups.deleteConfirm', { name: group.name }),
        options.t('common.warning'),
        {
          confirmButtonText: options.t('common.delete'),
          cancelButtonText: options.t('common.cancel'),
          type: 'warning',
        },
      )
    } catch {
      return
    }
    await quickLinksStore.deleteGroup(group.id)
    await options.refresh()
    options.afterDelete?.()
  }

  return {
    pinToGroup,
    moveToGroup,
    renameGroup,
    confirmDeleteGroup,
  }
}
