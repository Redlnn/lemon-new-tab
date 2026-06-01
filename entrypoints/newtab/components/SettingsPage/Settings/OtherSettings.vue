<script setup lang="ts">
import { useTimeoutFn } from '@vueuse/core'

import { ElLoading } from 'element-plus'
import { useTranslation } from 'i18next-vue'
import DeleteForeverOutlined from '~icons/ic/outline-delete-forever'
import CloudOffRound from '~icons/ic/round-cloud-off'
import DownloadRound from '~icons/ic/round-download'
import FileUploadRound from '~icons/ic/round-file-upload'

import { storage } from '#imports'

import { downloadJSON } from '@/shared/downloadJson'
import { clearFaviconCache } from '@/shared/media'
import { type QuickLinksData, useQuickLinksStore } from '@/shared/quickLinks'
import { type CURRENT_CONFIG_SCHEMA, defaultSettings, useSettingsStore } from '@/shared/settings'
import { idbDropDatabase } from '@/shared/storage/idb'
import { useSyncDataStore } from '@/shared/sync'

import {
  PermissionContext,
  PermissionResult,
  usePermission,
} from '@newtab/composables/usePermission'
import {
  type CustomSearchEngineStorage,
  useCustomSearchEngineStore,
} from '@newtab/shared/customSearchEngine'
import {
  clearAllOnlineWallpaperCache,
  useBingWallpaperStorge,
  useDarkWallpaperStorge,
  useWallpaperStorge,
  useWallpaperUrlStore,
} from '@newtab/shared/wallpaper'

const { t, i18next } = useTranslation('settings')

const settings = useSettingsStore()
const quickLinks = useQuickLinksStore()
const customSearchEngineStore = useCustomSearchEngineStore()

const { checkAndRequestPermission } = usePermission()

const beforeFaviconCacheChange = async (): Promise<boolean> => {
  // 正在关闭 → 直接允许（不撤销 *://*/* 权限）
  if (settings.faviconCacheEnabled) return true

  // 正在开启 → 申请 *://*/* 权限
  const result = await checkAndRequestPermission(
    window.location.hostname,
    true,
    PermissionContext.FaviconCache,
  )
  const granted = result === PermissionResult.GrantedAll
  if (!granted) {
    ElMessage.warning(t('other.faviconCache.permissionDenied'))
  }
  return granted
}

async function confirmClearExtensionData() {
  try {
    await ElMessageBox.confirm(
      t('other.purge.confirm.data.message'),
      t('other.purge.confirm.data.title'),
      {
        confirmButtonText: t('newtab:common.confirm'),
        cancelButtonText: t('newtab:common.no'),
        type: 'warning',
      },
    )
  } catch {
    return
  }

  clearExtensionData()
}

async function confirmClearWallpaperData() {
  try {
    await ElMessageBox.confirm(
      t('other.purge.confirm.wallpaper.message'),
      t('other.purge.confirm.wallpaper.title'),
      {
        confirmButtonText: t('newtab:common.confirm'),
        cancelButtonText: t('newtab:common.no'),
        type: 'warning',
      },
    )
  } catch {
    return
  }

  clearWallpaperData()
}

async function confirmClearIconCache() {
  try {
    await ElMessageBox.confirm(
      t('other.purge.confirm.icon.message'),
      t('other.purge.confirm.icon.title'),
      {
        confirmButtonText: t('newtab:common.confirm'),
        cancelButtonText: t('newtab:common.no'),
        type: 'warning',
      },
    )
  } catch {
    return
  }

  clearIconCache()
}

async function clearWallpaperData() {
  const wallpaperUrlStore = useWallpaperUrlStore()

  const resetSettings = () => {
    settings.background.bgType = defaultSettings.background.bgType
    settings.background.local = { ...defaultSettings.background.local }
    settings.background.localDark = { ...defaultSettings.background.localDark }
    settings.background.bing = { ...defaultSettings.background.bing }
    settings.background.online = {
      ...defaultSettings.background.online,
      cache: { ...defaultSettings.background.online.cache },
    }
  }

  ElLoading.service({
    lock: true,
    text: t('other.purge.confirm.wallpaper.purging'),
    body: true,
    background: 'var(--el-overlay-color-light)',
  })

  resetSettings()

  Promise.all([
    useWallpaperStorge.clear(),
    useDarkWallpaperStorge.clear(),
    useBingWallpaperStorge.clear(),
    clearAllOnlineWallpaperCache(),
    wallpaperUrlStore.clearUrl('light'),
    wallpaperUrlStore.clearUrl('dark'),
    wallpaperUrlStore.clearUrl('bing'),
  ])
    .catch(console.error)
    .finally(() => {
      setTimeout(() => {
        location.reload()
      }, 1000)
    })
}

