import { useWindowSize } from '@vueuse/core'

import { useSettingsStore } from '@/shared/settings'

import { useFocusState } from '@newtab/composables/useFocus'
import { runAfterFirstPaint } from '@newtab/shared/schedule'
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

      const { provider } = settings.yiyan
      const cache = await getYiyanCache()
      const canUseCache = cache?.provider === provider && Boolean(cache.res?.yiyan)

      // 先展示最近一次可用内容；即使需要刷新，也推迟到首屏后，避免启动时阻塞布局。
      if (canUseCache) {
        yiyan.value = cache.res.yiyan
        yiyanOrigin.value = cache.res.yiyanOrigin
      }

      if (canUseCache && isCacheFresh(cache)) {
        return
      }

      const refresh = async () => {
        const res = await yiyanProviders[provider].load()
        if (!res.yiyan) return
        yiyan.value = res.yiyan
        yiyanOrigin.value = res.yiyanOrigin
        await setYiyanCache(provider, res)
      }

      runAfterFirstPaint(refresh)
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
