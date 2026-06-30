<script lang="ts" setup>
import { useIdle } from '@vueuse/core'
import { shallowRef, type StyleValue } from 'vue'

import { useTranslation } from 'i18next-vue'

import { BgType } from '@/shared/enums'
import { defaultSettings, useSettingsStore } from '@/shared/settings'
import { addSyncEventCallback } from '@/shared/sync/syncEvents'
import type { SyncEventPayloadMap } from '@/shared/sync/types'

import {
  FOCUS_STATE,
  OPEN_BACKGROUND_PREFERENCE,
  OPEN_SEARCH_ENGINE_PREFERENCE,
  OPEN_SETTINGS,
} from '@newtab/shared/keys'
import { isOnlyTouchDevice } from '@newtab/shared/touch'

import BookmarkBtn from './components/ActionBtn/BookmarkBtn.vue'
import DownloadBgBtn from './components/ActionBtn/DownloadBgBtn.vue'
import RefreshBgBtn from './components/ActionBtn/RefreshBgBtn.vue'
import SettingsBtn from './components/ActionBtn/SettingsBtn.vue'
import Background from './components/Background.vue'
import Clock from './components/Clock.vue'
import Dock from './components/QuickLinks/Dock.vue'
import QuickLinks from './components/QuickLinks/index.vue'
import SearchBox from './components/SearchBox/index.vue'
import YiYan from './components/YiYan.vue'
import { useAppNotifications } from './composables/useAppNotifications'
import { useElementLang } from './composables/useElementLang'
import { createFocusState } from './composables/useFocus'
import {
  AboutComp,
  AddQuickLinkDialog,
  BackgroundSwitcher,
  Bookmark,
  Changelog,
  Faq,
  PermissionDialog,
  SearchEnginesSwitcher,
  SettingsPage,
  SyncConflictDialog,
  SyncLegacyDialog,
  useLazyAppComponents,
} from './composables/useLazyAppComponents'
import { usePermission } from './composables/usePermission'
import { useThemeWatcher } from './composables/useThemeWatcher'

const BackgroundRef = ref<InstanceType<typeof Background>>()
const QuickLinksRef = ref<InstanceType<typeof QuickLinks>>()
const DockRef = ref<InstanceType<typeof Dock>>()
const { t } = useTranslation()

const {
  SettingsPageRef, // 这些 Ref 看着是灰的但模板里有用
  ChangelogRef,
  FaqRef,
  AboutRef,
  SESwitcherRef,
  BGSwticherRef,
  BookmarkRef,
  AddQuickLinkDialogRef,
  settingsPageLoaded,
  changelogLoaded,
  faqLoaded,
  aboutLoaded,
  searchEnginesSwitcherLoaded,
  backgroundSwitcherLoaded,
  bookmarkLoaded,
  addQuickLinkDialogLoaded,
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
} = useLazyAppComponents()

const appRef = useTemplateRef('appRef')

const elLocale = useElementLang()
const settings = useSettingsStore()
const legacyDialogVisible = ref(false)
const conflictDialogVisible = ref(false)
const conflictPayload = shallowRef<SyncEventPayloadMap['conflict'] | null>(null)

// 同步模块体积较大，首屏只订阅轻量事件；真正处理用户选择时再懒加载 store。
const stopSyncDialogEvents = addSyncEventCallback((type, payload) => {
  if (type === 'legacy-detected') {
    syncLegacyDialogLoaded.value = true
    legacyDialogVisible.value = true
  } else if (type === 'conflict') {
    syncConflictDialogLoaded.value = true
    conflictPayload.value = payload as SyncEventPayloadMap['conflict']
    conflictDialogVisible.value = true
  }
})

onUnmounted(stopSyncDialogEvents)

type SyncStoreActions = {
  clearLegacyAndReinitialize: () => Promise<void>
  dismissLegacyDialog: () => void
  useCloudConflictData: () => Promise<void>
  useLocalConflictData: () => Promise<void>
  disableSyncAndDismissConflict: () => void
}

let syncStoreTask: Promise<SyncStoreActions> | null = null

// 多个按钮可能连续触发，复用同一个动态导入任务，避免重复拉取 sync chunk。
async function getSyncStore() {
  syncStoreTask ??= import('@/shared/sync').then(
    ({ useSyncDataStore }) => useSyncDataStore() as SyncStoreActions,
  )
  return await syncStoreTask
}

// 主题/外观 watcher
useThemeWatcher()

