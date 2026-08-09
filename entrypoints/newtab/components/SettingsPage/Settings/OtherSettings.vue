<script setup lang="ts">
import { type CheckboxValueType, ElCheckbox, ElLoading } from 'element-plus'
import { useTranslation } from 'i18next-vue'
import DeleteForeverOutlined from '~icons/ic/outline-delete-forever'
import DownloadRound from '~icons/ic/round-download'
import FileUploadRound from '~icons/ic/round-file-upload'

import { downloadJSON } from '@/shared/download'
import { clearFaviconCache } from '@/shared/media'
import { type QuickLinksData, useQuickLinksStore } from '@/shared/quickLinks'
import { ensureSearchEngineAvailable } from '@/shared/searchEngines'
import {
  type CURRENT_CONFIG_SCHEMA,
  defaultSettings,
  normalizeCurrentSettings,
  useSettingsStore,
} from '@/shared/settings'
import { clearExtensionData, reloadNewtabTabs } from '@/shared/settings/legacySettingsRecovery'
import { idbClearMany } from '@/shared/storage/idb'

import {
  PermissionContext,
  PermissionResult,
  usePermission,
} from '@newtab/composables/usePermission'
import {
  type CustomSearchEngineStorage,
  useCustomSearchEngineStore,
} from '@newtab/shared/customSearchEngine'
import { OPEN_SYNC_RETIREMENT } from '@newtab/shared/keys'
import { wallpaperUrlCache } from '@newtab/shared/wallpaper'

import SettingsSection from './SettingsSection.vue'

const { t, i18next } = useTranslation('settings')

const settings = useSettingsStore()
const quickLinks = useQuickLinksStore()
const customSearchEngineStore = useCustomSearchEngineStore()
const openSyncRetirement = inject(OPEN_SYNC_RETIREMENT, () => {})

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

async function confirmAndRun(
  message: string,
  title: string,
  onConfirm: () => void,
  options?: { confirmButtonText?: string; cancelButtonText?: string },
) {
  try {
    await ElMessageBox.confirm(message, title, {
      confirmButtonText: options?.confirmButtonText ?? t('newtab:common.confirm'),
      cancelButtonText: options?.cancelButtonText ?? t('newtab:common.no'),
      type: 'warning',
    })
  } catch {
    return
  }

  onConfirm()
}

async function confirmClearExtensionData() {
  const includeSync = ref(false)
  try {
    await ElMessageBox.confirm(
      () =>
        h('div', null, [
          h('p', { style: 'margin: 0 0 12px' }, t('other.purge.confirm.data.message')),
          h(
            ElCheckbox,
            {
              modelValue: includeSync.value,
              'onUpdate:modelValue': (value: CheckboxValueType) =>
                (includeSync.value = value === true),
            },
            () => t('other.purge.confirm.data.includeSync'),
          ),
        ]),
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

  void clearExtensionDataAndReload(includeSync.value)
}

async function confirmClearWallpaperData() {
  await confirmAndRun(
    t('other.purge.confirm.wallpaper.message'),
    t('other.purge.confirm.wallpaper.title'),
    clearWallpaperData,
  )
}

async function confirmClearIconCache() {
  await confirmAndRun(
    t('other.purge.confirm.icon.message'),
    t('other.purge.confirm.icon.title'),
    clearIconCache,
  )
}

function showLoading(text: string) {
  return ElLoading.service({
    lock: true,
    text,
    body: true,
    background: 'var(--el-overlay-color-light)',
  })
}

async function showClearFailure(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error)
  await ElMessageBox.alert(
    h('p', { style: 'margin: 0; overflow-wrap: anywhere' }, detail),
    t('other.purge.failed.title'),
    {
      confirmButtonText: t('other.purge.failed.refresh'),
      showClose: false,
      closeOnClickModal: false,
      closeOnPressEscape: false,
      type: 'error',
    },
  )
  location.reload()
}

async function runClearAndReload(text: string, task: () => Promise<void>) {
  const loading = showLoading(text)
  try {
    await task()
    if (!(await reloadNewtabTabs())) location.reload()
  } catch (error) {
    loading.close()
    console.error('Failed to clear data:', error)
    await showClearFailure(error)
  }
}

async function clearWallpaperData() {
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

  await runClearAndReload(t('other.purge.confirm.wallpaper.purging'), async () => {
    await idbClearMany(['wallpaper', 'wallpaperDark', 'wallpaperBing', 'onlineWallpaperCache'])
    await wallpaperUrlCache.setValue({ light: '', dark: '', bing: '' })
    resetSettings()
    await settings.save()
  })
}

async function clearExtensionDataAndReload(includeSync: boolean) {
  await runClearAndReload(t('other.purge.confirm.data.purging'), async () => {
    await clearExtensionData({ includeSync })
  })
}

async function clearIconCache() {
  await runClearAndReload(t('other.purge.confirm.icon.purging'), clearFaviconCache)
}

function beforeSyncChange(): boolean {
  openSyncRetirement()
  return false
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
  await confirmAndRun(
    t('other.importExport.warningDialog.content'),
    t('other.importExport.warningDialog.title'),
    () => fileInput.value?.click(),
    {
      confirmButtonText: t('other.importExport.warningDialog.yes'),
      cancelButtonText: t('other.importExport.warningDialog.no'),
    },
  )
}

async function exportBackup() {
  const backup: Backup = {
    settings: settings.$state,
    quickLinks: quickLinks.getSnapshot(),
    customSearchEngines: customSearchEngineStore.$state,
  }

  downloadJSON<Backup>(backup, 'lemon-new-tab-backup.json')
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
      throw new Error(t('other.importExport.versionMismatch'))
    }

    const ignoredEnabledSync = data.settings?.sync?.enabled === true

    if (data.settings) {
      data.settings.background.local = settings.$state.background.local
      data.settings.background.localDark = data.settings.background.localDark || {
        id: '',
        url: '',
        mediaType: undefined,
      }
      data.settings.background.bing = settings.$state.background.bing
      data.settings.background.online.url = settings.$state.background.online.url

      const importedSettings = normalizeCurrentSettings(data.settings)
      importedSettings.sync.enabled = false
      settings.$patch(importedSettings)
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

    ensureSearchEngineAvailable(
      settings.search,
      customSearchEngineStore.items.map((engine) => engine.id),
    )

    if (ignoredEnabledSync) ElMessage.info(t('other.syncRetirement.importIgnored'))
  })
}

