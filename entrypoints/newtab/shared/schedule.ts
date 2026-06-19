/**
 * 等浏览器有机会绘制首屏后再 resolve，并在支持时让出到空闲时间。
 * 用于不应与首屏渲染竞争的非关键任务。
 */
export function waitForFirstPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (typeof window.requestIdleCallback === 'function') {
          window.requestIdleCallback(() => resolve(), { timeout: 500 })
        } else {
          window.setTimeout(resolve, 0)
        }
      })
    })
  })
}

export async function afterFirstPaint<T>(task: () => T | Promise<T>): Promise<T> {
  await waitForFirstPaint()
  return await task()
}

export function runAfterFirstPaint(task: () => void | Promise<void>): void {
  void afterFirstPaint(task).catch((error) => {
    console.error('[newtab] Deferred task failed:', error)
  })
}
