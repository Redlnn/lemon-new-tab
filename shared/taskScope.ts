/** 一次界面会话的异步任务：并行任务全部结束才解除忙碌，旧会话只完成工作、不再回填。 */
export function createTaskScope(busy: (value: boolean) => void, error: (cause: unknown) => void) {
  let generation = 0
  let pending = 0
  return {
    reset() {
      generation++
      pending = 0
      busy(false)
    },
    async run<T>(work: (isCurrent: () => boolean) => Promise<T>, apply?: (value: T) => void) {
      const current = generation
      const isCurrent = () => generation === current
      pending++
      busy(true)
      try {
        const value = await work(isCurrent)
        if (isCurrent()) apply?.(value)
      } catch (cause) {
        if (isCurrent()) error(cause)
      } finally {
        if (isCurrent()) busy(--pending > 0)
      }
    },
  }
}
