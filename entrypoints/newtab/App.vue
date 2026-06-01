<script lang="ts" setup>
import { useIdle } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import type { StyleValue } from 'vue'

import { BgType } from '@/shared/enums'
import { useSettingsStore } from '@/shared/settings'
import { useSyncDataStore } from '@/shared/sync'

import {
  FOCUS_STATE,
  OPEN_BACKGROUND_PREFERENCE,
  OPEN_SEARCH_ENGINE_PREFERENCE,
  OPEN_SETTINGS,
} from '@newtab/shared/keys'

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
import { usePermission } from './composables/usePermission'
import { useThemeWatcher } from './composables/useThemeWatcher'

const SettingsPage = defineAsyncComponent(() => import('./components/SettingsPage/index.vue'))
const Changelog = defineAsyncComponent(() => import('./components/Changelog.vue'))
const Faq = defineAsyncComponent(() => import('./components/Faq.vue'))
const AboutComp = defineAsyncComponent(() => import('./components/About.vue'))
const SearchEnginesSwitcher = defineAsyncComponent(
  () => import('./components/SearchEnginesSwitcher/index.vue'),
)
const BackgroundSwitcher = defineAsyncComponent(
  () => import('./components/BackgroundSwitcher/index.vue'),
)
const PermissionDialog = defineAsyncComponent(() => import('./components/PermissionDialog.vue'))
const Bookmark = defineAsyncComponent(() => import('./components/Bookmark/index.vue'))
const AddQuickLinkDialog = defineAsyncComponent(
  () => import('./components/QuickLinks/components/AddQuickLinkDialog.vue'),
)
const SyncLegacyDialog = defineAsyncComponent(() => import('./components/SyncLegacyDialog.vue'))
const SyncConflictDialog = defineAsyncComponent(() => import('./components/SyncConflictDialog.vue'))

const SettingsPageRef = ref<InstanceType<typeof SettingsPage>>()
const ChangelogRef = ref<InstanceType<typeof Changelog>>()
const FaqRef = ref<InstanceType<typeof Faq>>()
const AboutRef = ref<InstanceType<typeof AboutComp>>()
const SESwitcherRef = ref<InstanceType<typeof SearchEnginesSwitcher>>()
const BGSwticherRef = ref<InstanceType<typeof BackgroundSwitcher>>()
const BookmarkRef = ref<InstanceType<typeof Bookmark>>()
const BackgroundRef = ref<InstanceType<typeof Background>>()
const AddQuickLinkDialogRef = ref<InstanceType<typeof AddQuickLinkDialog>>()

const appRef = useTemplateRef('appRef')

const elLocale = useElementLang()
const settings = useSettingsStore()
const syncStore = useSyncDataStore()
const { legacyDialogVisible, conflictDialogVisible, conflictPayload } = storeToRefs(syncStore)

// 主题/外观 watcher
useThemeWatcher()

// 应用级通知（欢迎、缓存提示、版本更新、同步错误）
useAppNotifications(ChangelogRef)

const { idle } = useIdle(5_000, {
  events: ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'],
  listenForVisibilityChange: false,
})

watch(idle, (v) => {
  if (!settings.theme.idleHide) return
  if (v) {
    if (appRef.value) appRef.value.style.opacity = '0.2'
  } else {
    appRef.value?.style.removeProperty('opacity')
  }
})

function openBookmarkSidebar() {
  if (settings.bookmark.rightClickToOpen) {
    BookmarkRef.value?.show()
  }
}

provide(FOCUS_STATE, createFocusState())
provide(OPEN_SETTINGS, () => SettingsPageRef.value?.toggle())
provide(OPEN_SEARCH_ENGINE_PREFERENCE, () => SESwitcherRef.value?.show())
provide(OPEN_BACKGROUND_PREFERENCE, () => BGSwticherRef.value?.show())

const {
  permissionDialogVisible,
  currentHostname,
  currentOnlyAll,
  currentContext,
  onPermissionDialogResult,
} = usePermission()

