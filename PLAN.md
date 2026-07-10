# 保持功能等价的三阶段简化计划

## 目标

移除过度设计、过度工程和、意外复杂度、时间复杂度高、过度抽象、不必要的间接层、仪式性代码、样板代码。当前计划还没有考虑 f046773 之后新增的代码，因此需要进行一次 review 和补充。

## 总体原则

- 保持现有 UI、动画、设置结构、同步协议、浏览器兼容性和 favicon 命中能力。
- 不升级设置 Schema 版本，不删除历史迁移和同步兼容消息。
- 优先删除重复状态、重复请求和重复业务代码；不创建通用框架或大型基类。
- 每阶段独立提交、独立验证，避免一次性大范围重构。

## 阶段一：请求去重与回归基础

- 加入最小 Vitest 配置和 `test` 脚本，只测试纯逻辑及可模拟的异步流程，不引入 Vue 组件测试框架。
- 将 favicon 的缓存开关分支统一到 `runFaviconStrategies` 调度器，但保持现有策略顺序：
  - 缓存关闭：Chromium API → 第三方服务 → Image 探测。
  - 缓存开启且有权限：页面声明 → 常见路径 → 第三方服务 → Image 探测。
  - 缓存开启但无权限：第三方服务 → Image 探测。
- 所有同 origin 请求复用一个进行中的 Promise；并发策略取得有效结果后取消其他 fetch、计时器和 Image 探测，继续保留 L1/L2、TTL、引用计数和后台刷新。
- 新建单一 `useTopSitesStore`，负责 raw top-sites、缓存、加载任务和 blocked-sites 监听；初次挂载、Dock 和 Launchpad 同时请求时只执行一次 `browser.topSites.get()`。
- 删除 `force=true` 绕过进行中请求的行为；隐藏、恢复站点时先显式失效缓存，再复用同一刷新任务。

验收：缓存开关与权限组合下图标结果和回退顺序不变；QuickLinks 与 Dock 同时启用时，一个缓存周期只有一次 top-sites 浏览器调用。

## 阶段二：整合快速导航数据和重复 UI

- 将 quick-links storage 监听收回现有 `useQuickLinksStore`：`init()` 只注册一次，`deinit()` 清理监听及 favicon 引用。
- 删除 `useQuickLinksData` 的全局监听 Set 和各组件的 `quickLinks/topSites/mounted/topSitesNeedsReload` 副本。
- QuickLinks、Dock、Launchpad 直接读取 `useQuickLinksStore` 和 `useTopSitesStore`；各视图仅保留布局、分页、搜索等展示状态，并通过 `mergeTopSites` 计算自己的可见结果。
- 提取两个小型纯函数：
  - `toDisplayItemFromDndData`：统一 DnD 数据到展示项的转换。
  - `persistQuickLinkDrop`：统一 top-site 固定、扁平排序、组内排序和跨组移动，返回 `{ changed, needsRemount }`。
- 保留 QuickLinks 与 Launchpad 各自的落点计算，因为分页和分组布局不同，不建立通用拖拽框架。
- 新建轻量 `LaunchpadLinkItem.vue`，统一链接、favicon、标题、固定标识和右键事件，替换 Launchpad 中四套重复模板。
- 不重写现有分页动画、边缘翻页、触摸长按和 Dock 缩放逻辑。

验收：扁平/分组、分页/滚动、Dock/Launchpad、搜索、右键菜单、长按、组内及跨组拖拽行为与当前一致；一次存储变化不再触发三套独立数据加载。

## 阶段三：收敛同步、弹窗与背景间接层

- 在设置迁移域提供唯一接口：
  - `SupportedSettingsSchema`
  - `migrateSettingsToCurrent(input): Promise<{ settings: CURRENT_CONFIG_SCHEMA; migrated: boolean }>`
- 本地 storage migrations 和云同步共同使用同一迁移步骤注册表；保留 WXT 所需的逐版本 adapter，移除同步 Store 内第二套迁移表和循环。
- 删除同步 Store 中没有消费者的 `settings`、`quickLinks`、`lastUpdate`、对话框镜像状态、`syncToCloud` 公开方法；`applyCloudData` 改为内部函数。
- App 继续作为同步对话框的唯一状态所有者；取消操作直接关闭 App 状态，不再调用只修改死状态的 `dismissLegacyDialog`。
- 用约 15 行的 `useLazyVisibility` 替换组件 ref、`nextTick`、临时 watcher 和 3 秒超时：
  - 普通弹窗统一接受 `v-model`。
  - 首次打开时设置 `loaded=true`，关闭后保留组件实例，维持当前内部状态。
  - AddQuickLinkDialog 使用明确的 `QuickLinkDialogRequest`：`{ mode: 'add', groupId? } | { mode: 'edit', target }`，不再通过组件暴露方法调用。
- 将 Background provider 统一为 `Record<BgType, () => Promise<string>>`：
  - Local、Bing、Online、None 始终返回字符串。
  - Local URL、Bing URL、Online 设置变化由明确 watcher 触发刷新。
  - 删除 `assignMaybeRef` 和动态 ref watcher。
  - 保留请求版本号、AbortController、Blob URL 回收、切换动画及 Monet 防竞态逻辑。

## 测试与完成标准

- Vitest 覆盖：
  - V7–V11 设置迁移及非法版本。
  - top-sites 并发初始化、缓存失效、隐藏/恢复和 URL 去重。
  - favicon 策略顺序、并发去重、失败回退、取消剩余请求、清缓存后的过期写入保护。
  - top-site 固定、扁平移动、组内移动、跨组移动、重复 URL 和无效落点。
  - 同步决策矩阵的 own-write、cloud-newer、conflict、stale-device、legacy 和 version-too-new。
- 每阶段执行只读校验：`pnpm type-check`、Oxlint、ESLint、Stylelint、`pnpm test`。
- 最终执行 Chrome、Firefox、Edge build。
- 手工回归 favicon 缓存开关及权限有/无、快速导航全部布局与拖拽、同步开关/冲突/旧格式、普通与视频壁纸、明暗壁纸、Bing/Online、Monet。
- 工作区不得出现无关格式化；提交使用 gitmoji，并按测试基础、请求优化、快速导航整合、同步与 UI 简化拆分提交。

## 假设与边界

- 极少数站点也必须保持当前 favicon 获取能力，因此不删除任何现有来源，只消除重复请求和未取消的竞速。
- 不改设置键、存储键、同步 Envelope、Manifest 权限和翻译文案。
- 不顺带重构书签 Worker、设置页面模板、主题算法或 CSS 体系。
- 新增抽象仅限一个 top-sites 状态所有者、两个 DnD 纯函数、一个 Launchpad 展示组件和一个小型懒加载状态 helper。
