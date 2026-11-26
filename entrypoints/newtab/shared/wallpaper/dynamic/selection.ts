import { computed, ref } from 'vue'

import { BgType, DYNAMIC_BG_TYPES, isDynamicBgType, type DynamicBgType } from '@/shared/enums'
import { useSettingsStore } from '@/shared/settings'

// 页面内状态不写入共享设置，每个新标签页各自选择场景。
const randomType = ref<DynamicBgType>(
  DYNAMIC_BG_TYPES[Math.floor(Math.random() * DYNAMIC_BG_TYPES.length)]!,
)
const override = ref<BgType | null>(null)
const failed = new Set<DynamicBgType>()

export function useDynamicSelection() {
  const settings = useSettingsStore()
  const current = computed(
    () =>
      override.value ??
      (settings.background.dynamic.random && isDynamicBgType(settings.background.bgType)
        ? randomType.value
        : settings.background.bgType),
  )

  const choose = (excluded: ReadonlySet<DynamicBgType> = new Set()) => {
    const candidates = DYNAMIC_BG_TYPES.filter((type) => !excluded.has(type))
    if (!candidates.length) return false
    randomType.value = candidates[Math.floor(Math.random() * candidates.length)]!
    override.value = randomType.value
    return true
  }

  const select = (type: DynamicBgType) => {
    failed.clear()
    if (settings.background.dynamic.random) override.value = type
    else {
      override.value = null
      settings.background.bgType = type
    }
  }

  const enableRandom = () => {
    failed.clear()
    if (isDynamicBgType(current.value)) override.value = current.value
    else {
      choose()
      settings.background.bgType = randomType.value
    }
    settings.background.dynamic.random = true
  }

  const retry = (type: DynamicBgType) => {
    failed.add(type)
    if (choose(failed)) return true
    failed.clear()
    override.value = BgType.None
    return false
  }

  const clearOverride = () => {
    failed.clear()
    override.value = null
  }

  return { current, select, enableRandom, retry, clearOverride }
}
