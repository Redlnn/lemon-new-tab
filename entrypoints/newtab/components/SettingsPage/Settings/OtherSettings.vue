<script setup lang="ts">
import { type CheckboxValueType, ElCheckbox, ElLoading, ElRadio, ElRadioGroup } from 'element-plus'
import { useTranslation } from 'i18next-vue'
import DeleteForeverOutlined from '~icons/ic/outline-delete-forever'
import DownloadRound from '~icons/ic/round-download'
import FileUploadRound from '~icons/ic/round-file-upload'

import { browser } from 'wxt/browser'

import { downloadBlob } from '@/shared/download'
import { clearFaviconCache } from '@/shared/media'
import { defaultSettings, useSettingsStore } from '@/shared/settings'
import { clearExtensionData, reloadNewtabTabs } from '@/shared/settings/legacySettingsRecovery'
import { idbClearMany } from '@/shared/storage/idb'
import {
  disconnectSyncConnection,
  getSyncState,
  sendSyncDataChanged,
} from '@/shared/webdavSync/bridge'
import {
  applyPreparedBrowserImport,
  createBrowserJsonBackup,
  mergePreparedBrowserImport,
  prepareBrowserImport,
} from '@/shared/webdavSync/browserBackup'

import {
  PermissionContext,
  PermissionResult,
  usePermission,
} from '@newtab/composables/usePermission'
import { wallpaperUrlCache } from '@newtab/shared/wallpaper'

import SyncAvailabilityIcon from '../components/SyncAvailabilityIcon.vue'

import SettingsSection from './SettingsSection.vue'

const { t, i18next } = useTranslation('settings')

const settings = useSettingsStore()
const { checkAndRequestPermission } = usePermission()
const faviconPermissionPending = ref(false)

async function refreshFaviconPermission() {
  faviconPermissionPending.value =
    settings.faviconCacheEnabled && !(await browser.permissions.contains({ origins: ['*://*/*'] }))
}

onMounted(refreshFaviconPermission)
watch(() => settings.faviconCacheEnabled, refreshFaviconPermission)

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
  const syncState = await getSyncState().catch(() => null)
  const resetMode = ref<'delete' | 'keep'>('keep')
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
          ...(syncState?.configured
            ? [
                h('p', { style: 'margin: 16px 0 8px' }, t('other.purge.confirm.data.syncQuestion')),
                h(
                  ElRadioGroup,
                  {
                    modelValue: resetMode.value,
                    'onUpdate:modelValue': (value: string | number | boolean | undefined) => {
                      if (value === 'delete' || value === 'keep') resetMode.value = value
                    },
                  },
                  () => [
                    h(ElRadio, { value: 'keep' }, () => t('other.purge.confirm.data.keepRemote')),
                    h(ElRadio, { value: 'delete' }, () =>
                      t('other.purge.confirm.data.deleteRemote'),
                    ),
                  ],
                ),
              ]
            : []),
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

  const selectedMode = syncState?.configured ? resetMode.value : 'keep'
  if (syncState?.configured && selectedMode === 'delete') {
    try {
      const confirmation = await ElMessageBox.prompt(
        t('other.purge.confirm.data.deleteRemotePrompt', { text: 'DELETE WEBDAV DATA' }),
        t('other.purge.confirm.data.deleteRemoteTitle'),
        { showCancelButton: true },
      )
      if (confirmation.value !== 'DELETE WEBDAV DATA') return
    } catch {
      return
    }
  }
  void clearExtensionDataAndReload(includeSync.value, selectedMode)
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

async function clearExtensionDataAndReload(
  includeLegacySync: boolean,
  resetMode: 'delete' | 'keep',
) {
  await runClearAndReload(t('other.purge.confirm.data.purging'), async () => {
    const state = await getSyncState().catch(() => null)
    if (state?.configured) {
      await disconnectSyncConnection(
        resetMode === 'delete',
        resetMode === 'delete' ? 'DELETE WEBDAV DATA' : undefined,
      )
    }
    await clearExtensionData({ includeSync: includeLegacySync })
  })
}

async function clearIconCache() {
  await runClearAndReload(t('other.purge.confirm.icon.purging'), clearFaviconCache)
}

const fileInput = useTemplateRef('fileInput')
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
  const loading = showLoading(t('other.importExport.exporting'))
  try {
    const { json, omissions } = await createBrowserJsonBackup()
    downloadBlob(new Blob([json], { type: 'application/json' }), 'lemon-new-tab-backup.json')
    if (omissions.length)
      ElMessage.warning(t('other.importExport.omittedIcons', { count: omissions.length }))
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t('other.importExport.unknownError'))
  } finally {
    loading.close()
  }
}