const { idle } = useIdle(5_000, {
  events: ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'],
  listenForVisibilityChange: false,
})

const idleHideEnabled = computed(() => settings.theme.idleHide && !isOnlyTouchDevice.value)

watch(
  isOnlyTouchDevice,
  (onlyTouch) => {
    if (!onlyTouch) return
    settings.background.parallax = false
    settings.theme.idleHide = false
  },
  { immediate: true },
)

watch([idle, idleHideEnabled], ([v, enabled]) => {
  if (!enabled) {
    appRef.value?.style.removeProperty('opacity')
    return
  }
  if (v) {
    if (appRef.value) appRef.value.style.opacity = '0.2'
  } else {
    appRef.value?.style.removeProperty('opacity')
  }
})

function openBookmarkSidebar() {
  if (settings.bookmark.rightClickToOpen) {
    void showBookmark()
  }
}

const {
  permissionDialogVisible,
  currentHostname,
  currentOnlyAll,
  currentContext,
  onPermissionDialogResult,
} = usePermission()

provide(FOCUS_STATE, createFocusState())
provide(OPEN_SETTINGS, toggleSettingsPage)
provide(OPEN_SEARCH_ENGINE_PREFERENCE, showSearchEnginesSwitcher)
provide(OPEN_BACKGROUND_PREFERENCE, showBackgroundSwitcher)

// 应用级通知（欢迎、缓存提示、版本更新、同步错误）
useAppNotifications(showChangelog)

watch(
  permissionDialogVisible,
  (visible) => {
    if (visible) permissionDialogLoaded.value = true
  },
  { immediate: true },
)

watch(
  legacyDialogVisible,
  (visible) => {
    if (visible) syncLegacyDialogLoaded.value = true
  },
  { immediate: true },
)

watch(
  conflictDialogVisible,
  (visible) => {
    if (visible) syncConflictDialogLoaded.value = true
  },
  { immediate: true },
)

// Dock 占用底部空间时，将操作按钮位置同步为对应的顶部位置，保证渲染与持久化设置一致。
watch(
  [() => settings.dock.enabled, () => settings.layout.actionBtnPosition],
  ([dockEnabled, actionBtnPosition]) => {
    if (!dockEnabled || !actionBtnPosition.startsWith('bottom')) return
    settings.layout.actionBtnPosition = actionBtnPosition.replace(
      'bottom',
      'top',
    ) as typeof actionBtnPosition
  },
  { immediate: true },
)

const actionClass = computed(() => {
  const perf = settings.perf
  const enableTransparent = perf.actionBtns.transparent && perf.actionBtns.transparency > 0
  const enableBlur = perf.actionBtns.blur && enableTransparent

  return {
    'action-btn-container--tran': enableTransparent,
    'action-btn-container--blur': enableBlur,
    [`action-btn-container--${settings.layout.actionBtnPosition}`]: true,
  }
})

const quickLinksScrollEnabled = computed(
  () => settings.quickLinks.enabled && settings.quickLinks.useScroll,
)

watch(
  quickLinksScrollEnabled,
  (enabled) => {
    if (!enabled || settings.layout.mainPosition.type !== 'center') return
    settings.layout.mainPosition = {
      type: 'dvh',
      value: defaultSettings.layout.mainPosition.value,
    }
  },
  { immediate: true },
)

const mainClass = computed(() => ({
  'app--quick-links-scroll': quickLinksScrollEnabled.value,
}))

const mainStyle = computed<StyleValue>(() => {
  if (quickLinksScrollEnabled.value && settings.layout.mainPosition.type === 'center') {
    return [
      { paddingTop: `${defaultSettings.layout.mainPosition.value}vh` },
      { paddingTop: `${defaultSettings.layout.mainPosition.value}dvh` },
    ]
  }

  const pos = settings.layout.mainPosition
  if (pos.type === 'center') {
    return { justifyContent: 'center' }
  }
  if (pos.type === 'dvh') {
    return [{ paddingTop: `${pos.value}vh` }, { paddingTop: `${pos.value}dvh` }]
  }
  return { paddingTop: `${pos.value}px` }
})

