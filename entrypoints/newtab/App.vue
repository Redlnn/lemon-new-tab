<script lang="ts" setup>
import type { CSSProperties } from 'vue'

import type { Language } from 'element-plus/es/locale'
import { useTranslation } from 'i18next-vue'

import { version } from '@/package.json'

import { BgType } from '@/shared/enums'
import { getLang } from '@/shared/i18n'
import { useSettingsStore } from '@/shared/settings'
import { setSyncEventCallback } from '@/shared/sync/syncDataStore'
import { changeTheme, toggleDocumentClass } from '@/shared/theme'

import { OPEN_BACKGROUND_PREFERENCE, OPEN_SEARCH_ENGINE_PREFERENCE } from '@newtab/shared/keys'

import BookmarkBtn from './components/ActionBtn/BookmarkBtn.vue'
import DownloadBgBtn from './components/ActionBtn/DownloadBgBtn.vue'
import RefreshBgBtn from './components/ActionBtn/RefreshBgBtn.vue'
import SettingsBtn from './components/ActionBtn/SettingsBtn.vue'
import Background from './components/Background.vue'
import Bookmark from './components/Bookmark/index.vue'
import Clock from './components/Clock.vue'
import SearchBox from './components/SearchBox/index.vue'
import Shortcut from './components/Shortcut/index.vue'
import YiYan from './components/YiYan.vue'
import { usePermission } from './composables/usePermission'

const { t, i18next } = useTranslation('sync')

const elementZhLocales = import.meta.glob<{ default: Language }>(
  '/node_modules/element-plus/es/locale/lang/zh*.mjs'
)

// 由于考虑面向用户群体，只包含中文、英文
async function loadElementLocale(): Promise<Language> {
  const formattedLocale = getLang().toLowerCase()
  const loader =
    elementZhLocales[`/node_modules/element-plus/es/locale/lang/${formattedLocale}.mjs`]

  if (loader) {
    return (await loader()).default
  }

  // 当遇到不支持的 zh 语言时，回退到 zh-cn
  return (await import('element-plus/es/locale/lang/zh-cn.mjs')).default
}

const elLocale = ref<Language>()

onBeforeMount(async () => {
  if (getLang().startsWith('zh')) {
    elLocale.value = await loadElementLocale()
  }
})

// 在语言切换时同步 Element Plus 语言包（仅中文按需加载，英文使用默认）
const onLngChanged = async (lng: string) => {
  if (lng?.startsWith('zh')) {
    elLocale.value = await loadElementLocale()
  } else {
    elLocale.value = undefined
  }
}
i18next.on('languageChanged', onLngChanged)

const SettingsPage = defineAsyncComponent(() => import('./components/SettingsPage/index.vue'))
const Changelog = defineAsyncComponent(() => import('./components/Changelog.vue'))
const Faq = defineAsyncComponent(() => import('./components/Faq.vue'))
const AboutComp = defineAsyncComponent(() => import('./components/About.vue'))
const SearchEnginesSwitcher = defineAsyncComponent(
  () => import('./components/SearchEnginesSwitcher/index.vue')
)
const BackgroundSwitcher = defineAsyncComponent(
  () => import('./components/BackgroundSwitcher/index.vue')
)
const PermissionDialog = defineAsyncComponent(() => import('./components/PermissionDialog.vue'))

const SettingsPageRef = ref<InstanceType<typeof SettingsPage>>()
const ChangelogRef = ref<InstanceType<typeof Changelog>>()
const FaqRef = ref<InstanceType<typeof Faq>>()
const AboutRef = ref<InstanceType<typeof AboutComp>>()
const SESwitcherRef = ref<InstanceType<typeof SearchEnginesSwitcher>>()
const BGSwticherRef = ref<InstanceType<typeof BackgroundSwitcher>>()
const BookmarkRef = ref<InstanceType<typeof Bookmark>>()
const BackgroundRef = ref<InstanceType<typeof Background>>()

const settings = useSettingsStore()

function parseMajorMinor(value: string): [number, number] | null {
  const [majorStr, minorStr] = value.split('.')
  if (majorStr == null || minorStr == null) return null
  const major = Number(majorStr)
  const minor = Number(minorStr)
  if (Number.isNaN(major) || Number.isNaN(minor)) return null
  return [major, minor]
}

function shouldShowChangelog(previousVersion: string, nextVersion: string): boolean {
  const nextMajorMinor = parseMajorMinor(nextVersion)
  if (!nextMajorMinor) return false
  const previousMajorMinor = parseMajorMinor(previousVersion)
  if (!previousMajorMinor) return true
  if (previousMajorMinor[0] < nextMajorMinor[0]) return true
  if (previousMajorMinor[0] > nextMajorMinor[0]) return false
  return previousMajorMinor[1] < nextMajorMinor[1]
}