async function chooseImportMode(configured: boolean) {
  if (!configured) return 'replace' as const
  const mode = ref<'merge' | 'replace'>('merge')
  try {
    await ElMessageBox.confirm(
      () =>
        h('div', { class: 'backup-import-modes' }, [
          h('p', null, t('other.importExport.syncMode.description')),
          h(
            ElRadioGroup,
            {
              modelValue: mode.value,
              'onUpdate:modelValue': (value: string | number | boolean | undefined) => {
                if (value === 'merge' || value === 'replace') mode.value = value
              },
            },
            () => [
              h(ElRadio, { value: 'merge' }, () => t('other.importExport.syncMode.merge')),
              h(ElRadio, { value: 'replace' }, () => t('other.importExport.syncMode.replace')),
            ],
          ),
        ]),
      t('other.importExport.syncMode.title'),
      { type: 'warning' },
    )
    return mode.value
  } catch {
    return null
  }
}

async function disconnectBeforeReplacement() {
  const disposition = ref<'delete' | 'keep'>('keep')
  await ElMessageBox.confirm(
    () =>
      h(
        ElRadioGroup,
        {
          modelValue: disposition.value,
          'onUpdate:modelValue': (value: string | number | boolean | undefined) => {
            if (value === 'delete' || value === 'keep') disposition.value = value
          },
        },
        () => [
          h(ElRadio, { value: 'keep' }, () => t('other.importExport.syncMode.keepRemote')),
          h(ElRadio, { value: 'delete' }, () => t('other.importExport.syncMode.deleteRemote')),
        ],
      ),
    t('other.importExport.syncMode.disconnectTitle'),
    { type: 'warning' },
  )
  if (disposition.value === 'delete') {
    const { value } = await ElMessageBox.prompt(
      t('other.importExport.syncMode.deletePrompt', { text: 'DELETE WEBDAV DATA' }),
      t('other.importExport.syncMode.disconnectTitle'),
    )
    if (value !== 'DELETE WEBDAV DATA')
      throw new Error(t('other.importExport.syncMode.confirmMismatch'))
  }
  await disconnectSyncConnection(
    disposition.value === 'delete',
    disposition.value === 'delete' ? 'DELETE WEBDAV DATA' : undefined,
  )
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input?.files?.[0]
  if (!file) {
    ElMessage.error(
      t('other.importExport.importFailed', { reason: t('other.importExport.noFileSelected') }),
    )
    return
  }
  const loading = showLoading(t('other.importExport.validating'))
  let applying: ReturnType<typeof showLoading> | undefined
  try {
    const prepared = await prepareBrowserImport(file)
    loading.close()
    const state = await getSyncState()
    const mode = await chooseImportMode(state.configured)
    if (!mode) return

    applying = showLoading(t('other.importExport.importing'))
    if (mode === 'replace') {
      if (state.configured) await disconnectBeforeReplacement()
      await applyPreparedBrowserImport(prepared)
    } else {
      const merged = await mergePreparedBrowserImport(prepared, state.scope)
      await applyPreparedBrowserImport(prepared, merged)
      sendSyncDataChanged()
    }
    ElMessage.success(t('other.importExport.importSuccess'))
    if (!(await reloadNewtabTabs())) location.reload()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    ElMessage.error(
      t('other.importExport.importFailed', {
        reason: reason || t('other.importExport.unknownError'),
      }),
    )
  } finally {
    applying?.close()
    loading.close()
    if (fileInput.value) fileInput.value.value = ''
  }
}

const currentLanguage = ref(i18next.language)

const supportedLanguages = computed(() => {
  const locale = currentLanguage.value || navigator.language
  const displayNames = new Intl.DisplayNames([locale], { type: 'language' })

  const languageCodes = ['zh-CN', 'zh-TW', 'zh-HK', 'en', 'tr-TR']
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
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">
          {{ t('other.language') }}
          <SyncAvailabilityIcon catalog-key="ui.language" />
        </div>
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
        <div class="settings__label">
          {{ t('newtab:changelog.hideMajor') }}
          <SyncAvailabilityIcon catalog-key="settings" />
        </div>
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
        <div class="settings__label">
          {{ t('other.faviconCache.label') }}
          <SyncAvailabilityIcon catalog-key="faviconCache" />
          <SyncAvailabilityIcon
            v-if="faviconPermissionPending"
            catalog-key="permission.favicon"
            pending-permission="favicon"
          />
        </div>
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
      accept="application/json,.json"
      style="display: none"
      @change="handleFileChange"
    />
  </div>
</template>
