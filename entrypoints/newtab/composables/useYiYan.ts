import { useWindowSize } from '@vueuse/core'

import { useSettingsStore } from '@/shared/settings'

import { useFocusStore } from '@newtab/shared/store'
import { getYiyanCache, isCacheFresh, setYiyanCache, yiyanProviders } from '@newtab/shared/yiyan'

export function useYiYan() {
  const focusStore = useFocusStore()
  const settings = useSettingsStore()
  const { height } = useWindowSize({ type: 'visual' })

  const yiyan = ref<string>()
  const yiyanOrigin = ref<string>()

  const load = async () => {
    try {
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
