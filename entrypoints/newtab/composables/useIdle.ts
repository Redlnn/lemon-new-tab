import { useIdle } from '@vueuse/core'

const { idle } = useIdle(5_000, {
  events: ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'],
  listenForVisibilityChange: false
})

export function useIdleHide() {
  return idle
}
