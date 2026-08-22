<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import CallMergeRound from '~icons/ic/round-call-merge'
import ComputerRound from '~icons/ic/round-computer'
import DeleteForeverRound from '~icons/ic/round-delete-forever'
import DevicesRound from '~icons/ic/round-devices'
import DownloadRound from '~icons/ic/round-download'
import HistoryRound from '~icons/ic/round-history'
import LockRound from '~icons/ic/round-lock'
import SecurityRound from '~icons/ic/round-security'
import StorageRound from '~icons/ic/round-storage'
import WallpaperRound from '~icons/ic/round-wallpaper'

import { downloadBlob } from '@/shared/download'
import {
  acceptRemoteSyncReset,
  commitCompressedSyncWallpaper,
  disconnectSyncConnection,
  downloadSyncCorruption,
  getSyncConflict,
  getSyncDevices,
  getSyncHistory,
  inspectSyncCorruption,
  migrateSyncEncryption,
  previewSyncHistory,
  repairSyncCorruption,
  resetSyncedData,
  resolveSyncConflict,
  restoreSyncHistory,
  stopAndDeleteSyncedWallpapers,
  unlockSyncEncryption,
} from '@/shared/webdavSync/bridge'
import {
  captureBrowserSyncSnapshot,
  getSelectedBrowserWallpaper,
} from '@/shared/webdavSync/browserData'
import { MAX_SYNC_WALLPAPER_BYTES } from '@/shared/webdavSync/catalog'
import {
  createWallpaperCompressionCandidate,
  type WallpaperCompressionCandidate,
} from '@/shared/webdavSync/wallpaperCompression'
import type {
  BrowserCorruptionInspection,
  BrowserSyncDeviceEntry,
  BrowserSyncHistoryEntry,
  BrowserSyncHistoryPreview,
} from '@/shared/webdavSync/browserEngine'
import type {
  LocalSyncStateV1,
  SyncConflict,
  SyncConflictResolution,
} from '@/shared/webdavSync/types'

type DialogMode = 'conflict' | 'devices' | 'disconnect' | 'encryption' | 'history' | 'repair' | null

const props = defineProps<{ state: LocalSyncStateV1 }>()
const emit = defineEmits<{ updated: [] }>()
const model = defineModel<DialogMode>({ required: true })
const { t } = useTranslation('settings')

const loading = ref(false)
const conflicts = shallowRef<SyncConflict[]>([])
const remoteVersions = ref<Array<{ revisionId: string; deviceName: string; modifiedAt: string }>>([])
const resolutions = reactive<Record<string, SyncConflictResolution['choice']>>({})
const history = ref<BrowserSyncHistoryEntry[]>([])
const historyPreview = shallowRef<BrowserSyncHistoryPreview>()
const devices = ref<BrowserSyncDeviceEntry[]>([])
const corruption = shallowRef<BrowserCorruptionInspection>()
const corruptedDownloaded = ref(false)
const repairChoice = ref<'local' | 'previous'>('previous')
const currentEncryptionPassword = ref('')
const newEncryptionPassword = ref('')
const deleteConfirmation = ref('')
const resetPassword = ref('')
const deletingWallpapers = ref(false)
const compressingWallpaper = ref(false)
const committingWallpaper = ref(false)
const compressionVariant = ref<'dark' | 'light'>('light')
const compressionFormat = ref<'image/jpeg' | 'image/webp'>('image/webp')
const compressionQuality = ref(0.85)
const compressionDimension = ref(2560)
const compressionCandidate = shallowRef<WallpaperCompressionCandidate>()
const compressionPreviewUrl = ref('')
const compressionSources = ref<Array<{ variant: 'dark' | 'light'; blob: Blob }>>([])

const oversizedWallpapers = computed(() =>
  compressionSources.value.filter(({ blob }) => blob.size > MAX_SYNC_WALLPAPER_BYTES),
)
const compressionSource = computed(() =>
  compressionSources.value.find(({ variant }) => variant === compressionVariant.value),
)

