import { defineAsyncComponent, type Component } from 'vue'

import type { SimpleDialogName } from './appDialogs'

// 只有宿主导入注册表；调用方不依赖组件。首次显示时加载，之后保留实例。
export const appDialogComponents = {
  settings: defineAsyncComponent(() => import('../components/SettingsPage/index.vue')),
  changelog: defineAsyncComponent(() => import('../components/Changelog.vue')),
  faq: defineAsyncComponent(() => import('../components/Faq.vue')),
  about: defineAsyncComponent(() => import('../components/About.vue')),
  searchEngines: defineAsyncComponent(
    () => import('../components/SearchEnginesSwitcher/index.vue'),
  ),
  background: defineAsyncComponent(() => import('../components/BackgroundSwitcher/index.vue')),
  bookmark: defineAsyncComponent(() => import('../components/Bookmark/index.vue')),
  note: defineAsyncComponent(() => import('../components/Note/index.vue')),
  builtinApps: defineAsyncComponent(() => import('../components/BuiltinAppsDialog.vue')),
} satisfies Record<SimpleDialogName, Component>
export const AddQuickLinkDialog = defineAsyncComponent(
  () => import('../components/QuickLinks/components/AddQuickLinkDialog.vue'),
)
export const PermissionDialog = defineAsyncComponent(
  () => import('../components/PermissionDialog.vue'),
)
export const SyncRetirementDialog = defineAsyncComponent(
  () => import('../components/SyncRetirementDialog.vue'),
)
