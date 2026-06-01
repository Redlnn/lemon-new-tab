import { useSwipe, useTimeoutFn } from '@vueuse/core'

export interface UseQuickLinksPagination {
  currentPage: Ref<number>
  totalPages: Ref<number>
  showPagination: ComputedRef<boolean>
  isAnimating: Ref<boolean>
  slideDirection: Ref<'left' | 'right' | null>
  noTransition: Ref<boolean>
  preloadTargetPage: Ref<number | null>
  prevPage: () => void
  nextPage: () => void
  goToPage: (page: number) => void
  setupSwipe: (
    containerRef: Ref<HTMLElement | undefined | null>,
    prevPageRef: Ref<HTMLElement | undefined | null>,
    currentPageRef: Ref<HTMLElement | undefined | null>,
    nextPageRef: Ref<HTMLElement | undefined | null>,
    isDragging?: Ref<boolean>,
    canSwipe?: Ref<boolean> | ComputedRef<boolean>,
  ) => void
}

const ANIMATION_DURATION = 300 // ms

export function useQuickLinksPagination(
  totalItems: Ref<number>,
  itemsPerPage: Ref<number>,
  allowLoop: Ref<boolean> | ComputedRef<boolean> = ref(false),
): UseQuickLinksPagination {
  const currentPage = ref(0)
  const isAnimating = ref(false)
  const slideDirection = ref<'left' | 'right' | null>(null)
  const noTransition = ref(false)
  const preloadTargetPage = ref<number | null>(null)

  const totalPages = computed(() => {
    // 防止除以 0 导致 Infinity
    if (itemsPerPage.value <= 0) {
      return 1
    }
    return Math.max(1, Math.ceil(totalItems.value / itemsPerPage.value))
  })

  // 是否显示分页组件
  const showPagination = computed(() => totalPages.value > 1)

  // 页码变化时确保不越界
  watch(totalPages, (newTotal) => {
    if (currentPage.value >= newTotal) {
      currentPage.value = Math.max(0, newTotal - 1)
    }
  })

  const animateToPage = (targetPage: number, direction: 'left' | 'right') => {
    if (isAnimating.value) return
    if (targetPage < 0 || targetPage >= totalPages.value) return
    if (targetPage === currentPage.value) return

    isAnimating.value = true
    slideDirection.value = direction

    // 动画结束后更新页码
    useTimeoutFn(() => {
      // 禁用 transition，防止内容更新时触发二次动画
      noTransition.value = true
      slideDirection.value = null
      currentPage.value = targetPage
      // 清除预加载标记（如果有）
      preloadTargetPage.value = null

      // 在下一帧恢复 transition
      requestAnimationFrame(() => {
        noTransition.value = false
        isAnimating.value = false
      })
    }, ANIMATION_DURATION)
  }

  const prevPage = () => {
    if (totalPages.value <= 1) return
    if (!allowLoop.value && currentPage.value <= 0) return
    const targetPage = currentPage.value > 0 ? currentPage.value - 1 : totalPages.value - 1
    if (targetPage > currentPage.value) preloadTargetPage.value = targetPage
    animateToPage(targetPage, 'right')
  }

  const nextPage = () => {
    if (totalPages.value <= 1) return
    if (!allowLoop.value && currentPage.value >= totalPages.value - 1) return
    const targetPage = currentPage.value < totalPages.value - 1 ? currentPage.value + 1 : 0
    if (targetPage < currentPage.value) preloadTargetPage.value = targetPage
    animateToPage(targetPage, 'left')
  }

  const goToPage = (page: number) => {
    if (page < 0 || page >= totalPages.value || page === currentPage.value) return

    const distance = Math.abs(page - currentPage.value)
    const direction = page > currentPage.value ? 'left' : 'right'

    // 跨页跳转（距离 > 1）：先将目标页内容预加载到即将滑入的 prev/next 位置
    if (distance > 1) {
      // 设置预加载目标页（组件会据此渲染目标页内容到相邻位置）
      preloadTargetPage.value = page

      // 等待 DOM 更新后再执行翻页动画
      nextTick(() => {
        // 等待一帧确保内容已渲染
        requestAnimationFrame(() => {
          // 执行翻页动画（不清除 preloadTargetPage，让动画期间目标内容保持在相邻位置）
          // preloadTargetPage 会在 animateToPage 动画结束后清除
          animateToPage(page, direction)
        })
      })
    } else {
      // 相邻页直接翻页
      animateToPage(page, direction)
    }
  }

  // 设置滑动手势并保存容器引用
  const setupSwipe = (
    containerRef: Ref<HTMLElement | undefined | null>,
    prevPageRef: Ref<HTMLElement | undefined | null>,
    currentPageRef: Ref<HTMLElement | undefined | null>,
    nextPageRef: Ref<HTMLElement | undefined | null>,
    isDragging?: Ref<boolean>,
    canSwipe?: Ref<boolean> | ComputedRef<boolean>,
  ) => {
    const SWIPE_PAGE_THRESHOLD = 50 // px
    const transX = ref(0)

    const { isSwiping, lengthX } = useSwipe(containerRef, {
      threshold: 10,
      onSwipeStart() {
        noTransition.value = true
      },
      onSwipeEnd() {
        transX.value = 0
        noTransition.value = false
      },
    })

    watch([lengthX, isSwiping], () => {
      if (isDragging?.value || canSwipe?.value === false) {
        transX.value = 0
        return
      }
      if (lengthX.value === 0 || isAnimating.value) return

      if (isSwiping.value) {
        transX.value = -lengthX.value
      } else if (lengthX.value > SWIPE_PAGE_THRESHOLD) {
        nextPage()
      } else if (lengthX.value < -SWIPE_PAGE_THRESHOLD) {
        prevPage()
      }
    })

    const updateTransform = (ref: Ref<HTMLElement | undefined | null>, value: string) => {
      if (ref.value) {
        ref.value.style.transform = value
      }
    }

    watch(transX, () => {
      if (transX.value === undefined) return

      updateTransform(
        prevPageRef,
        transX.value ? `translateX(calc(-100% + ${transX.value}px))` : '',
      )
      updateTransform(currentPageRef, transX.value ? `translateX(${transX.value}px)` : '')
      updateTransform(nextPageRef, transX.value ? `translateX(calc(100% + ${transX.value}px))` : '')
    })
  }

  return {
    currentPage,
    totalPages,
    showPagination,
    isAnimating,
    slideDirection,
    noTransition,
    preloadTargetPage,
    prevPage,
    nextPage,
    goToPage,
    setupSwipe,
  }
}