const allConflictsResolved = computed<boolean>(
  () =>
    conflicts.value.length > 0 &&
    conflicts.value.every((item) => Boolean(resolutions[item.id])),
)

function dialogVisible(name: Exclude<DialogMode, null>) {
  return computed<boolean>({
    get: () => model.value === name,
    set: (value) => {
      if (!value && model.value === name) model.value = null
    },
  })
}

const conflictVisible = dialogVisible('conflict')
const historyVisible = dialogVisible('history')
const devicesVisible = dialogVisible('devices')
const encryptionVisible = dialogVisible('encryption')
const repairVisible = dialogVisible('repair')
const disconnectVisible = dialogVisible('disconnect')

function readable(value: unknown) {
  if (value === undefined) return t('webdavSync.conflicts.deleted')
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  )
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function clearCompressionPreview() {
  if (compressionPreviewUrl.value) URL.revokeObjectURL(compressionPreviewUrl.value)
  compressionPreviewUrl.value = ''
  compressionCandidate.value = undefined
}

async function loadCompressionSources() {
  const values = await Promise.all(
    (['light', 'dark'] as const).map(async (variant) => ({
      variant,
      blob: await getSelectedBrowserWallpaper(variant),
    })),
  )
  compressionSources.value = values.filter(
    (item): item is { variant: 'dark' | 'light'; blob: Blob } => item.blob instanceof Blob,
  )
  compressionVariant.value =
    compressionSources.value.find(({ blob }) => blob.size > MAX_SYNC_WALLPAPER_BYTES)?.variant ??
    compressionSources.value[0]?.variant ??
    'light'
}

async function buildCompressionPreview() {
  if (!compressionSource.value) return
  compressingWallpaper.value = true
  clearCompressionPreview()
  try {
    compressionCandidate.value = await createWallpaperCompressionCandidate(
      compressionSource.value.blob,
      {
        maxDimension: compressionDimension.value,
        mimeType: compressionFormat.value,
        quality: compressionQuality.value,
      },
    )
    compressionPreviewUrl.value = URL.createObjectURL(compressionCandidate.value.blob)
  } catch (error) {
    showError(error)
  } finally {
    compressingWallpaper.value = false
  }
}

async function commitCompression() {
  if (!compressionCandidate.value) return
  committingWallpaper.value = true
  try {
    await commitCompressedSyncWallpaper(compressionVariant.value, compressionCandidate.value.blob)
    ElMessage.success(t('webdavSync.repair.compressionDone'))
    clearCompressionPreview()
    repairVisible.value = false
    emit('updated')
  } catch (error) {
    showError(error)
  } finally {
    committingWallpaper.value = false
  }
}

function showError(error: unknown) {
  ElMessage.error(error instanceof Error ? error.message : t('webdavSync.errors.unknown'))
}

async function loadConflicts() {
  loading.value = true
  try {
    const details = await getSyncConflict()
    conflicts.value = details?.conflicts ?? []
    remoteVersions.value = details?.remoteVersions ?? []
    for (const key of Object.keys(resolutions)) delete resolutions[key]
  } catch (error) {
    showError(error)
  } finally {
    loading.value = false
  }
}

async function submitConflicts() {
  if (!allConflictsResolved.value) return
  loading.value = true
  try {
    const values = conflicts.value.map((item) => ({
      conflictId: item.id,
      choice: resolutions[item.id]!,
      ...(resolutions[item.id] === 'both' ? { duplicateId: crypto.randomUUID() } : {}),
    }))
    await resolveSyncConflict(values)
    ElMessage.success(t('webdavSync.conflicts.resolved'))
    conflictVisible.value = false
    emit('updated')
  } catch (error) {
    showError(error)
  } finally {
    loading.value = false
  }
}

