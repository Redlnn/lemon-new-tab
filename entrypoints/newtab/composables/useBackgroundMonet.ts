import { BgType } from '@/shared/enums'
import { useSettingsStore } from '@/shared/settings'
import {
  applyStoredMonetColors,
  getMonetColors,
  saveMonetColors,
} from '@/shared/theme/monetStorage'

import { runAfterFirstPaint } from '@newtab/shared/schedule'
import { disposeMonetWorker, extractMonetColors } from '@newtab/shared/theme'
import beachPalette from '@newtab/shared/wallpaper/beachPalette.json'
// 从无云、无角色的草地画面采样 #97bb67，预先生成明暗两套莫奈颜色。
import meadowPalette from '@newtab/shared/wallpaper/meadowPalette.json'

export function useBackgroundMonet(options: {
  backgroundUrl: Ref<string>
  image: Ref<HTMLImageElement | null>
  isVideo: Ref<boolean>
  sourceKey: Ref<string>
  refreshOnline: () => Promise<void>
}) {
  const settings = useSettingsStore()
  let requestVersion = 0
  let pending: { sourceKey: string; request: number } | undefined
  let appliedSourceKey = ''

  const invalidate = () => {
    requestVersion += 1
    pending = undefined
  }

  const ensure = async (ensureOptions: { force?: boolean; immediate?: boolean } = {}) => {
    if (!settings.theme.monetColor || options.isVideo.value) return
    if (options.backgroundUrl.value.startsWith('http')) return

    const sourceKey = options.sourceKey.value
    if (!sourceKey) return
    if (!ensureOptions.force && pending?.sourceKey === sourceKey) return

    const currentRequest = ++requestVersion
    const isCurrent = () =>
      currentRequest === requestVersion &&
      sourceKey === options.sourceKey.value &&
      settings.theme.monetColor &&
      !options.isVideo.value
    const storedColors = await getMonetColors().catch((error) => {
      console.warn('[background] Failed to read Monet colors cache:', error)
      return null
    })

    if (!isCurrent()) return

    if (!ensureOptions.force && storedColors?.sourceKey === sourceKey) {
      applyStoredMonetColors(storedColors)
      appliedSourceKey = sourceKey
      return
    }

    if (storedColors && !storedColors.sourceKey) applyStoredMonetColors(storedColors)
    if (!ensureOptions.force && appliedSourceKey === sourceKey) {
      return
    }

    const apply = async () => {
      if (!isCurrent()) return
      const image = options.image.value
      if (!image) return

      pending = { sourceKey, request: currentRequest }
      try {
        const { cssLight, cssDark } = await extractMonetColors(image)
        if (!isCurrent() || image !== options.image.value) return
        await saveMonetColors(cssLight, cssDark, sourceKey)
        if (!isCurrent() || image !== options.image.value) return
        applyStoredMonetColors({ cssLight, cssDark, sourceKey, timestamp: Date.now() })
        appliedSourceKey = sourceKey
      } catch (error) {
        if (isCurrent()) console.error('Failed to apply Monet colors:', error)
      } finally {
        if (pending?.request === currentRequest) pending = undefined
      }
    }

    if (ensureOptions.immediate) await apply()
    else runAfterFirstPaint(apply)
  }

  watch(
    () => settings.theme.monetColor,
    async (enabled) => {
      invalidate()
      if (!enabled) disposeMonetWorker()
      document.documentElement.classList.toggle('monet', enabled)
      if (
        !enabled ||
        settings.background.bgType === BgType.Meadow ||
        settings.background.bgType === BgType.Beach ||
        !options.backgroundUrl.value ||
        options.isVideo.value
      )
        return
      if (settings.background.bgType === BgType.Online) await options.refreshOnline()
      await ensure({ force: true, immediate: true })
    },
    { immediate: true },
  )

  watch(
    () => [settings.theme.monetColor, settings.background.bgType] as const,
    ([enabled, type]) => {
      if (!enabled || (type !== BgType.Meadow && type !== BgType.Beach)) return
      invalidate()
      disposeMonetWorker()
      const palette = type === BgType.Beach ? beachPalette : meadowPalette
      const sourceKey = type === BgType.Beach ? 'beach' : 'meadow'
      applyStoredMonetColors({ ...palette, sourceKey, timestamp: Date.now() })
      void saveMonetColors(palette.cssLight, palette.cssDark, sourceKey).catch(console.error)
    },
    { immediate: true },
  )

  watch(options.sourceKey, invalidate, { flush: 'sync' })
  onUnmounted(() => {
    invalidate()
    disposeMonetWorker()
  })

  return {
    invalidate,
    ensure,
    onImageLoaded: () => void ensure(),
  }
}
