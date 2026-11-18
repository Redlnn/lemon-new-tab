# 源码级浏览器测试

这份参考说明描述如何在 Vite 临时页面中运行源码级浏览器测试。它适合验证共享模块的 IndexedDB、迁移、事务、合并和资源校验逻辑，不等同于加载真实扩展。可运行的最小骨架是 [examples/source-browser-vite.mjs](../examples/source-browser-vite.mjs)，配套 mock 位于同一目录；[examples/browser-test-module.mjs](../examples/browser-test-module.mjs) 提供真实 IndexedDB 读写与清理的最小测试模块

## 运行模型

脚本创建一个关闭自动发现的 Vite 服务，并仅把不属于目标逻辑的扩展依赖替换成 mock。页面打开后，在浏览器上下文中动态导入测试模块，保证 IndexedDB 使用真实浏览器实现

源码级测试使用普通 `browser.newPage()` 是有意的：测试页面不是扩展页面，不需要 Manifest、扩展 ID 或 Service Worker。若任务涉及真实扩展 UI，应改用 [headless-extension-ui.md](headless-extension-ui.md) 的持久化 context 流程

示例使用 Playwright；如果当前环境没有 Playwright，按 [headless-extension-ui.md](headless-extension-ui.md) 的“后端选择”顺序降级（Vite 页面同样可以用 CDP/BiDi 打开），不要假设 Playwright 一定存在

## Mock 边界

- storage mock 只提供测试所需的 `defineItem`、`getItem`、`setItem` 等最小接口
- settings mock 可以复用生产默认设置与 normalize 逻辑，只替换设置存储
- IndexedDB 仍由浏览器执行，因此可以覆盖真实事务回滚、并发写入和 Blob 行为

不要把 mock 测试结果描述成完整扩展验证；它不能覆盖真实 Manifest、Service Worker 启动、页面渲染、用户交互、浏览器权限或在线请求。测试结束时清理 IndexedDB，并关闭 Vite server 和 browser。关闭浏览器时需指定 PID 避免把用户一打开的浏览器也一起关掉

## 运行和扩展

```powershell
$env:PLAYWRIGHT_MODULE = 'C:/path/to/node_modules/playwright'
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
$env:BROWSER_TEST_MODULE = '/skills/extension-browser-debugging/examples/browser-test-module.mjs'
node skills/extension-browser-debugging/examples/source-browser-vite.mjs
```

`BROWSER_TEST_MODULE` 是 Vite 页面可访问的绝对 URL；新增模块放在项目根目录内，并沿用示例的 `runBrowserTests()` 返回字符串数组。让失败断言直接中断，并清理自己写入的 IndexedDB key，避免依赖执行顺序
