import { BgType } from '@/shared/enums'
import { useSettingsStore } from '@/shared/settings'
import { applyStoredMonetColors, getMonetColors } from '@/shared/theme/monetStorage'

import { runAfterFirstPaint } from '@newtab/shared/schedule'
import { applyMonet } from '@newtab/shared/theme'

export function useBackgroundMonet(options: {
  backgroundUrl: Ref<string>
  image: Ref<HTMLImageElement | null>
  isVideo: Ref<boolean>
  sourceKey: Ref<string>
  refreshOnline: () => Promise<void>
}) {
  const settings = useSettingsStore()
  let requestVersion = 0
  let pendingSourceKey = ''
  let appliedSourceKey = ''

  const invalidate = () => {
    requestVersion += 1
  }

  const ensure = async (ensureOptions: { force?: boolean; immediate?: boolean } = {}) => {
    if (!settings.theme.monetColor || options.isVideo.value) return
    if (options.backgroundUrl.value.startsWith('http')) return

    const sourceKey = options.sourceKey.value
    if (!sourceKey) return

    const currentRequest = ++requestVersion
    const storedColors = await getMonetColors().catch((error) => {
      console.warn('[background] Failed to read Monet colors cache:', error)
      return null
    })

    if (currentRequest !== requestVersion || sourceKey !== options.sourceKey.value) return

    if (!ensureOptions.force && storedColors?.sourceKey === sourceKey) {
      applyStoredMonetColors(storedColors)
      appliedSourceKey = sourceKey
      return
    }

    if (storedColors && !storedColors.sourceKey) applyStoredMonetColors(storedColors)
    if (
      !ensureOptions.force &&
      (pendingSourceKey === sourceKey || appliedSourceKey === sourceKey)
    ) {
      return
    }

    const apply = async () => {
      if (currentRequest !== requestVersion || sourceKey !== options.sourceKey.value) return
      const image = options.image.value
      if (!image) return

      pendingSourceKey = sourceKey
      try {
        await applyMonet(image, { sourceKey })
        if (sourceKey === options.sourceKey.value) appliedSourceKey = sourceKey
      } finally {
        if (pendingSourceKey === sourceKey) pendingSourceKey = ''
      }
    }

    if (ensureOptions.immediate) await apply()
    else runAfterFirstPaint(apply)
  }

  watch(
    () => settings.theme.monetColor,
    async (enabled) => {
      document.documentElement.classList.toggle('monet', enabled)
      if (!enabled || !options.backgroundUrl.value || options.isVideo.value) return
      if (settings.background.bgType === BgType.Online) await options.refreshOnline()
      await ensure({ force: true, immediate: true })
    },
    { immediate: true },
  )

  watch(options.sourceKey, invalidate)
  onUnmounted(invalidate)

  return {
    invalidate,
    ensure,
    onImageLoaded: () => void ensure(),
  }
}
