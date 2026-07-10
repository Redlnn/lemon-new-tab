import { defineAsyncComponent, ref, shallowRef } from 'vue'

import type { QuickLinkTarget } from '@/shared/quickLinks'

export const SettingsPage = defineAsyncComponent(
  () => import('../components/SettingsPage/index.vue'),
)
export const Changelog = defineAsyncComponent(() => import('../components/Changelog.vue'))
export const Faq = defineAsyncComponent(() => import('../components/Faq.vue'))
export const AboutComp = defineAsyncComponent(() => import('../components/About.vue'))
export const SearchEnginesSwitcher = defineAsyncComponent(
  () => import('../components/SearchEnginesSwitcher/index.vue'),
)
export const BackgroundSwitcher = defineAsyncComponent(
  () => import('../components/BackgroundSwitcher/index.vue'),
)
export const PermissionDialog = defineAsyncComponent(
  () => import('../components/PermissionDialog.vue'),
)
export const Bookmark = defineAsyncComponent(() => import('../components/Bookmark/index.vue'))
export const AddQuickLinkDialog = defineAsyncComponent(
  () => import('../components/QuickLinks/components/AddQuickLinkDialog.vue'),
)
export const SyncLegacyDialog = defineAsyncComponent(
  () => import('../components/SyncLegacyDialog.vue'),
)
export const SyncConflictDialog = defineAsyncComponent(
  () => import('../components/SyncConflictDialog.vue'),
)

function createLazyDialogState() {
  const mounted = ref(false)
  const visible = ref(false)

  const show = () => {
    mounted.value = true
    visible.value = true
  }
  const toggle = () => {
    mounted.value = true
    visible.value = !visible.value
  }

  return { mounted, visible, show, toggle }
}

export function useLazyAppComponents() {
  const settingsPage = createLazyDialogState()
  const changelog = createLazyDialogState()
  const faq = createLazyDialogState()
  const about = createLazyDialogState()
  const searchEnginesSwitcher = createLazyDialogState()
  const backgroundSwitcher = createLazyDialogState()
  const bookmark = createLazyDialogState()
  const addQuickLinkDialog = createLazyDialogState()
  const quickLinkDialogRequest = shallowRef<
    { mode: 'add'; groupId?: string } | { mode: 'edit'; target: QuickLinkTarget } | null
  >(null)
  const permissionDialogLoaded = ref(false)
  const syncLegacyDialogLoaded = ref(false)
  const syncConflictDialogLoaded = ref(false)

  const openAddQuickLinkDialog = (groupId?: string) => {
    quickLinkDialogRequest.value = { mode: 'add', ...(groupId ? { groupId } : {}) }
    addQuickLinkDialog.show()
  }
  const openEditQuickLinkDialog = (target: QuickLinkTarget) => {
    quickLinkDialogRequest.value = { mode: 'edit', target }
    addQuickLinkDialog.show()
  }

  return {
    settingsPageMounted: settingsPage.mounted,
    settingsPageVisible: settingsPage.visible,
    changelogMounted: changelog.mounted,
    changelogVisible: changelog.visible,
    faqMounted: faq.mounted,
    faqVisible: faq.visible,
    aboutMounted: about.mounted,
    aboutVisible: about.visible,
    searchEnginesSwitcherMounted: searchEnginesSwitcher.mounted,
    searchEnginesSwitcherVisible: searchEnginesSwitcher.visible,
    backgroundSwitcherMounted: backgroundSwitcher.mounted,
    backgroundSwitcherVisible: backgroundSwitcher.visible,
    bookmarkMounted: bookmark.mounted,
    bookmarkVisible: bookmark.visible,
    addQuickLinkDialogMounted: addQuickLinkDialog.mounted,
    addQuickLinkDialogVisible: addQuickLinkDialog.visible,
    quickLinkDialogRequest,
    permissionDialogLoaded,
    syncLegacyDialogLoaded,
    syncConflictDialogLoaded,
    toggleSettingsPage: settingsPage.toggle,
    showChangelog: changelog.show,
    showFaq: faq.show,
    toggleAbout: about.toggle,
    showSearchEnginesSwitcher: searchEnginesSwitcher.show,
    showBackgroundSwitcher: backgroundSwitcher.show,
    showBookmark: bookmark.show,
    openAddQuickLinkDialog,
    openEditQuickLinkDialog,
  }
}
