import { useTranslation } from 'i18next-vue'

import { browser } from '#imports'

import { resolveBuiltInAppId, type BuiltInAppId } from '@/shared/builtinApps'
import { useQuickLinksStore, type QuickLinkTarget } from '@/shared/quickLinks'

import { openUrlInIncognitoWindow } from '@newtab/shared/incognito'
import { isSafeUrl } from '@newtab/shared/utils'

import { openQuickLinkUrl, pinQuickLink, removeQuickLink } from '../utils/quickLink'
import { blockSite } from '../utils/topSites'

export type CtxQuickLinkItem = {
  id?: string
  url: string
  title: string
  appId?: BuiltInAppId
  isPinned: boolean
  originalIndex: number
  groupId?: string
}

export function useQuickLinkContextMenu(options: {
  refreshFn: () => Promise<void>
  onOpenEditDialog?: (target: QuickLinkTarget) => void
  onPin?: (item: CtxQuickLinkItem) => Promise<void> | void
  onMove?: (item: CtxQuickLinkItem) => Promise<void> | void
}) {
  const { t } = useTranslation()
  const quickLinksStore = useQuickLinksStore()
  const { refreshFn, onOpenEditDialog } = options

  const ctxPosition = ref<DOMRect>(DOMRect.fromRect({ x: 0, y: 0 }))
  const ctxTriggerRef = ref({ getBoundingClientRect: () => ctxPosition.value })
  const ctxItem = ref<CtxQuickLinkItem | null>(null)

  const setCtxContext = (
    event: MouseEvent | PointerEvent | TouchEvent,
    item: CtxQuickLinkItem,
  ): void => {
    const target = item.groupId
      ? { groupId: item.groupId, index: item.originalIndex }
      : item.originalIndex
    ctxItem.value = {
      ...item,
      id: item.id ?? (item.isPinned ? quickLinksStore.getQuickLink(target)?.id : undefined),
    }
    let clientX = 0
    let clientY = 0
    if ('clientX' in event) {
      clientX = event.clientX
      clientY = event.clientY
    } else if ('touches' in event && event.touches[0]) {
      clientX = event.touches[0].clientX
      clientY = event.touches[0].clientY
    }
    ctxPosition.value = DOMRect.fromRect({ x: clientX, y: clientY })
  }

  const ctxOpenInNewTab = (): void => {
    if (ctxItem.value && !resolveBuiltInAppId(ctxItem.value))
      openQuickLinkUrl(ctxItem.value.url, '_blank')
  }

  const ctxOpenInNewWindow = (): void => {
    if (ctxItem.value && !resolveBuiltInAppId(ctxItem.value) && isSafeUrl(ctxItem.value.url))
      browser.windows.create({ url: ctxItem.value.url })
  }

  const ctxOpenInIncognitoWindow = async (): Promise<void> => {
    if (ctxItem.value && !resolveBuiltInAppId(ctxItem.value) && isSafeUrl(ctxItem.value.url))
      await openUrlInIncognitoWindow(ctxItem.value.url)
  }

  const ctxCopyLink = (): void => {
    if (ctxItem.value && !resolveBuiltInAppId(ctxItem.value))
      navigator.clipboard.writeText(ctxItem.value.url)
  }

  const ctxCreateBookmark = async (): Promise<void> => {
    if (!ctxItem.value || resolveBuiltInAppId(ctxItem.value)) return
    const { url, title } = ctxItem.value
    if (!isSafeUrl(url)) return
    const res = await browser.bookmarks.search({ url })
    if (res.length !== 0) {
      ElMessage.info(t('quickLinks.bookmark.existing'))
      return
    }
    const created = await browser.bookmarks.create({ title, url })
    if (!created.parentId) return
    const nodes = await browser.bookmarks.get(created.parentId)
    const folderTitle = nodes[0]?.title ?? null
    ElMessage.success(t('quickLinks.bookmark.success', { folder: folderTitle }))
  }

  const ctxUnpin = async (): Promise<void> => {
    if (!ctxItem.value?.isPinned || !ctxItem.value.id) return
    const target = quickLinksStore.findQuickLinkTargetById(ctxItem.value.id)
    if (target === null) return
    await removeQuickLink(target, quickLinksStore, refreshFn)
  }

  const ctxPin = async (): Promise<void> => {
    if (!ctxItem.value || ctxItem.value.isPinned) return
    if (options.onPin) {
      await options.onPin(ctxItem.value)
      return
    }
    await pinQuickLink(quickLinksStore, refreshFn, ctxItem.value.url, ctxItem.value.title)
  }

  const ctxMove = async (): Promise<void> => {
    if (!ctxItem.value?.isPinned || !ctxItem.value.groupId || !options.onMove) return
    await options.onMove(ctxItem.value)
  }

  const ctxBlockSite = async (): Promise<void> => {
    if (!ctxItem.value || ctxItem.value.isPinned) return
    await blockSite(ctxItem.value.url, refreshFn)
    refreshFn()
  }

  const ctxEdit = (): void => {
    if (!ctxItem.value?.isPinned || !ctxItem.value.id) return
    const target = quickLinksStore.findQuickLinkTargetById(ctxItem.value.id)
    if (target !== null) onOpenEditDialog?.(target)
  }

  return {
    ctxTriggerRef,
    ctxItem,
    setCtxContext,
    ctxOpenInNewTab,
    ctxOpenInNewWindow,
    ctxOpenInIncognitoWindow,
    ctxCopyLink,
    ctxCreateBookmark,
    ctxUnpin,
    ctxPin,
    ctxMove,
    ctxBlockSite,
    ctxEdit,
  }
}
