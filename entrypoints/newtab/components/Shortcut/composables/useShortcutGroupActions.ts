import { DEFAULT_SHORTCUT_GROUP_ID, useShortcutStore, type ShortcutGroup } from '@/shared/shortcut'

type GroupSelectDialog = {
  open: (options?: { title?: string; currentGroupId?: string }) => Promise<string | null>
}

type Translate = (key: string, options?: Record<string, unknown>) => string

export type ShortcutGroupActionItem = {
  url: string
  title: string
  favicon?: string
  groupId?: string
  originalIndex: number
}

export function useShortcutGroupActions(options: {
  groupSelectDialogRef: Ref<GroupSelectDialog | undefined | null>
  refresh: () => Promise<void>
  t: Translate
  afterDelete?: () => void
}) {
  const shortcutStore = useShortcutStore()

  const pinToGroup = async (item: ShortcutGroupActionItem) => {
    const groupId = await options.groupSelectDialogRef.value?.open({
      title: options.t('shortcut.groups.selectPinTarget'),
    })
    if (!groupId) return
    await shortcutStore.addShortcutToGroup(groupId, {
      url: item.url,
      title: item.title,
      favicon: item.favicon,
    })
    await options.refresh()
  }

  const moveToGroup = async (item: Pick<ShortcutGroupActionItem, 'groupId' | 'originalIndex'>) => {
    if (!item.groupId) return
    const groupId = await options.groupSelectDialogRef.value?.open({
      title: options.t('shortcut.groups.selectMoveTarget'),
      currentGroupId: item.groupId,
    })
    if (!groupId || groupId === item.groupId) return
    await shortcutStore.moveShortcutToGroup(item.groupId, item.originalIndex, groupId)
    await options.refresh()
  }

  const renameGroup = async (groupId: string, name: string) => {
    await shortcutStore.renameGroup(groupId, name)
    await options.refresh()
  }

  const confirmDeleteGroup = async (group: ShortcutGroup) => {
    if (group.id === DEFAULT_SHORTCUT_GROUP_ID) return
    try {
      await ElMessageBox.confirm(
        options.t('shortcut.groups.deleteConfirm', { name: group.name }),
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
    await shortcutStore.deleteGroup(group.id)
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