onMounted(async () => {
  if (settings.pluginVersion !== version) {
    settings.readChangeLog = false
    ElMessage.primary(t('newtab:changelog.newVersionMsg', { version }))

    const canAutoShow = shouldShowChangelog(settings.pluginVersion, version)

    if (canAutoShow && !settings.hideMajorChangelog) {
      watch(
        () => ChangelogRef.value,
        (instance) => {
          if (!instance) return
          instance.show()
        },
        { once: true, flush: 'post' }
      )
    } else {
      settings.pluginVersion = version
    }
  }

  // 注册同步事件回调
  setSyncEventCallback((type, payload) => {
    if (type === 'version-mismatch') {
      const p = payload as { cloud: string; local: string }
      ElNotification.error({
        title: t('failMessage.title'),
        message: t('failMessage.message', { cloud: p.cloud, local: p.local })
      })
    } else if (type === 'sync-error') {
      const err = payload as Error
      ElNotification.error({
        title: t('errorMessage.title'),
        message: err.message || 'Unknown error.'
      })
    }
  })
})

watch(
  () => settings.theme.primaryColor,
  (color) => {
    if (color === null) {
      return
    }
    changeTheme(color)
  }
)

watch(
  () => settings.theme.colorfulMode,
  (colorful) => {
    toggleDocumentClass('colorful', colorful)
  },
  { immediate: true }
)

watch(
  () => settings.perf.disableDialogTransparent,
  (disabled) => {
    toggleDocumentClass('dialog-transparent', !disabled)
  },
  { immediate: true }
)

watch(
  () => settings.perf.disableDialogBlur,
  (disabled) => {
    toggleDocumentClass('dialog-acrylic', !disabled)
  },
  { immediate: true }
)

function openBookmarkSidebar() {
  if (settings.bookmark.rightClickToOpen) {
    BookmarkRef.value?.show()
  }
}

provide(OPEN_SEARCH_ENGINE_PREFERENCE, () => SESwitcherRef.value?.show())
provide(OPEN_BACKGROUND_PREFERENCE, () => BGSwticherRef.value?.show())

const { permissionDialogVisible, currentHostname, onPermissionDialogResult } = usePermission()

const actionClass = computed(() => {
  const perf = settings.perf
  const dt = perf.disableSettingsBtnTransparent
  const db = perf.disableSettingsBtnBlur

  const enableTransparent = !dt
  const enableBlur = !db && enableTransparent

  return {
    'action-btn--tran': enableTransparent,
    'action-btn--blur': enableBlur
  }
})
</script>

<template>
  <el-config-provider
    :locale="elLocale"
    :dialog="{
      transition: settings.perf.disableDialogAnimation ? 'none' : 'dialog',
      alignCenter: true
    }"
    :message="{
      placement: 'bottom'
    }"
  >
    <main
      :style="
        settings.shortcut.enabled
          ? { justifyContent: 'center' }
          : ({ paddingTop: ['30vh', '30dvh'] } as unknown as CSSProperties)
      "
      class="app"
      @contextmenu.prevent="openBookmarkSidebar"
    >
      <clock v-if="settings.clock.enabled" @contextmenu.stop />
      <search-box v-if="settings.search.enabled" @contextmenu.stop />
      <shortcut v-if="settings.shortcut.enabled" @contextmenu.stop />
      <yi-yan v-if="settings.yiyan.enabled" @contextmenu.stop />
    </main>
    <background ref="BackgroundRef" />
    <div class="action-btn-container">
      <settings-btn
        :btn-class="actionClass"
        @open-settings="SettingsPageRef?.toggle"
        @open-changelog="ChangelogRef?.show"
        @open-about="AboutRef?.toggle"
        @open-search-engine-preference="SESwitcherRef?.show"
        @open-faq="FaqRef?.show"
        @open-background-switcher="BGSwticherRef?.show"
      />
      <bookmark-btn
        v-if="!settings.bookmark.hideBtn"
        :btn-class="actionClass"
        @open-bookmark-sidebar="BookmarkRef?.show"
      />
      <refresh-bg-btn
        v-if="settings.background.bgType === BgType.Online"
        :btn-class="actionClass"
        @refresh-background="BackgroundRef?.refreshBackground"
      ></refresh-bg-btn>
      <download-bg-btn
        v-if="([BgType.Bing, BgType.Online] as BgType[]).includes(settings.background.bgType)"
        :btn-class="actionClass"
      ></download-bg-btn>
    </div>
    <settings-page ref="SettingsPageRef" />
    <changelog ref="ChangelogRef" />
    <faq ref="FaqRef" />
    <about-comp ref="AboutRef" />
    <search-engines-switcher ref="SESwitcherRef" />
    <background-switcher ref="BGSwticherRef" />
    <bookmark ref="BookmarkRef" />
    <permission-dialog
      v-model="permissionDialogVisible"
      :hostname="currentHostname"
      @result="onPermissionDialogResult"
    />
  </el-config-provider>
</template>