/**
 * 通用文件导入处理函数
 */
function handleFileImport<T>(
  event: Event,
  inputRef: Ref<HTMLInputElement | null>,
  validator: (data: unknown) => data is T,
  onSuccess: (data: T) => Promise<void> | void,
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

  const showImportFailure = (reason: string) => {
    ElMessage.error(t('other.importExport.importFailed', { reason }))
  }

  reader.onload = () => {
    try {
      const json = JSON.parse(reader.result as string)
      if (validator(json)) {
        fileContent = json
      } else {
        parseError = t('other.importExport.invalidFileFormat')
        showImportFailure(parseError)
      }
    } catch {
      parseError = t('other.importExport.invalidJSON')
      showImportFailure(parseError)
    }
  }

  reader.readAsText(file)
  return new Promise<void>((resolve) => {
    reader.onloadend = async () => {
      try {
        if (fileContent) {
          await onSuccess(fileContent)
          ElMessage.success(t('other.importExport.importSuccess'))
        } else {
          showImportFailure(parseError || t('other.importExport.unknownError'))
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        showImportFailure(reason || t('other.importExport.unknownError'))
      } finally {
        // 重置 file input 以允许导入同一个文件
        if (inputRef.value) inputRef.value.value = ''
        resolve()
      }
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
  <div class="settings__items-container settings-page-grid">
    <SettingsSection
      :title="t('common.sections.general')"
      :summary="t('common.sections.summary.general')"
      content-class="settings-control-grid"
      mobile-open
    >
      <div
        class="settings__item settings__item--horizontal settings__item--with-note settings-control-wide"
      >
        <div class="settings__label">{{ t('other.sync') }}</div>
        <el-switch :model-value="false" :before-change="beforeSyncChange" />
        <p class="settings__item-note">
          {{ t('other.syncWarning') }}
        </p>
      </div>
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('other.language') }}</div>
        <el-select
          v-model="currentLanguage"
          style="width: 165px"
          popper-class="settings-item-popper"
          :show-arrow="false"
          fit-input-width
          @change="changeLanguage"
        >
          <el-option
            v-for="item in supportedLanguages"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </div>
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('newtab:changelog.hideMajor') }}</div>
        <el-switch v-model="settings.hideMajorChangelog" />
      </div>
    </SettingsSection>

    <SettingsSection
      :title="t('common.sections.data')"
      :summary="t('common.sections.summary.data')"
      content-class="settings-control-grid"
    >
      <div
        class="settings__item settings__item--horizontal settings-control-wide settings-control-stackable"
      >
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
      <div
        class="settings__item settings__item--horizontal settings__item--with-note settings-control-wide"
      >
        <div class="settings__label">{{ t('other.faviconCache.label') }}</div>
        <el-switch
          v-model="settings.faviconCacheEnabled"
          :before-change="beforeFaviconCacheChange"
        />
        <p class="settings__item-note">{{ t('other.faviconCache.description') }}</p>
      </div>
    </SettingsSection>

    <SettingsSection
      :title="t('common.sections.danger')"
      :summary="t('common.sections.summary.danger')"
      content-class="settings-control-grid"
    >
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
      <div class="settings__item settings__item--horizontal settings-control-wide">
        <div class="settings__label">{{ t('other.purge.data') }}</div>
        <el-button type="danger" :icon="DeleteForeverOutlined" @click="confirmClearExtensionData">
          {{ t('other.purge.btn') }}
        </el-button>
      </div>
    </SettingsSection>
    <input
      ref="fileInput"
      type="file"
      accept="application/json"
      style="display: none"
      @change="handleFileChange"
    />
  </div>
</template>
