import i18next from 'i18next'

import { useShortcutStore } from '@/shared/shortcut'

export async function removeShortcut(
  index: number,
  store: ReturnType<typeof useShortcutStore>,
  refresh: () => Promise<void>,
) {
  const { url, title, favicon } = store.items[index]!
  store.items.splice(index, 1)
  await store.save()
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
            store.items.splice(index, 0, {
              url,
              title,
              favicon,
            })
            await store.save()
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
  store.items.push({
    url,
    title,
    favicon,
  })
  await store.save()
  await refresh()
}