async function loadHistory() {
  historyPreview.value = undefined
  loading.value = true
  try {
    history.value = await getSyncHistory()
  } catch (error) {
    showError(error)
  } finally {
    loading.value = false
  }
}

async function previewHistory(revision: BrowserSyncHistoryEntry) {
  loading.value = true
  try {
    historyPreview.value = await previewSyncHistory(revision.revisionId)
  } catch (error) {
    showError(error)
  } finally {
    loading.value = false
  }
}

async function restore(preview: BrowserSyncHistoryPreview) {
  try {
    await ElMessageBox.confirm(
      t('webdavSync.history.restoreDescription'),
      t('webdavSync.history.restoreTitle'),
      { type: 'warning' },
    )
  } catch {
    return
  }
  loading.value = true
  try {
    await restoreSyncHistory(preview)
    ElMessage.success(t('webdavSync.history.restored'))
    historyPreview.value = undefined
    await loadHistory()
    emit('updated')
  } catch (error) {
    showError(error)
  } finally {
    loading.value = false
  }
}

async function loadDevices() {
  loading.value = true
  try {
    devices.value = await getSyncDevices()
  } catch (error) {
    showError(error)
  } finally {
    loading.value = false
  }
}

async function unlock() {
  if (!currentEncryptionPassword.value) return
  loading.value = true
  try {
    await unlockSyncEncryption(currentEncryptionPassword.value)
    currentEncryptionPassword.value = ''
    encryptionVisible.value = false
    emit('updated')
  } catch (error) {
    showError(error)
  } finally {
    loading.value = false
  }
}

async function migrateEncryption() {
  if (newEncryptionPassword.value.length < 8) return
  loading.value = true
  try {
    await migrateSyncEncryption(
      newEncryptionPassword.value,
      props.state.encrypted ? currentEncryptionPassword.value : undefined,
    )
    ElMessage.success(t('webdavSync.encryption.migrated'))
    currentEncryptionPassword.value = ''
    newEncryptionPassword.value = ''
    encryptionVisible.value = false
    emit('updated')
  } catch (error) {
    showError(error)
  } finally {
    loading.value = false
  }
}

async function loadRepair() {
  corruption.value = undefined
  corruptedDownloaded.value = false
  clearCompressionPreview()
  await loadCompressionSources()
  if (props.state.pauseReason !== 'corrupted-remote') return
  loading.value = true
  try {
    corruption.value = await inspectSyncCorruption()
  } catch (error) {
    showError(error)
  } finally {
    loading.value = false
  }
}

async function downloadCorruption() {
  if (!corruption.value) return
  loading.value = true
  try {
    const result = await downloadSyncCorruption(
      corruption.value.corruptedRevisionId,
      corruption.value.actualPayloadHash,
    )
    downloadBlob(new Blob([result.bytes]), result.filename)
    corruptedDownloaded.value = true
  } catch (error) {
    showError(error)
  } finally {
    loading.value = false
  }
}

async function repairCorruption() {
  if (!corruption.value || !corruptedDownloaded.value) return
  loading.value = true
  try {
    await repairSyncCorruption({
      actualPayloadHash: corruption.value.actualPayloadHash,
      choice: corruption.value.localMatchesPrevious ? undefined : repairChoice.value,
      downloaded: true,
      revisionId: corruption.value.corruptedRevisionId,
    })
    ElMessage.success(t('webdavSync.repair.completed'))
    repairVisible.value = false
    emit('updated')
  } catch (error) {
    showError(error)
  } finally {
    loading.value = false
  }
}

async function acceptReset(mode: 'apply' | 'merge') {
  loading.value = true
  try {
    await acceptRemoteSyncReset(mode, currentEncryptionPassword.value || undefined)
    repairVisible.value = false
    emit('updated')
  } catch (error) {
    showError(error)
  } finally {
    loading.value = false
  }
}

