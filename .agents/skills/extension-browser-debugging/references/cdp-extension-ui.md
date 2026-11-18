# 用 CDP 加载扩展并调试新标签页（Chromium 降级）

这份参考说明是 [headless-extension-ui.md](headless-extension-ui.md) 的 Chromium 降级路径：Playwright 不可用，或品牌版 Chrome/Edge 忽略 `--load-extension` 时，直接用 DevTools Protocol（CDP）加载构建产物并操作新标签页

## 适用场景与前置条件

- 已通过 `pnpm build` 生成 `.output/chrome-mv3`，Edge 为 `.output/edge-mv3`，不要把 `.output` 当作源码编辑位置
- 已按 [headless-extension-ui.md](headless-extension-ui.md) 的方式确定 Chromium/Edge 的绝对路径；不要猜路径
- 使用独立临时 `--user-data-dir`，避免污染日常浏览器数据
- Node 22+ 自带 `fetch` 与全局 `WebSocket`，不需要安装 Playwright 或其它依赖

## 启动浏览器

```powershell
msedge.exe --headless=new --enable-unsafe-extension-debugging `
  --remote-debugging-port=9333 --user-data-dir=<临时目录> `
  --window-size=1920,1080 about:blank
```

- `--enable-unsafe-extension-debugging` 是 `Extensions.loadUnpacked` 的前置条件；不加会得到“命令不可用”
- Chrome/Edge 137+ 品牌版会忽略 `--disable-extensions-except` 和 `--load-extension`，因此不要依赖这两个参数，改用下一节的 `Extensions.loadUnpacked`
- 启动后先确认 `http://127.0.0.1:9333/json/version` 可访问，并取得 `webSocketDebuggerUrl`

## 连接并加载扩展

连接 browser 级 WebSocket，实现一个按 `id` 分发响应的 `send(method, params, sessionId)`，然后：

```js
const version = await (await fetch('http://127.0.0.1:9333/json/version')).json()
const ws = new WebSocket(version.webSocketDebuggerUrl)
// send：写入 { id, method, params, sessionId }，按响应 id 解析 Promise
const loaded = await send('Extensions.loadUnpacked', { path: '<构建目录绝对路径>' })
const extensionId = loaded.result.id
```

`Extensions.loadUnpacked` 返回的 `id` 就是扩展 ID，不要按路径推导。该命令只在 browser 级会话调用（不要带 `sessionId`）

## 打开页面、交互与截图

```js
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)
await send('Log.enable', {}, sessionId)
await send('Page.navigate', { url: `chrome-extension://${extensionId}/newtab.html` }, sessionId)
```

- 操作/读取：`Runtime.evaluate({ expression, returnByValue: true, awaitPromise: true }, sessionId)`
- 截图：`Page.captureScreenshot`
- 错误：监听 `Runtime.exceptionThrown` 与 `Log.entryAdded`
- 等待：在页面内注入 `requestAnimationFrame` 探针，或轮询 `Runtime.evaluate` 返回的 DOM 状态；不要用固定延时替代状态同步

## 清理

结束本次启动的浏览器时按 PID 关闭（Windows：`taskkill /F /T /PID <浏览器 PID>`），删除临时 profile。不要按进程名批量结束浏览器，避免误杀用户正在使用的窗口

## 限制与报告

手写 CDP 没有 Playwright 的自动等待和语义定位，选择器更脆弱。报告中按“CDP 验证”注明，不要描述成 Playwright 验证；同时写清楚实际加载扩展的方式（`Extensions.loadUnpacked`）和覆盖到的页面/交互

## 常见失败定位

- `Extensions.loadUnpacked` 报命令不可用：确认浏览器由 `--enable-unsafe-extension-debugging` 启动，且命令在 browser 级会话调用
- 扩展没有加载 / `chrome-extension://…` 打不开：检查 `Extensions.loadUnpacked` 的返回值与构建目录是否包含 `manifest.json`；不要只依据 `--load-extension` 参数判断
- `/json/version` 无法访问：确认浏览器已启动、端口未被占用，并检查浏览器 stderr
- 页面或 Worker 报错：保留 `Runtime.exceptionThrown` / `Log.entryAdded`、截图和当前 DOM 状态，回到实际失败路径排查
