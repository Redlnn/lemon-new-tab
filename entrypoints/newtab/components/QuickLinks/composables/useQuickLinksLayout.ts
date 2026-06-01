import { useDebounceFn, useWindowSize } from '@vueuse/core'

import { useSettingsStore } from '@/shared/settings'

import { isOnlyTouchDevice } from '@newtab/shared/touch'

/**
 * 列优先网格求解
 * @param n     当前页需要的格子数
 * @param cMax  最大列
 * @param rMax  最大行
 */
export function solveGridColumnFirst(n: number, cMax: number, rMax: number) {
  if (n <= 0) return { cols: 1, rows: 1 }

  const cols = Math.min(cMax, n)
  const rows = Math.min(rMax, Math.ceil(n / cols))
  return { cols, rows }
}

export function usePagedGridLayout() {
  const settings = useSettingsStore()
  const { width: windowWidth, height: windowHeight } = useWindowSize({ type: 'visual' })

  // 单个项目宽度（图标 + 左右内边距各15px）
  const getItemWidth = () => settings.quickLinks.iconSize + 30

  // 计算在当前窗口宽度下可容纳的最大列数
  const computeFitColumns = () => {
    const containerWidth = windowWidth.value * 0.85
    const marginH = settings.quickLinks.spacing.itemGapX
    const unitWidth = getItemWidth() + marginH
    let extra = 40 // 预留padding空间
    if (!isOnlyTouchDevice.value && settings.quickLinks.paging) {
      // 多页模式下预留分页按钮和间距空间
      extra += 80
    }

    // 假设有 n 列，则总宽度为 n * unitWidth - marginH + extra
    // 其中 - marginH 是因为最后一列不需要右侧间距
    // 要求这个总宽度小于等于 containerWidth
    // 因此有不等式
    // n * unitWidth - marginH + extra <= containerWidth
    // n < (containerWidth + marginH - extra) / unitWidth
    const raw = Math.floor((containerWidth + marginH - extra) / unitWidth)
    return Math.max(1, Math.min(settings.quickLinks.layout.columns, raw))
  }

  // 最大列数
  const maxFitCols = ref(settings.quickLinks.layout.columns)

  const updateMaxCols = useDebounceFn(() => {
    maxFitCols.value = computeFitColumns()
  }, 100)

  // 纯最大行数
  const maxFitRows = computed(() =>
    windowHeight.value < 450 ? 1 : settings.quickLinks.layout.rows,
  )

  return { updateMaxCols, maxFitCols, maxFitRows }
}

export function useDockLayout() {
  const settings = useSettingsStore()
  const { width: windowWidth } = useWindowSize({ type: 'visual' })

  // 单个项目宽度（图标 + 左右内边距各15px）
  const getItemWidth = () => settings.dock.iconSize + 30

  // 计算在当前窗口宽度下可容纳的最大列数
  const computeFitColumns = () => {
    const containerWidth = windowWidth.value
    const marginH = settings.dock.gap
    const unitWidth = getItemWidth() + marginH

    // 假设有 n 列，则总宽度为 n * unitWidth - marginH
    // 其中 - marginH 是因为最后一列不需要右侧间距
    // 要求这个总宽度小于等于 containerWidth
    // 因此有不等式
    // n * unitWidth - marginH <= containerWidth
    // n < (containerWidth + marginH) / unitWidth
    const raw = Math.floor((containerWidth + marginH) / unitWidth)
    return Math.max(1, settings.dock.limitCount ? Math.min(settings.dock.maxCount, raw) : raw)
  }

  // 最大列数
  const maxFitCols = ref(settings.dock.maxCount)

  const updateMaxCols = useDebounceFn(() => {
    maxFitCols.value = computeFitColumns()
  }, 100)

  return { updateMaxCols, maxFitCols }
}