async function stopWallpapers() {
  deletingWallpapers.value = true
  try {
    await stopAndDeleteSyncedWallpapers()
    ElMessage.success(t('webdavSync.repair.wallpapersStopped'))
    repairVisible.value = false
    emit('updated')
  } catch (error) {
    showError(error)
  } finally {
    deletingWallpapers.value = false
  }
}

async function disconnect(deleteRemote: boolean) {
  if (deleteRemote && deleteConfirmation.value !== 'DELETE WEBDAV DATA') return
  loading.value = true
  try {
    await disconnectSyncConnection(
      deleteRemote,
      deleteRemote ? deleteConfirmation.value : undefined,
    )
    ElMessage.success(
      t(deleteRemote ? 'webdavSync.disconnect.deleted' : 'webdavSync.disconnect.disconnected'),
    )
    disconnectVisible.value = false
    emit('updated')
  } catch (error) {
    showError(error)
  } finally {
    loading.value = false
  }
}

async function resetGeneration() {
  try {
    await ElMessageBox.confirm(
      t('webdavSync.disconnect.resetDescription'),
      t('webdavSync.disconnect.resetTitle'),
      { type: 'warning' },
    )
  } catch {
    return
  }
  loading.value = true
  try {
    const snapshot = await captureBrowserSyncSnapshot(props.state.scope)
    await resetSyncedData(snapshot, resetPassword.value || undefined)
    ElMessage.success(t('webdavSync.disconnect.resetDone'))
    disconnectVisible.value = false
    emit('updated')
  } catch (error) {
    showError(error)
  } finally {
    loading.value = false
  }
}

async function loadDisconnectImpact() {
  deleteConfirmation.value = ''
  resetPassword.value = ''
  await Promise.all([loadDevices(), loadHistory()])
}

watch(model, (mode) => {
  if (mode === 'conflict') void loadConflicts()
  else if (mode === 'history') void loadHistory()
  else if (mode === 'devices') void loadDevices()
  else if (mode === 'repair') void loadRepair()
  else if (mode === 'disconnect') void loadDisconnectImpact()
})

watch(compressionVariant, clearCompressionPreview)
onBeforeUnmount(clearCompressionPreview)
</script>

