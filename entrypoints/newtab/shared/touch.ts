import { useMediaQuery } from '@vueuse/core'

export const isOnlyTouchDevice = useMediaQuery('(hover: none) and (pointer: coarse)')
export const isHasTouchDevice = useMediaQuery('(any-pointer: coarse)')

export function isTouchEvent(
  event: MouseEvent | TouchEvent | PointerEvent | Event,
): event is TouchEvent | PointerEvent {
  if (window.PointerEvent && event instanceof PointerEvent) {
    return (event as PointerEvent).pointerType === 'touch'
  }

  return 'touches' in event && (event as TouchEvent).touches.length > 0
}
