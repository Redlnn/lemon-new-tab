---
name: extension-browser-debugging
description: 调试本 WXT 浏览器扩展的构建产物和新标签页 UI，使用 Playwright 或降级的浏览器协议（Chromium CDP / Firefox WebDriver BiDi）启动无头浏览器、加载未打包扩展、打开扩展页面并执行可观察的交互验证。
metadata:
  short-description: 使用无头浏览器（Playwright/CDP/BiDi）调试扩展新标签页
---

# 扩展浏览器调试

浏览器扩展无法通过打开 Vite 测试页进行调试和预览，只有当任务必须要验证或诊断本扩展的存储、Service Worker、`chrome-extension://` 类似页面或新标签页行为时才使用本 Skill。优先复用 Skill 自带的示例和当前项目稳定选择器；纯 TypeScript/业务逻辑测试不需要启动扩展浏览器，测试 UI 可以临时创建不依赖浏览器环境的 Vite 页面使用假数据测试

## 两种调试路径

- 源码级浏览器测试：启动 Vite 测试页，在真实浏览器中执行 IndexedDB、迁移、事务或合并逻辑；只替换不属于目标逻辑的扩展 API。
- 构建产物 UI 测试：使用 `pnpm build` 生成的 `.output/[browser]-mv[2/3]`，以独立持久化上下文加载未打包扩展，直接打开扩展新标签页并操作 UI

需要真实扩展运行时、页面交互或截图时，阅读 [references/headless-extension-ui.md](references/headless-extension-ui.md)，并按需复制或改造 [examples/extension-ui-debug.mjs](examples/extension-ui-debug.mjs)。需要理解 Vite 测试页和 mock 边界时，阅读 [references/source-browser-tests.md](references/source-browser-tests.md) 及 [examples/source-browser-vite.mjs](examples/source-browser-vite.mjs)。

## 浏览器自动化后端

按以下顺序选择后端，并在最终报告里注明实际使用哪一种；不要默认 Playwright 一定存在。

1. 当前环境提供 `load_workspace_dependencies`（该工具仅在 Codex 环境内置）时，调用它取得 Node.js 可执行文件和 Node.js packages 路径，优先从返回的 packages 路径解析 `playwright`。
2. 没有该工具，或返回值中没有 Playwright 时，检查项目是否安装 Playwright：`node_modules/playwright`、`require.resolve('playwright')` 或项目的 `PLAYWRIGHT_MODULE`。
3. 项目也没有时，检查 Playwright 的默认全局安装位置：npm/pnpm 全局根目录下的 `playwright`/`playwright-core`，以及 `PLAYWRIGHT_BROWSERS_PATH`、`%LOCALAPPDATA%\ms-playwright` 等浏览器缓存；找到后把 `PLAYWRIGHT_MODULE` 指向对应包
4. 以上都没有时降级：Chromium 系（Chrome/Edge）使用 DevTools Protocol（CDP），流程见 [references/cdp-extension-ui.md](references/cdp-extension-ui.md)；Firefox 使用 WebDriver BiDi，流程见 [references/bidi-extension-ui.md](references/bidi-extension-ui.md)

Playwright 可用时按 [examples/extension-ui-debug.mjs](examples/extension-ui-debug.mjs) 执行；扩展 UI 的 Playwright 细节见 [references/headless-extension-ui.md](references/headless-extension-ui.md)，降级流程见 [CDP](references/cdp-extension-ui.md) / [BiDi](references/bidi-extension-ui.md) 文档。

## 工作约束

1. 浏览器自动化后端遵循上面的选择顺序；`load_workspace_dependencies` 不是所有环境都有，不能假设 Playwright 可用
2. 测试脚本放在项目临时目录，验证后删除，不要提交
3. 先检查项目根目录的 `web-ext.config.ts` 是否存在；若存在，读取其中 `binaries.chrome`、`binaries.edge` 和 `binaries.firefox` 的候选路径，并确认文件存在。缺少配置或路径失效时，再从环境变量、系统命令或平台安装位置探测 Chrome、Edge 和 Firefox。根据目标浏览器把结果传给对应的启动配置；如果找不到目标浏览器，先报告缺少浏览器，不要猜路径
4. 构建产物路径默认是 `.output/chrome-mv3`，不要把 `.output` 当作源码编辑位置。其他浏览器为 `.output/edge-mv3` 和 `.output/firefox-mv2`
5. 使用持久化上下文：Playwright 用 `launchPersistentContext`；CDP 用独立 `--user-data-dir`；BiDi 用独立 Firefox profile。扩展的 Service Worker、`chrome.storage` 和 IndexedDB 都依赖持久化 profile。
6. 加载未打包扩展：
   - Chromium：同时传 `--disable-extensions-except=<绝对路径>` 与 `--load-extension=<绝对路径>`；但 Chrome/Edge 137+ 的品牌版会忽略这两个参数，须追加 `--enable-unsafe-extension-debugging`，若使用 CDP 则要在会话中调用 `Extensions.loadUnpacked({ path: <绝对路径> })`，使用返回的 `id`。不要因为参数传了就当扩展已加载
   - Firefox：使用 Playwright 的 Firefox 持久化上下文。或通过 WebDriver BiDi 的 `webExtension.install`（`extensionData: { type: 'path', path: <绝对路径> }`）安装临时扩展
   - profile 使用独立临时目录，避免污染日常浏览器数据。
7. 等待扩展就绪后再打开页面：Playwright 等 `serviceWorkers()`；CDP 用 `Extensions.loadUnpacked` 返回的 `id`（不要猜 id）；BiDi 用 `webExtension.install` 返回的扩展 id（`moz-extension://<uuid>/`）。随后导航到 `newtab.html`。
8. 用可访问名称、稳定 class 或明确的状态条件操作页面；关键异步行为等待真实状态，不用固定延时。监听页面异常：Playwright `pageerror`、CDP `Runtime.exceptionThrown` / `Log.entryAdded`、BiDi `log.entryAdded`。
9. 测试完成后关闭 context/browser 并清理脚本，关闭时指定 PID，避免把用户打开的浏览器一起关掉。截图和 profile 可留在系统临时目录供诊断，但不要加入仓库，后续测试时可使用已创建的 profile，避免重复创建上下文

## 推荐调试闭环

先复现并记录页面、Worker、控制台错误和关键状态；再用最小的浏览器操作验证根因假设；修改代码后重新构建并重复同一场景。若扩展无法加载，先检查浏览器版本、Manifest、构建目录、启动参数和后端选择，再检查页面代码