<template>
  <el-dialog v-model="conflictVisible" :title="t('webdavSync.conflicts.title')" width="820px" :close-on-click-modal="false" destroy-on-close>
    <el-alert type="warning" :closable="false" show-icon :title="t('webdavSync.conflicts.paused')">{{ t('webdavSync.conflicts.description') }}</el-alert>
    <div v-if="remoteVersions.length" class="conflict-versions">
      <span>{{ t('webdavSync.conflicts.remoteVersions') }}</span>
      <el-tag v-for="version in remoteVersions" :key="version.revisionId" size="small" effect="plain">
        {{ version.deviceName }} · {{ formatDate(version.modifiedAt) }}
      </el-tag>
    </div>
    <div v-loading="loading" class="conflict-list">
      <article v-for="conflict in conflicts" :key="conflict.id" class="conflict-item">
        <header><el-tag size="small" effect="plain">{{ t(`webdavSync.conflicts.categories.${conflict.category}`) }}</el-tag><strong>{{ conflict.path }}</strong></header>
        <div class="conflict-base"><span>{{ t('webdavSync.conflicts.base') }}</span><code>{{ readable(conflict.base) }}</code></div>
        <el-radio-group v-model="resolutions[conflict.id]" class="conflict-options">
          <el-radio value="local" border><computer-round /> {{ t('webdavSync.conflicts.local', { device: state.deviceName }) }}<small>{{ readable(conflict.local) }}</small></el-radio>
          <el-radio value="remote" border><storage-round /> {{ t('webdavSync.conflicts.remote') }}<small>{{ readable(conflict.remote) }}</small></el-radio>
          <el-radio v-if="conflict.canKeepBoth" value="both" border><call-merge-round /> {{ t('webdavSync.conflicts.both') }}<small>{{ t('webdavSync.conflicts.bothNote') }}</small></el-radio>
        </el-radio-group>
      </article>
      <el-empty v-if="!loading && conflicts.length === 0" :description="t('webdavSync.conflicts.empty')" />
    </div>
    <template #footer><el-button @click="conflictVisible = false">{{ t('webdavSync.later') }}</el-button><el-button type="primary" :loading="loading" :disabled="!allConflictsResolved" @click="submitConflicts">{{ t('webdavSync.conflicts.finish') }}</el-button></template>
  </el-dialog>

  <el-dialog v-model="historyVisible" :title="t('webdavSync.history.title')" width="720px" destroy-on-close>
    <div v-loading="loading">
      <template v-if="historyPreview">
        <el-alert v-if="historyPreview.wallpaperUnavailable.length" type="warning" :closable="false" show-icon :title="t('webdavSync.history.wallpaperMissing')" />
        <div class="history-diff-list">
          <article v-for="difference in historyPreview.differences" :key="`${difference.category}:${difference.path}`">
            <header><el-tag size="small" effect="plain">{{ t(`webdavSync.conflicts.categories.${difference.category}`) }}</el-tag><strong>{{ difference.path }}</strong></header>
            <div><span>{{ t('webdavSync.history.current') }}</span><code>{{ readable(difference.current) }}</code></div>
            <div><span>{{ t('webdavSync.history.target') }}</span><code>{{ readable(difference.target) }}</code></div>
          </article>
          <el-empty v-if="historyPreview.differences.length === 0" :description="t('webdavSync.history.noDifferences')" />
        </div>
        <el-alert v-if="historyPreview.truncated" type="info" :closable="false">{{ t('webdavSync.history.truncated') }}</el-alert>
        <div class="dialog-actions"><el-button @click="historyPreview = undefined">{{ t('webdavSync.history.back') }}</el-button><el-button type="primary" @click="restore(historyPreview)">{{ t('webdavSync.history.restore') }}</el-button></div>
      </template>
      <div v-else class="history-list">
        <article v-for="revision in history" :key="revision.revisionId">
          <history-round />
          <div><strong>{{ formatDate(revision.createdAt) }} · {{ t(`webdavSync.history.reasons.${revision.reason}`) }}</strong><span>{{ revision.deviceName }}</span><small v-if="Object.values(revision.wallpaperAvailable).includes(false)">{{ t('webdavSync.history.wallpaperMissing') }}</small></div>
          <el-button size="small" @click="previewHistory(revision)">{{ t('webdavSync.history.preview') }}</el-button>
        </article>
        <el-empty v-if="!loading && history.length === 0" />
      </div>
    </div>
  </el-dialog>

  <el-dialog v-model="devicesVisible" :title="t('webdavSync.devices.title')" width="650px" destroy-on-close>
    <div v-loading="loading" class="device-list">
      <article v-for="device in devices" :key="device.deviceId"><devices-round /><div><strong>{{ device.name }}</strong><span>{{ t('webdavSync.devices.firstSeen', { time: formatDate(device.firstSeenAt) }) }}</span></div><div><span>{{ formatDate(device.lastSeenAt) }}</span><el-tag v-if="device.stale" type="warning" size="small">{{ t('webdavSync.devices.stale') }}</el-tag></div></article>
    </div>
    <el-alert type="warning" :closable="false" show-icon :title="t('webdavSync.devices.unknownTitle')">{{ t('webdavSync.devices.unknownDescription') }}</el-alert>
  </el-dialog>

  <el-dialog v-model="encryptionVisible" :title="t('webdavSync.encryption.title')" width="600px" destroy-on-close>
    <div class="dialog-heading"><security-round /><div><strong>{{ state.encrypted ? t('webdavSync.encryption.enabled') : t('webdavSync.encryption.disabled') }}</strong><span>{{ t('webdavSync.encryption.description') }}</span></div></div>
    <template v-if="state.pauseReason === 'encryption-password'">
      <el-form-item :label="t('webdavSync.encryption.password')"><el-input v-model="currentEncryptionPassword" type="password" show-password /></el-form-item>
      <el-alert type="info" :closable="false">{{ t('webdavSync.encryption.keyNote') }}</el-alert>
    </template>
    <template v-else>
      <el-form-item v-if="state.encrypted" :label="t('webdavSync.encryption.currentPassword')"><el-input v-model="currentEncryptionPassword" type="password" show-password /></el-form-item>
      <el-form-item :label="state.encrypted ? t('webdavSync.encryption.newPassword') : t('webdavSync.encryption.password')"><el-input v-model="newEncryptionPassword" type="password" show-password /></el-form-item>
      <el-alert type="warning" :closable="false" show-icon>{{ t('webdavSync.encryption.migrationNote') }}</el-alert>
    </template>
    <template #footer><el-button @click="encryptionVisible = false">{{ t('newtab:common.cancel') }}</el-button><el-button v-if="state.pauseReason === 'encryption-password'" type="primary" :icon="LockRound" :loading="loading" :disabled="!currentEncryptionPassword" @click="unlock">{{ t('webdavSync.encryption.unlock') }}</el-button><el-button v-else type="primary" :loading="loading" :disabled="newEncryptionPassword.length < 8 || (state.encrypted && !currentEncryptionPassword)" @click="migrateEncryption">{{ t('webdavSync.encryption.migrate') }}</el-button></template>
  </el-dialog>

  <el-dialog v-model="repairVisible" :title="t('webdavSync.repair.title')" width="650px" destroy-on-close>
    <template v-if="state.pauseReason === 'corrupted-remote'">
      <el-alert type="error" :closable="false" show-icon :title="t('webdavSync.repair.corrupted')">{{ t('webdavSync.repair.corruptedDescription') }}</el-alert>
      <div v-if="corruption" class="repair-details"><p>{{ t('webdavSync.repair.revision', { id: corruption.corruptedRevisionId }) }}</p><p>{{ t('webdavSync.repair.size', { size: corruption.payloadSize }) }}</p></div>
      <el-button :icon="DownloadRound" :loading="loading" @click="downloadCorruption">{{ corruptedDownloaded ? t('webdavSync.repair.downloaded') : t('webdavSync.repair.download') }}</el-button>
      <el-radio-group v-if="corruption && !corruption.localMatchesPrevious" v-model="repairChoice" class="repair-options"><el-radio value="previous">{{ t('webdavSync.repair.previous') }}</el-radio><el-radio value="local">{{ t('webdavSync.repair.local') }}</el-radio></el-radio-group>
      <el-alert v-else-if="corruption?.localMatchesPrevious" type="info" :closable="false">{{ t('webdavSync.repair.same') }}</el-alert>
      <div class="dialog-actions"><el-button type="primary" :disabled="!corruptedDownloaded" :loading="loading" @click="repairCorruption">{{ t('webdavSync.repair.action') }}</el-button></div>
    </template>
    <template v-else-if="state.pauseReason === 'remote-reset'">
      <el-alert type="warning" :closable="false" show-icon :title="t('webdavSync.repair.remoteReset')">{{ t('webdavSync.repair.remoteResetDescription') }}</el-alert>
      <el-form-item v-if="state.encrypted" :label="t('webdavSync.encryption.password')"><el-input v-model="currentEncryptionPassword" type="password" show-password /></el-form-item>
      <div class="dialog-actions"><el-button @click="acceptReset('merge')">{{ t('webdavSync.repair.mergeReset') }}</el-button><el-button type="primary" @click="acceptReset('apply')">{{ t('webdavSync.repair.applyReset') }}</el-button></div>
    </template>
    <template v-else-if="state.wallpaperStatus || state.pauseReason === 'storage-full' || oversizedWallpapers.length">
      <el-alert type="warning" :closable="false" show-icon :title="t('webdavSync.repair.wallpaperTitle')">{{ t('webdavSync.repair.wallpaperDescription') }}</el-alert>
      <section v-if="compressionSources.length" class="compression-panel">
        <div class="compression-controls">
          <el-select v-model="compressionVariant" :aria-label="t('webdavSync.repair.compressionVariant')">
            <el-option v-for="source in compressionSources" :key="source.variant" :label="t(`webdavSync.repair.${source.variant}Wallpaper`, { size: formatBytes(source.blob.size) })" :value="source.variant" />
          </el-select>
          <el-select v-model="compressionFormat" :aria-label="t('webdavSync.repair.compressionFormat')">
            <el-option label="WebP" value="image/webp" />
            <el-option label="JPEG" value="image/jpeg" />
          </el-select>
          <el-input-number v-model="compressionDimension" :min="512" :max="4096" :step="256" controls-position="right" />
        </div>
        <label class="compression-quality"><span>{{ t('webdavSync.repair.compressionQuality', { quality: Math.round(compressionQuality * 100) }) }}</span><el-slider v-model="compressionQuality" :min="0.5" :max="0.95" :step="0.05" /></label>
        <el-button :icon="WallpaperRound" :loading="compressingWallpaper" @click="buildCompressionPreview">{{ t('webdavSync.repair.previewCompression') }}</el-button>
        <div v-if="compressionCandidate && compressionPreviewUrl" class="compression-preview">
          <img :src="compressionPreviewUrl" :alt="t('webdavSync.repair.compressionPreview')">
          <div><strong>{{ formatBytes(compressionCandidate.originalSize) }} → {{ formatBytes(compressionCandidate.blob.size) }}</strong><span>{{ compressionCandidate.width }} × {{ compressionCandidate.height }}</span></div>
        </div>
        <el-alert v-if="compressionCandidate" type="info" :closable="false">{{ t('webdavSync.repair.compressionReplaceNote') }}</el-alert>
      </section>
      <div class="dialog-actions">
        <el-button type="danger" plain :loading="deletingWallpapers" @click="stopWallpapers">{{ t('webdavSync.repair.stopWallpapers') }}</el-button>
        <el-button v-if="compressionCandidate" type="primary" :loading="committingWallpaper" :disabled="compressionCandidate.blob.size >= compressionCandidate.originalSize" @click="commitCompression">{{ t('webdavSync.repair.replaceAndSync') }}</el-button>
      </div>
    </template>
    <el-result v-else icon="success" :title="t('webdavSync.repair.healthy')" :sub-title="t('webdavSync.repair.healthyDescription')" />
  </el-dialog>

  <el-dialog v-model="disconnectVisible" :title="t('webdavSync.disconnect.title')" width="620px" :close-on-click-modal="false" destroy-on-close>
    <div v-loading="loading" class="disconnect-actions">
      <section><div><strong>{{ t('webdavSync.disconnect.keepTitle') }}</strong><p>{{ t('webdavSync.disconnect.keepDescription') }}</p></div><el-button type="primary" @click="disconnect(false)">{{ t('webdavSync.disconnect.keepAction') }}</el-button></section>
      <el-collapse class="compact-danger"><el-collapse-item name="reset" :title="t('webdavSync.disconnect.resetTitle')"><p>{{ t('webdavSync.disconnect.resetDescription') }}</p><el-input v-if="state.encrypted" v-model="resetPassword" type="password" show-password :placeholder="t('webdavSync.encryption.currentPassword')" /><el-button :icon="CallMergeRound" @click="resetGeneration">{{ t('webdavSync.disconnect.resetAction') }}</el-button></el-collapse-item></el-collapse>
      <el-collapse class="compact-danger"><el-collapse-item name="delete" :title="t('webdavSync.disconnect.deleteTitle')"><el-alert type="error" :closable="false" show-icon :title="t('webdavSync.disconnect.impact', { devices: devices.length, versions: history.length })">{{ t('webdavSync.disconnect.deleteDescription') }}</el-alert><p>{{ t('webdavSync.disconnect.typePrompt', { text: 'DELETE WEBDAV DATA' }) }}</p><el-input v-model="deleteConfirmation" autocomplete="off" /><el-button type="danger" :icon="DeleteForeverRound" :disabled="deleteConfirmation !== 'DELETE WEBDAV DATA'" @click="disconnect(true)">{{ t('webdavSync.disconnect.deleteAction') }}</el-button></el-collapse-item></el-collapse>
    </div>
  </el-dialog>