const handleLegacyConfirm = async () => {
  const syncStore = await getSyncStore()
  await syncStore.clearLegacyAndReinitialize()
  legacyDialogVisible.value = false
}
const handleLegacyCancel = async () => {
  const syncStore = await getSyncStore()
  syncStore.dismissLegacyDialog()
  legacyDialogVisible.value = false
}
const handleUseCloudConflictData = async () => {
  const syncStore = await getSyncStore()
  await syncStore.useCloudConflictData()
  conflictDialogVisible.value = false
  conflictPayload.value = null
}
const handleUseLocalConflictData = async () => {
  const syncStore = await getSyncStore()
  await syncStore.useLocalConflictData()
  conflictDialogVisible.value = false
  conflictPayload.value = null
}
const handleDisableSyncConflict = async () => {
  const syncStore = await getSyncStore()
  syncStore.disableSyncAndDismissConflict()
  conflictDialogVisible.value = false
  conflictPayload.value = null
}

async function refreshQuickLinks() {
  await Promise.all([QuickLinksRef.value?.refresh(), DockRef.value?.refresh()])
}
</script>

<template>
  <el-config-provider
    :locale="elLocale"
    :dialog="{
      transition: settings.perf.dialog.animation ? 'dialog' : 'none',
      alignCenter: true,
    }"
    :message="{
      placement: settings.dock.enabled ? 'top' : 'bottom',
    }"
  >
    <main
      :style="mainStyle"
      class="app"
      :class="mainClass"
      ref="appRef"
      :aria-label="t('a11y.main')"
      @contextmenu.prevent="openBookmarkSidebar"
    >
      <clock v-if="settings.clock.enabled" @contextmenu.stop />
      <search-box v-if="settings.search.enabled" @contextmenu.stop />
      <quick-links
        v-if="settings.quickLinks.enabled"
        ref="QuickLinksRef"
        :on-open-add-dialog="openAddQuickLinkDialog"
        :on-open-edit-dialog="openEditQuickLinkDialog"
        @contextmenu.stop
      />
      <yi-yan v-if="settings.yiyan.enabled" @contextmenu.stop />
      <dock
        v-if="settings.dock.enabled"
        ref="DockRef"
        :on-open-add-dialog="openAddQuickLinkDialog"
        :on-open-edit-dialog="openEditQuickLinkDialog"
      />
    </main>
    <background ref="BackgroundRef" />
    <div
      class="action-btn-container"
      :class="actionClass"
      role="toolbar"
      :aria-label="t('a11y.actions')"
    >
      <settings-btn
        @open-settings="toggleSettingsPage"
        @open-changelog="showChangelog"
        @open-about="toggleAbout"
        @open-search-engine-preference="showSearchEnginesSwitcher"
        @open-faq="showFaq"
        @open-background-switcher="showBackgroundSwitcher"
      />
      <bookmark-btn v-if="settings.bookmark.showBtn" @open-bookmark-sidebar="showBookmark" />
      <refresh-bg-btn
        v-if="settings.background.bgType === BgType.Online"
        @refresh-background="BackgroundRef?.refreshBackground"
      ></refresh-bg-btn>
      <download-bg-btn
        v-if="([BgType.Bing, BgType.Online] as BgType[]).includes(settings.background.bgType)"
      ></download-bg-btn>
    </div>
    <settings-page v-if="settingsPageLoaded" ref="SettingsPageRef" />
    <changelog v-if="changelogLoaded" ref="ChangelogRef" />
    <faq v-if="faqLoaded" ref="FaqRef" />
    <about-comp v-if="aboutLoaded" ref="AboutRef" />
    <search-engines-switcher v-if="searchEnginesSwitcherLoaded" ref="SESwitcherRef" />
    <background-switcher v-if="backgroundSwitcherLoaded" ref="BGSwticherRef" />
    <bookmark v-if="bookmarkLoaded" ref="BookmarkRef" />
    <add-quick-link-dialog
      v-if="addQuickLinkDialogLoaded"
      ref="AddQuickLinkDialogRef"
      @saved="refreshQuickLinks"
    />
    <permission-dialog
      v-if="permissionDialogLoaded"
      v-model="permissionDialogVisible"
      :hostname="currentHostname"
      :only-all="currentOnlyAll"
      :context="currentContext"
      @result="onPermissionDialogResult"
    />
    <sync-legacy-dialog
      v-if="syncLegacyDialogLoaded"
      v-model="legacyDialogVisible"
      @confirm="handleLegacyConfirm"
      @cancel="handleLegacyCancel"
    />
    <sync-conflict-dialog
      v-if="syncConflictDialogLoaded"
      v-model="conflictDialogVisible"
      :conflict="conflictPayload"
      @use-cloud="handleUseCloudConflictData"
      @use-local="handleUseLocalConflictData"
      @disable-sync="handleDisableSyncConflict"
    />
  </el-config-provider>
</template>
