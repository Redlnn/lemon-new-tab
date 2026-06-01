import i18next from 'i18next'

import {
  DEFAULT_QUICK_LINK_GROUP_ID,
  useQuickLinksStore,
  type QuickLinkTarget,
} from '@/shared/quickLinks'
import { useSettingsStore } from '@/shared/settings'

import { isValidUrl } from '@newtab/shared/utils'

export function openQuickLinkUrl(url: string, target: '_blank' | '_self') {
  if (!isValidUrl(url)) return
  window.open(url, target, target === '_blank' ? 'noopener,noreferrer' : undefined)
}

export async function removeQuickLink(
  target: QuickLinkTarget,
  store: ReturnType<typeof useQuickLinksStore>,
  refresh: () => Promise<void>,
) {
  const quickLink = store.getQuickLink(target)
  if (!quickLink) return
  const { url, title, favicon } = quickLink

  if (typeof target === 'number') {
    store.items.splice(target, 1)
    await store.save()
  } else {
    await store.removeQuickLinkFromGroup(target.groupId, target.index)
  }
  await refresh()
  ElMessage.success({
    message: h('p', null, [
      h(
        'span',
        { style: { color: 'var(--el-color-success)' } },
        i18next.t('newtab:quickLinks.unpinMessage'),
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

export async function pinQuickLink(
  store: ReturnType<typeof useQuickLinksStore>,
  refresh: () => Promise<void>,
  url: string,
  title: string,
  favicon?: string,
) {
  if (useSettingsStore().quickLinks.grouping) {
    await store.addQuickLinkToGroup(DEFAULT_QUICK_LINK_GROUP_ID, { url, title, favicon })
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
