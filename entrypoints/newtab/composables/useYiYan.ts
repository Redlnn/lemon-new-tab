import { useWindowSize } from '@vueuse/core'

import { useSettingsStore } from '@/shared/settings'

import { useFocusState } from '@newtab/composables/useFocus'
import { getYiyanCache, isCacheFresh, setYiyanCache, yiyanProviders } from '@newtab/shared/yiyan'

export function useYiYan() {
  const focusStore = useFocusState()
  const settings = useSettingsStore()
  const { height } = useWindowSize({ type: 'visual' })

  const yiyan = ref<string>()
  const yiyanOrigin = ref<string>()

  const load = async () => {
    try {
      if (settings.yiyan.provider === 'custom') {
        const lines = settings.yiyan.customLines
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0)
        if (lines.length === 0) return
        const line = lines[Math.floor(Math.random() * lines.length)]
        yiyan.value = line.replace(/\\n/g, '\n')
        yiyanOrigin.value = undefined
        return
      }

      const cache = await getYiyanCache()
      if (isCacheFresh(cache) && cache?.provider === settings.yiyan.provider) {
        const { res } = cache
        yiyan.value = res?.yiyan
        yiyanOrigin.value = res?.yiyanOrigin
      } else {
        const res = await yiyanProviders[settings.yiyan.provider].load()
        yiyan.value = res.yiyan
        yiyanOrigin.value = res.yiyanOrigin
        await setYiyanCache(settings.yiyan.provider, res)
      }
    } catch (err) {
      console.error('YiYan load error', err)
    }
  }

  const isEnabled = computed(() => {
    if (!yiyan.value) return false
    if (settings.yiyan.alwaysShow) {
      if (settings.quickLinks.useScroll) {
        return true
      }

      // 限制700px只能保证2行快速访问，再多就不行了
      if (!focusStore.isFocused && height.value < 700) {
        return false
      }
      return true
    } else {
      return focusStore.isFocused
    }
  })

  return { yiyan, yiyanOrigin, load, isEnabled }
}
