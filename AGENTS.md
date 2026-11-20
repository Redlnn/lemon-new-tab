# AGENTS.md

这是一个基于 WXT、Vue 3 与 TypeScript 的浏览器新标签页扩展。

## 定位代码

- 产品与开发说明见 [README.md](README.md) 和 [README_en.md](README_en.md)，发布历史见 [docs/CHANGELOG.md](docs/CHANGELOG.md)。
- 新标签页从 [init.ts](entrypoints/newtab/init.ts) 启动，经 [main.ts](entrypoints/newtab/main.ts) 挂载 [App.vue](entrypoints/newtab/App.vue)。
- 后台入口见 [entrypoints/background/index.ts](entrypoints/background/index.ts)，共享设置、WebDAV 同步和主题分别位于 [shared/settings](shared/settings)、[shared/webdavSync](shared/webdavSync) 和 [shared/theme](shared/theme)。
- 壁纸切换入口见 [Background.vue](entrypoints/newtab/components/Background.vue)，动态场景和渲染器位于 [wallpaper](entrypoints/newtab/shared/wallpaper)。
- Manifest、权限与浏览器差异集中在 [wxt.config.ts](wxt.config.ts)。

## 变更约束

- 先检查工作区和暂存区，保留与任务无关的改动。
- 优先使用 Vue SFC 的 `script setup` 与 TypeScript，复用 `@/*`、`@newtab/*` 路径别名。
- 样式优先使用 class 选择器和现代 CSS；尽量避免 `scoped`、标签名与 ID 选择器。仅在现代 CSS 无法等价表达时少量使用 SCSS 特性。
- 以简洁、高效、低复杂度为优先，避免过度设计、抽象和冗余；若修补会堆叠大量条件或临时兼容层，优先重写受影响的局部实现。
- 不手动编辑生成声明：[types/auto-imports.d.ts](types/auto-imports.d.ts)、[types/components.d.ts](types/components.d.ts)。
- 新增或重命名 i18n 键时，同步更新 [locales](locales) 中所有语言的对应命名空间。命名空间注册和异步资源加载见 [shared/i18n.ts](shared/i18n.ts)，本机语言偏好见 [shared/uiPreferences.ts](shared/uiPreferences.ts)。

## 设置与后台边界

- 删除或改名设置项时，同步更新 [当前 Schema](shared/settings/current.ts)、[迁移注册](shared/settings/settingsStorage.ts)、[迁移实现](shared/settings/migrate) 与 [默认值](shared/settings/default.ts)。新增设置项沿用当前配置版本。
- 保持 [shared/settings/bootstrap.ts](shared/settings/bootstrap.ts) 的启动兼容逻辑稳定。
- 修改 WebDAV 后台同步时，沿用 [SyncCoordinator](shared/webdavSync/coordinator.ts) 的触发合并和独占任务队列，并保留后台应用远端数据时对存储变更触发的抑制。

## 动态壁纸与 Worker

- 修改渲染器时，沿用 [useDynamicWallpaper](entrypoints/newtab/shared/wallpaper/dynamic/useDynamicWallpaper.ts) 的暂停、卸载和 WebGL 上下文恢复流程。地图在连续窗口缩放期间保留已有画面，新露出的区域显示底色，等缩放稳定后再请求 Worker 重绘。详见 [mapScene.ts](entrypoints/newtab/shared/wallpaper/map/mapScene.ts)。
- 新增浏览器 Worker 时，使用 Vite 的 `?worker&url` 和 [createExtensionWorker](shared/worker.ts)。Chromium 开发模式通过扩展同源引导脚本加载 Vite 模块，并缓冲模块就绪前收到的消息。Firefox 开发模式直接加载 Vite 模块 Worker。
- 开发模式下，从 Vite 加载后用于 Canvas 像素读取或 WebGL 上传的图片，应在赋值 `src` 前设置 `crossOrigin = 'anonymous'`。[wxt.config.ts](wxt.config.ts) 的 Vite CORS 配置同时服务这些图片和 Firefox 模块 Worker。

## 验证

- 测试只在能覆盖真实风险、回归场景或关键行为时编写；断言应能在目标行为被破坏时失败，不为测试数量或通过率添加必然通过的测试。
- 修改 TypeScript 或 Vue 时运行 `pnpm type-check`。
- 静态检查使用 `pnpm lint:check`。使用 `pnpm lint` 自动修复后复查附带改动。
- 修改 Manifest、构建或浏览器差异时，运行对应的 `pnpm build`、`pnpm build:edge` 或 `pnpm build:firefox`。
- 验证真实扩展 UI、Service Worker、扩展存储或新标签页交互时，使用 [extension-browser-debugging](.agents/skills/extension-browser-debugging/SKILL.md) 在独立浏览器 profile 中加载扩展。修改开发模式专用路径时，再用对应的 `pnpm dev`、`pnpm dev:edge` 或 `pnpm dev:firefox` 验证。

## 提交

提交信息以 gitmoji 开头，后接简短中文描述；按独立功能拆分提交，避免混入格式化或无关改动。
