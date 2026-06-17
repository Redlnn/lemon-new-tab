import { useEventListener } from '@vueuse/core'

export function useImeAwareDialog() {
  const isComposing = ref(false)

  const handleCompositionStart = () => {
    isComposing.value = true
  }

  const handleCompositionEnd = () => {
    isComposing.value = false
  }

  useEventListener(document, 'compositionstart', handleCompositionStart)
  useEventListener(document, 'compositionend', handleCompositionEnd)

  return { isComposing }
}