const actionClass = computed(() => {
  const perf = settings.perf
  const enableTransparent = perf.actionBtns.transparent
  const enableBlur = perf.actionBtns.blur && enableTransparent

  let pos = settings.layout.actionBtnPosition
  if (settings.dock.enabled && pos.startsWith('bottom')) {
    pos = pos.replace('bottom', 'top') as typeof pos
  }

  return {
    'action-btn-container--tran': enableTransparent,
    'action-btn-container--blur': enableBlur,
    [`action-btn-container--${pos}`]: true,
  }
})

const mainStyle = computed<StyleValue>(() => {
  const pos = settings.layout.mainPosition
  if (pos.type === 'center') {
    return { justifyContent: 'center' }
  }
  if (pos.type === 'dvh') {
    return [{ paddingTop: `${pos.value}vh` }, { paddingTop: `${pos.value}dvh` }]
  }
  return { paddingTop: `${pos.value}px` }
})

const handleLegacyConfirm = () => syncStore.clearLegacyAndReinitialize()
const handleLegacyCancel = () => syncStore.dismissLegacyDialog()
const handleUseCloudConflictData = () => syncStore.useCloudConflictData()
const handleUseLocalConflictData = () => syncStore.useLocalConflictData()
const handleDisableSyncConflict = () => syncStore.disableSyncAndDismissConflict()
</script>

<template>
  <el-config-provider
    :locale="elLocale"
    :dialog="{
      transition: settings.perf.dialog.animation ? 'dialog' : 'none',
      alignCenter: true,
    }"
    :message="{
      placement: 'bottom',
    }"
  >
    <main :style="mainStyle" class="app" ref="appRef" @contextmenu.prevent="openBookmarkSidebar">
      <clock v-if="settings.clock.enabled" @contextmenu.stop />
      <search-box v-if="settings.search.enabled" @contextmenu.stop />
      <quick-links
        v-if="settings.quickLinks.enabled"
        :on-open-add-dialog="AddQuickLinkDialogRef?.openAddDialog"
        :on-open-edit-dialog="AddQuickLinkDialogRef?.openEditDialog"
        @contextmenu.stop
      />
      <yi-yan v-if="settings.yiyan.enabled" @contextmenu.stop />
      <dock
        v-if="settings.dock.enabled"
        :on-open-add-dialog="AddQuickLinkDialogRef?.openAddDialog"
        :on-open-edit-dialog="AddQuickLinkDialogRef?.openEditDialog"
      />
    </main>
    <background ref="BackgroundRef" />
    <div class="action-btn-container" :class="actionClass">
      <settings-btn
        @open-settings="SettingsPageRef?.toggle"
        @open-changelog="ChangelogRef?.show"
        @open-about="AboutRef?.toggle"
        @open-search-engine-preference="SESwitcherRef?.show"
        @open-faq="FaqRef?.show"
        @open-background-switcher="BGSwticherRef?.show"
      />
      <bookmark-btn v-if="settings.bookmark.showBtn" @open-bookmark-sidebar="BookmarkRef?.show" />
      <refresh-bg-btn
        v-if="settings.background.bgType === BgType.Online"
        @refresh-background="BackgroundRef?.refreshBackground"
      ></refresh-bg-btn>
      <download-bg-btn
        v-if="([BgType.Bing, BgType.Online] as BgType[]).includes(settings.background.bgType)"
      ></download-bg-btn>
    </div>
    <settings-page ref="SettingsPageRef" />
    <changelog ref="ChangelogRef" />
    <faq ref="FaqRef" />
    <about-comp ref="AboutRef" />
    <search-engines-switcher ref="SESwitcherRef" />
    <background-switcher ref="BGSwticherRef" />
    <bookmark ref="BookmarkRef" />
    <add-quick-link-dialog ref="AddQuickLinkDialogRef" />
    <permission-dialog
      v-model="permissionDialogVisible"
      :hostname="currentHostname"
      :only-all="currentOnlyAll"
      :context="currentContext"
      @result="onPermissionDialogResult"
    />
    <sync-legacy-dialog
      v-model="legacyDialogVisible"
      @confirm="handleLegacyConfirm"
      @cancel="handleLegacyCancel"
    />
    <sync-conflict-dialog
      v-model="conflictDialogVisible"
      :conflict="conflictPayload"
      @use-cloud="handleUseCloudConflictData"
      @use-local="handleUseLocalConflictData"
      @disable-sync="handleDisableSyncConflict"
    />
  </el-config-provider>
</template>
