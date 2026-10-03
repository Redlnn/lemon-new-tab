import { createSharedComposable, useEventListener } from '@vueuse/core'
import { onScopeDispose, shallowRef } from 'vue'

/** 所有网格共用滚动帧和该帧的祖先裁剪区域，拖拽命中仍读取即时布局。 */
export const useVirtualGridViewport = createSharedComposable(() => {
  const scrollVersion = shallowRef(0)
  const clippingRects = new Map<
    HTMLElement,
    Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'> | null
  >()
  let frame = 0
  const schedule = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      clippingRects.clear()
      scrollVersion.value++
    })
  }
  useEventListener(window, 'scroll', schedule, { capture: true, passive: true })
  useEventListener(window, 'resize', schedule)
  onScopeDispose(() => cancelAnimationFrame(frame))

  const viewport = (root: HTMLElement | undefined, cached = false) => {
    let top = 0
    let bottom = window.innerHeight
    let left = 0
    let right = window.innerWidth
    for (let parent = root?.parentElement; parent; parent = parent.parentElement) {
      let rect = cached ? clippingRects.get(parent) : undefined
      if (rect === undefined) {
        rect = /(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)
          ? parent.getBoundingClientRect()
          : null
        if (cached) clippingRects.set(parent, rect)
      }
      if (rect) {
        top = Math.max(top, rect.top)
        bottom = Math.min(bottom, rect.bottom)
        left = Math.max(left, rect.left)
        right = Math.min(right, rect.right)
      }
    }
    return { top, bottom, left, right }
  }
  return { scrollVersion, viewport }
})