</template>

<style scoped lang="scss">
.conflict-list,
.history-list,
.history-diff-list,
.device-list {
  display: grid;
  gap: 10px;
  max-height: 52vh;
  padding-top: 14px;
  overflow: auto;
}

.history-diff-list article {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--le-radius-inner, 10px);

  header,
  div {
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }

  span {
    flex: 0 0 70px;
    color: var(--el-text-color-secondary);
  }

  code {
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
}

.conflict-versions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-top: 12px;

  > span {
    color: var(--el-text-color-secondary);
  }
}

.conflict-item,
.history-list article,
.device-list article,
.disconnect-actions section {
  padding: 12px;
  background: var(--settings-option-background, var(--el-fill-color-light));
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--le-radius-inner, 10px);
}

.conflict-item header {
  display: flex;
  gap: 8px;
  align-items: center;
}

.conflict-base {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px;
  margin: 10px 0;

  code {
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
}

.conflict-options {
  display: grid;
  gap: 7px;

  :deep(.el-radio) {
    width: 100%;
    height: auto;
    min-height: 42px;
    margin: 0;
  }

  small {
    display: block;
    max-width: 620px;
    margin-top: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--el-text-color-secondary);
    white-space: nowrap;
  }
}

.history-list article,
.device-list article {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;

  > svg {
    width: 22px;
    height: 22px;
  }

  div {
    display: grid;
    gap: 3px;
  }

  span,
  small {
    color: var(--el-text-color-secondary);
  }
}

