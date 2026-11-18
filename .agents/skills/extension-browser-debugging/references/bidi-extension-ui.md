# 用 WebDriver BiDi 加载扩展并调试新标签页（Firefox 降级）

这份参考说明是 [headless-extension-ui.md](headless-extension-ui.md) 的 Firefox 降级路径：没有可用的 Playwright 时，通过 WebDriver BiDi 安装临时扩展并操作新标签页

## 适用场景与前置条件

- 已通过 `pnpm build:firefox` 生成 `.output/firefox-mv2`，不要把 `.output` 当作源码编辑位置
- 已按 [headless-extension-ui.md](headless-extension-ui.md) 的方式确定 Firefox 的绝对路径；不要猜路径
- 需要 geckodriver 或其它提供 WebDriver BiDi 端点的驱动；没有 BiDi 端点时明确报告缺少 Firefox 自动化能力，不要用 Chromium 结果代替 Firefox 验证
- 使用独立临时 profile，并在结束时按本次启动的 PID 关闭 Firefox / geckodriver

## 创建 BiDi 会话

启动 geckodriver，向 `/session` 发送包含 Firefox binary、无头参数和 `webSocketUrl: true` 的 capabilities，然后连接响应中的 `webSocketUrl`：

```json
{
  "capabilities": {
    "alwaysMatch": {
      "browserName": "firefox",
      "webSocketUrl": true,
      "moz:firefoxOptions": {
        "binary": "<firefox 绝对路径>",
        "args": ["-headless"]
      }
    }
  }
}
```

连接建立后通过带 `id` 的消息调用 BiDi 命令；具体会话建立细节（是否由驱动创建会话、WebSocket 地址字段）按所用驱动版的 WebDriver BiDi 文档为准

## 安装临时扩展

```js
const installed = await bidi.send('webExtension.install', {
  extensionData: { type: 'path', path: '<构建目录绝对路径>' },
})
// installed.extension 是临时扩展 id，用于 moz-extension://<id>/newtab.html
```

- `extensionData.type` 使用 `path`，路径必须是绝对路径，目录内需有 `manifest.json`
- 扩展 id 由 `webExtension.install` 返回（通常是 UUID），不要按路径推导
- 结束时可用 `webExtension.uninstall` 清理临时扩展

## 打开页面、交互与截图

```js
const { context } = await bidi.send('browsingContext.create', { type: 'tab' })
await bidi.send('browsingContext.navigate', {
  context,
  url: `moz-extension://${installed.extension}/newtab.html`,
  wait: 'complete',
})
```

随后用 `script.evaluate` 执行页面脚本并轮询真实状态，不要用固定延时替代状态同步；用 `browsingContext.captureScreenshot` 截图，监听 `log.entryAdded` 收集页面错误

## 清理

按本次启动的 PID 关闭 Firefox 与 geckodriver，删除临时 profile；不要按进程名批量结束浏览器，避免误杀用户正在使用的窗口

## 限制与报告

BiDi 降级脚本需要自己处理会话、事件和等待，能力边界与 Playwright 不同。报告中按“BiDi 验证”注明，写清楚实际使用的驱动、Firefox 版本和覆盖到的页面/交互

## 常见失败定位

- 没有 geckodriver / BiDi 端点：明确报告缺少 Firefox 自动化能力，不要伪造 Firefox 验证结果
- `webExtension.install` 失败：确认 `extensionData.type` 为 `path`、路径为绝对路径、构建目录包含 `manifest.json`，且驱动支持 `webExtension` 模块
- `moz-extension://…` 打不开：检查扩展安装返回的 id、Manifest 的 `chrome_url_overrides.newtab` 与构建目标
- 页面报错或状态未就绪：保留 `log.entryAdded`、截图和关键 DOM/存储状态，回到实际失败交互路径排查