function clearExtensionData() {
  ElLoading.service({
    lock: true,
    text: t('other.purge.confirm.data.purging'),
    body: true,
    background: 'var(--el-overlay-color-light)',
  })

  Promise.all([
    localStorage.clear(),
    sessionStorage.clear(),
    idbDropDatabase(),
    storage.clear('local'),
    storage.clear('session'),
    storage.clear('sync'),
  ])
    .catch(console.error)
    .finally(() => {
      useTimeoutFn(() => {
        location.reload()
      }, 1000)
    })
}

function clearIconCache() {
  ElLoading.service({
    lock: true,
    text: t('other.purge.confirm.icon.purging'),
    body: true,
    background: 'var(--el-overlay-color-light)',
  })

  clearFaviconCache()
    .catch(console.error)
    .finally(() => {
      useTimeoutFn(() => {
        location.reload()
      }, 1000)
    })
}

function sendSyncMessage() {
  const syncStore = useSyncDataStore()
  if (settings.sync.enabled) {
    syncStore.init()
  } else {
    syncStore.deinit()
  }
}

const fileInput = useTemplateRef('fileInput')
type Backup = {
  settings: CURRENT_CONFIG_SCHEMA
  quickLinks: QuickLinksData
  customSearchEngines: CustomSearchEngineStorage
}

type ImportBackup = Partial<Backup> & {
  bookmark?: QuickLinksData
  bookmarks?: QuickLinksData
  shortcuts?: QuickLinksData
}

/**
 * 通用文件选择器打开函数
 */
async function openFilePicker() {
  try {
    await ElMessageBox.confirm(
      t('other.importExport.warningDialog.content'),
      t('other.importExport.warningDialog.title'),
      {
        confirmButtonText: t('other.importExport.warningDialog.yes'),
        cancelButtonText: t('other.importExport.warningDialog.no'),
        type: 'warning',
      },
    )
    fileInput.value?.click()
  } catch {}
}

async function exportBackup() {
  const backup: Backup = {
    settings: settings.$state,
    quickLinks: quickLinks.$state,
    customSearchEngines: customSearchEngineStore.$state,
  }

  downloadJSON<Backup>(backup, 'lenmon-new-tab-backup.json')
}

function hasObjectKey(data: Record<string, unknown>, key: string): boolean {
  return key in data && typeof data[key] === 'object' && data[key] !== null
}

function backupValidator(data: unknown): data is ImportBackup {
  if (typeof data !== 'object' || data === null) return false
  const record = data as Record<string, unknown>
  if (hasObjectKey(record, 'settings')) return true
  if (hasObjectKey(record, 'quickLinks')) return true
  if (hasObjectKey(record, 'bookmark')) return true
  if (hasObjectKey(record, 'bookmarks')) return true
  if (hasObjectKey(record, 'shortcuts')) return true
  if (hasObjectKey(record, 'customSearchEngines')) return true
  return false
}

function handleFileChange(event: Event) {
  return handleFileImport<ImportBackup>(event, fileInput, backupValidator, async (data) => {
    // settings 部分（沿用之前的逻辑）
    if (data.settings && settings.version !== data.settings.version) {
      ElMessage.error(
        t('other.importExport.importFailed', { reason: t('other.importExport.versionMismatch') }),
      )
      return
    }

    const originalSyncState = settings.$state.sync.enabled
    const nextSyncEnabled = data.settings?.sync.enabled ?? originalSyncState
    const syncStore = useSyncDataStore()

    if (data.settings) {
      data.settings.background.local = settings.$state.background.local
      data.settings.background.localDark = data.settings.background.localDark || {
        id: '',
        url: '',
        mediaType: undefined,
      }
      data.settings.background.bing = settings.$state.background.bing
      data.settings.background.online.url = settings.$state.background.online.url

      settings.$patch(data.settings)
      if (originalSyncState && !nextSyncEnabled) {
        syncStore.deinit()
      }
    }

    // quickLinks 部分
    const quickLinksData = data.quickLinks ?? data.bookmark ?? data.bookmarks ?? data.shortcuts
    if (quickLinksData) {
      await quickLinks.save(quickLinksData, { groupingEnabled: settings.quickLinks.grouping })
    }

    // custom search engines 部分
    if (data.customSearchEngines) {
      await customSearchEngineStore.save(data.customSearchEngines)
    }

    if (!originalSyncState && nextSyncEnabled) {
      await syncStore.init()
    }
  })
}

