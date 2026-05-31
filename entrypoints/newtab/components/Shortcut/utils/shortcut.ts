import i18next from 'i18next'

import { useSettingsStore } from '@/shared/settings'
import { DEFAULT_SHORTCUT_GROUP_ID, useShortcutStore, type ShortcutTarget } from '@/shared/shortcut'

import { isValidUrl } from '@newtab/shared/utils'

export function openShortcutUrl(url: string, target: '_blank' | '_self') {
  if (!isValidUrl(url)) return
  window.open(url, target, target === '_blank' ? 'noopener,noreferrer' : undefined)
}

export async function removeShortcut(
  target: ShortcutTarget,
  store: ReturnType<typeof useShortcutStore>,
  refresh: () => Promise<void>,
) {
  const shortcut = store.getShortcut(target)
  if (!shortcut) return
  const { url, title, favicon } = shortcut

  if (typeof target === 'number') {
    store.items.splice(target, 1)
    await store.save()
  } else {
    await store.removeShortcutFromGroup(target.groupId, target.index)
  }
  await refresh()
  ElMessage.success({
    message: h('p', null, [
      h(
        'span',
        { style: { color: 'var(--el-color-success)' } },
        i18next.t('newtab:shortcut.unpinMessage'),
      ),
      h(
        'span',
        {
          style: { marginLeft: '20px', color: 'var(--el-color-primary)', cursor: 'pointer' },
          onClick: async () => {
            if (typeof target === 'number') {
              store.items.splice(target, 0, { url, title, favicon })
              await store.save()
            } else {
              const group = store.groups.find((item) => item.id === target.groupId)
              if (group) {
                group.items.splice(target.index, 0, { url, title, favicon })
                await store.save()
              }
            }
            await refresh()
          },
        },
        i18next.t('newtab:common.undo'),
      ),
    ]),
  })
}

export async function pinShortcut(
  store: ReturnType<typeof useShortcutStore>,
  refresh: () => Promise<void>,
  url: string,
  title: string,
  favicon?: string,
) {
  if (useSettingsStore().shortcut.grouping) {
    await store.addShortcutToGroup(DEFAULT_SHORTCUT_GROUP_ID, { url, title, favicon })
  } else {
    store.items.push({
      url,
      title,
      favicon,
    })
    await store.save()
  }
  await refresh()
}