.dialog-heading {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 16px;

  > svg {
    width: 32px;
    height: 32px;
    color: var(--el-color-primary);
  }

  div {
    display: grid;
    gap: 4px;
  }

  span {
    color: var(--el-text-color-secondary);
  }
}

.repair-details,
.repair-options,
.dialog-actions {
  margin-top: 14px;
}

.compression-panel {
  display: grid;
  gap: 12px;
  margin-top: 14px;
}

.compression-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 110px 130px;
  gap: 8px;
}

.compression-quality {
  display: grid;
  grid-template-columns: auto minmax(120px, 1fr);
  gap: 14px;
  align-items: center;
}

.compression-preview {
  display: flex;
  gap: 12px;
  align-items: center;

  img {
    width: 128px;
    height: 72px;
    object-fit: cover;
    border-radius: var(--le-radius-inner, 10px);
  }

  div {
    display: grid;
    gap: 4px;
  }

  span {
    color: var(--el-text-color-secondary);
  }
}

.repair-options {
  display: grid;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
}

.disconnect-actions {
  display: grid;
  gap: 10px;

  section {
    display: flex;
    gap: 14px;
    align-items: center;
    justify-content: space-between;

    p {
      margin: 4px 0 0;
      color: var(--el-text-color-secondary);
    }
  }
}

.compact-danger {
  --el-collapse-header-height: 42px;
  padding: 0 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--le-radius-inner, 10px);

  p {
    color: var(--el-text-color-secondary);
  }

  .el-button {
    margin: 10px 0;
  }
}

@media (width <= 599px) {
  .compression-controls {
    grid-template-columns: 1fr;
  }

  .history-list article,
  .device-list article {
    grid-template-columns: auto minmax(0, 1fr);

    > .el-button,
    > div:last-child {
      grid-column: 2;
    }
  }

  .disconnect-actions section {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
