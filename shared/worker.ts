/**
 * 开发态先从扩展自身启动 Worker，再由本地引导脚本加载 Vite 模块。
 * Chromium 不允许扩展页面直接使用跨源 URL 作为 Worker 主脚本。
 */
export function createExtensionWorker(workerUrl: string): Worker {
  if (!import.meta.env.DEV) return new Worker(workerUrl)

  const bootstrapUrl = new URL('/dev-worker-bootstrap.js', location.href)
  bootstrapUrl.searchParams.set('url', workerUrl)
  return new Worker(bootstrapUrl, { type: 'module' })
}
