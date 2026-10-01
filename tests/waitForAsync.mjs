/** 在测试进程中等待异步条件，避免浏览器轮询将 Promise 本身视为真值。 */
export async function waitForAsync(page, predicate, options = {}) {
  const deadline = Date.now() + (options.timeout ?? 30000)
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Async condition timed out: ${predicate}`)
}
