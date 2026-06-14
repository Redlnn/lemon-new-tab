import { defineAsyncComponent, nextTick, ref, watch, type Ref } from 'vue'

import type { QuickLinkTarget } from '@/shared/quickLinks'

export const SettingsPage = defineAsyncComponent(() => import('../components/SettingsPage/index.vue'))
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

async function ensureLazyRef<T>(loaded: Ref<boolean>, targetRef: Ref<T | undefined>) {
  if (targetRef.value) return targetRef.value

  loaded.value = true
  await nextTick()
  if (targetRef.value) return targetRef.value

  return await new Promise<T | undefined>((resolve) => {
    const stop = watch(
      targetRef,
      (instance) => {
        if (!instance) return
        stop()
        resolve(instance)
      },
      { flush: 'post' },
    )

    window.setTimeout(() => {
      stop()
      resolve(targetRef.value)
    }, 3_000)
  })
}

function createLazyComponentRef<T>() {
  const componentRef = ref<T>()
  const loaded = ref(false)
  const getInstance = () => ensureLazyRef(loaded, componentRef)

  return { componentRef, loaded, getInstance }
}

async function callLazy<T>(lazy: ReturnType<typeof createLazyComponentRef<T>>, call: (instance: T) => void) {
  const instance = await lazy.getInstance()
  if (instance) call(instance)
}

export function useLazyAppComponents() {
  const settingsPage = createLazyComponentRef<InstanceType<typeof SettingsPage>>()
  const changelog = createLazyComponentRef<InstanceType<typeof Changelog>>()
  const faq = createLazyComponentRef<InstanceType<typeof Faq>>()
  const about = createLazyComponentRef<InstanceType<typeof AboutComp>>()
  const searchEnginesSwitcher =
    createLazyComponentRef<InstanceType<typeof SearchEnginesSwitcher>>()
  const backgroundSwitcher = createLazyComponentRef<InstanceType<typeof BackgroundSwitcher>>()
  const bookmark = createLazyComponentRef<InstanceType<typeof Bookmark>>()
  const addQuickLinkDialog = createLazyComponentRef<InstanceType<typeof AddQuickLinkDialog>>()
  const permissionDialogLoaded = ref(false)
  const syncLegacyDialogLoaded = ref(false)
  const syncConflictDialogLoaded = ref(false)

  const toggleSettingsPage = () => callLazy(settingsPage, (instance) => instance.toggle())
  const showChangelog = () => callLazy(changelog, (instance) => instance.show())
  const showFaq = () => callLazy(faq, (instance) => instance.show())
  const toggleAbout = () => callLazy(about, (instance) => instance.toggle())
  const showSearchEnginesSwitcher = () =>
    callLazy(searchEnginesSwitcher, (instance) => instance.show())
  const showBackgroundSwitcher = () =>
    callLazy(backgroundSwitcher, (instance) => instance.show())
  const showBookmark = () => callLazy(bookmark, (instance) => instance.show())
  const openAddQuickLinkDialog = (groupId?: string) =>
    callLazy(addQuickLinkDialog, (instance) => instance.openAddDialog(groupId))
  const openEditQuickLinkDialog = (target: QuickLinkTarget) =>
    callLazy(addQuickLinkDialog, (instance) => instance.openEditDialog(target))

  return {
    SettingsPageRef: settingsPage.componentRef,
    ChangelogRef: changelog.componentRef,
    FaqRef: faq.componentRef,
    AboutRef: about.componentRef,
    SESwitcherRef: searchEnginesSwitcher.componentRef,
    BGSwticherRef: backgroundSwitcher.componentRef,
    BookmarkRef: bookmark.componentRef,
    AddQuickLinkDialogRef: addQuickLinkDialog.componentRef,
    settingsPageLoaded: settingsPage.loaded,
    changelogLoaded: changelog.loaded,
    faqLoaded: faq.loaded,
    aboutLoaded: about.loaded,
    searchEnginesSwitcherLoaded: searchEnginesSwitcher.loaded,
    backgroundSwitcherLoaded: backgroundSwitcher.loaded,
    bookmarkLoaded: bookmark.loaded,
    addQuickLinkDialogLoaded: addQuickLinkDialog.loaded,
    permissionDialogLoaded,
    syncLegacyDialogLoaded,
    syncConflictDialogLoaded,
    toggleSettingsPage,
    showChangelog,
    showFaq,
    toggleAbout,
    showSearchEnginesSwitcher,
    showBackgroundSwitcher,
    showBookmark,
    openAddQuickLinkDialog,
    openEditQuickLinkDialog,
  }
}
