export function useCompositionInput(onCommittedInput: () => void) {
  const isComposing = ref(false)

  const handleCompositionStart = () => {
    isComposing.value = true
  }

  const handleCompositionEnd = () => {
    isComposing.value = false
    onCommittedInput()
  }

  return {
    isComposing,
    handleCompositionStart,
    handleCompositionEnd,
  }
}
