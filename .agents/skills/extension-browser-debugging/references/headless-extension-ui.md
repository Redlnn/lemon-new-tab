# 构建扩展并用无头浏览器操作新标签页

这份参考说明描述用 Playwright 调试 Chrome MV3 构建产物的流程。Playwright 可用时，完整的可复制脚本见 [examples/extension-ui-debug.mjs](../examples/extension-ui-debug.mjs)

Playwright 不可用时，改用降级流程：[CDP（Chromium）](cdp-extension-ui.md) 或 [WebDriver BiDi（Firefox）](bidi-extension-ui.md)

## 后端选择

按以下顺序确定浏览器自动化后端，并在报告中注明实际使用哪一种；不要默认 Playwright 一定存在。

1. 当前环境提供 `load_workspace_dependencies`（该工具仅在 Codex 环境内置）时，调用它，使用返回的 Node.js executable 和 Node.js packages 路径，优先从返回的 packages 路径解析 `playwright`。
2. 没有该工具，或返回值里没有 Playwright 时，检查项目是否安装：

   ```powershell
   Test-Path node_modules\playwright
   node -e "console.log(require.resolve('playwright'))"
   ```

3. 项目也没有时，检查默认的全局安装位置：

   ```powershell
   npm root -g
   pnpm root -g
   Test-Path "$env:LOCALAPPDATA\ms-playwright"
   $env:PLAYWRIGHT_MODULE
   $env:PLAYWRIGHT_BROWSERS_PATH
   ```

   找到后把 `PLAYWRIGHT_MODULE` 指向对应的 packages 目录。

4. 都没有时降级：Chromium/Chrome/Edge 使用 [CDP](cdp-extension-ui.md)，Firefox 使用 [WebDriver BiDi](bidi-extension-ui.md)。降级脚本放在临时目录（如 `.measure/`），验证后删除，不要提交。

再确认目标浏览器。优先检查项目根目录的 `web-ext.config.ts`：如果存在，读取 `binaries.chrome`、`binaries.edge` 和 `binaries.firefox`，只使用实际存在的路径。配置缺失或路径失效时，再从环境变量、系统命令或平台安装位置探测 Chrome、Edge 和 Firefox；不要把当前机器的路径复制进 Skill 或脚本

Chromium/Chrome/Edge 测试使用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`；Firefox 测试使用 Firefox 对应的 Playwright 启动器和探测到的 Firefox executable：

```powershell
$env:PLAYWRIGHT_MODULE = Join-Path $bundledNodePackages 'playwright'
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE = $detectedChromiumExecutable
& $bundledNodeExecutable .agents/skills/extension-browser-debugging/examples/extension-ui-debug.mjs
```

其中 `$bundledNodePackages`、`$bundledNodeExecutable`、`$detectedChromiumExecutable` 和 `$detectedFirefoxExecutable` 是运行时发现的值，不是固定配置

## 加载扩展：品牌版的限制

Chrome/Edge 137+ 的**品牌版**会忽略 `--disable-extensions-except` 和 `--load-extension`，只有 Chromium、Chrome for Testing 等非品牌构建仍支持这两个参数，须追加 `--enable-unsafe-extension-debugging`。因此 Playwright 可能启动成功，但扩展没有被加载；不要只看浏览器启动成功就认为扩展已加载

构建产物路径默认是 `.output/chrome-mv3`，不要把 `.output` 当作源码编辑位置；其他浏览器为 `.output/edge-mv3` 和 `.output/firefox-mv2`。使用独立临时 profile，避免污染日常浏览器数据；调试时可将 headless 暂时改成 `false`

## Playwright 启动和加载

使用 `launchPersistentContext`，因为扩展的 Service Worker、`chrome.storage` 和 IndexedDB 属于浏览器上下文

## 打开扩展新标签页

先等待 Service Worker，再从 `worker.url()` 推导扩展 ID 和 `newtab.html` 地址。不要猜测扩展 I，也不必操作浏览器的“新建标签”按钮：在 context 中创建页面并导航到扩展内部 URL，就能获得等价的新标签页运行环境

```js
const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'))
const newtabUrl = new URL('newtab.html', worker.url()).href
const page = await context.newPage()
await page.goto(newtabUrl)
```

## 交互和诊断

优先使用可访问角色、精确名称和稳定 class；关键异步行为用定位器等待或 `waitForFunction` 等待真实状态，不用固定延时代替同步。监听 `pageerror`，并在失败时保留截图、扩展 ID、页面 URL 和关键 DOM/存储状态

随附示例覆盖菜单导航和截图；其他交互按当前任务的稳定选择器补充

## 常见失败定位

- `require('playwright')` 失败：按“后端选择”顺序检查当前环境工具、项目安装和全局安装；都不可用时改用 CDP/BiDi，不要假设 Playwright 存在。
- 浏览器启动失败：检查 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 的绝对路径和浏览器与 Playwright 的兼容性
- 没有 Service Worker：确认构建目录包含 `manifest.json`、`background.js`，且加载参数指向目录而非 zip
- 加载扩展参数被忽略：换用支持未打包扩展加载的 Chromium/Edge；不要仅凭普通网页可打开推断扩展已加载
- 页面报错或状态未就绪：保留 `pageerror`、截图和关键 DOM/存储状态，回到实际失败交互路径排查