/**
 * 通用文件导入处理函数
 */
function handleFileImport<T>(
  event: Event,
  inputRef: Ref<HTMLInputElement | null>,
  validator: (data: unknown) => data is T,
  onSuccess: (data: T) => void,
) {
  const input = event.target as HTMLInputElement
  const file = input?.files?.[0]
  if (!file) {
    ElMessage.error(
      t('other.importExport.importFailed', { reason: t('other.importExport.noFileSelected') }),
    )
    console.error('No file selected')
    return
  }

  const reader = new FileReader()
  let fileContent: T | null = null
  let parseError: string | null = null

  reader.onload = () => {
    try {
      const json = JSON.parse(reader.result as string)
      if (validator(json)) {
        fileContent = json
      } else {
        parseError = t('other.importExport.invalidFileFormat')
        ElMessage.error(t('other.importExport.importFailed', { reason: parseError }))
      }
    } catch {
      parseError = t('other.importExport.invalidJSON')
      ElMessage.error(t('other.importExport.importFailed', { reason: parseError }))
    }
  }

  reader.readAsText(file)
  return new Promise<void>((resolve) => {
    reader.onloadend = () => {
      if (fileContent) {
        onSuccess(fileContent)
        ElMessage.success(t('other.importExport.importSuccess'))
      } else {
        ElMessage.error(
          t('other.importExport.importFailed', {
            reason: parseError || t('other.importExport.unknownError'),
          }),
        )
      }
      // 重置 file input 以允许导入同一个文件
      if (inputRef.value) inputRef.value.value = ''
      resolve()
    }
  })
}

const currentLanguage = ref(i18next.language)

const supportedLanguages = computed(() => {
  const locale = currentLanguage.value || navigator.language
  const displayNames = new Intl.DisplayNames([locale], { type: 'language' })

  const languageCodes = ['zh-CN', 'zh-TW', 'zh-HK', 'en']
  const current = currentLanguage.value

  // 先添加当前语言，再添加其他语言
  const options = languageCodes.map((code) => ({
    value: code,
    label: displayNames.of(code),
  }))
  // 将当前语言移到首位
  const currentIndex = options.findIndex((opt) => opt.value === current)
  if (currentIndex > 0) {
    options.unshift(options.splice(currentIndex, 1)[0]!)
  }
  return options
})

function changeLanguage(lang: string) {
  i18next.changeLanguage(lang)
  currentLanguage.value = lang
}
</script>

<template>
  <div class="settings__items-container">
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('other.sync') }}</div>
      <el-switch v-model="settings.sync.enabled" @change="sendSyncMessage" />
    </div>
    <p class="settings__item--note">
      {{ t('other.syncWarning') }}
      <cloud-off-round />
    </p>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('other.language') }}</div>
      <el-select
        v-model="currentLanguage"
        style="width: 183px"
        popper-class="settings-item-popper"
        @change="changeLanguage"
        :show-arrow="false"
        fit-input-width
      >
        <el-option
          v-for="item in supportedLanguages"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        >
        </el-option>
      </el-select>
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('other.importExport.backup') }}</div>
      <span class="button-group">
        <el-button type="primary" :icon="DownloadRound" @click="exportBackup">
          {{ t('other.importExport.export') }}
        </el-button>
        <el-button :icon="FileUploadRound" @click="openFilePicker">
          {{ t('other.importExport.import') }}
        </el-button>
      </span>
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('newtab:changelog.hideMajor') }}</div>
      <el-switch v-model="settings.hideMajorChangelog" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('other.faviconCache.label') }}</div>
      <el-switch v-model="settings.faviconCacheEnabled" :before-change="beforeFaviconCacheChange" />
    </div>
    <p class="settings__item--note">
      {{ t('other.faviconCache.description') }}
    </p>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('other.purge.icon') }}</div>
      <el-button type="danger" :icon="DeleteForeverOutlined" @click="confirmClearIconCache">
        {{ t('other.purge.btn') }}
      </el-button>
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('other.purge.wallpaper') }}</div>
      <el-button type="danger" :icon="DeleteForeverOutlined" @click="confirmClearWallpaperData">
        {{ t('other.purge.btn') }}
      </el-button>
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('other.purge.data') }}</div>
      <el-button type="danger" :icon="DeleteForeverOutlined" @click="confirmClearExtensionData">
        {{ t('other.purge.btn') }}
      </el-button>
    </div>
    <input
      ref="fileInput"
      type="file"
      accept="application/json"
      style="display: none"
      @change="handleFileChange"
    />
  </div>
</template>
