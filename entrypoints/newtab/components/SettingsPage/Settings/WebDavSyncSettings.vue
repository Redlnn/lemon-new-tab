<script setup lang="ts">
import { defineAsyncComponent } from 'vue'

import { useTranslation } from 'i18next-vue'
import CloudDoneRound from '~icons/ic/round-cloud-done'
import CloudOffRound from '~icons/ic/round-cloud-off'
import DevicesRound from '~icons/ic/round-devices'
import ErrorRound from '~icons/ic/round-error'
import HistoryRound from '~icons/ic/round-history'
import LockRound from '~icons/ic/round-lock'
import RefreshRound from '~icons/ic/round-refresh'
import SettingsBackupRestoreRound from '~icons/ic/round-settings-backup-restore'
import SyncRound from '~icons/ic/round-sync'
import WarningRound from '~icons/ic/round-warning'

import { getSyncState, syncNow, updateSyncPreferences } from '@/shared/webdavSync/bridge'
import type { LocalSyncStateV1, SyncScopePreferences } from '@/shared/webdavSync/types'

import RetiredCloudSyncPanel from '../components/RetiredCloudSyncPanel.vue'
import { useWebDavSyncState } from '../composables/useWebDavSyncState'

import SettingsSection from './SettingsSection.vue'

type DialogMode =
  | 'conflict'
  | 'devices'
  | 'disconnect'
  | 'encryption'
  | 'history'
  | 'remote-deleted'
  | 'repair'
  | null

const SetupDialog = defineAsyncComponent(() => import('../components/WebDavSetupDialog.vue'))
const ManagementDialogs = defineAsyncComponent(
  () => import('../components/WebDavSyncManagementDialogs.vue'),
)

const { t } = useTranslation('settings')
const sharedState = useWebDavSyncState()
const state = ref<LocalSyncStateV1>({ ...sharedState.value })
const loading = ref(true)
const syncing = ref(false)
const setupVisible = ref(false)
const dialogMode = ref<DialogMode>(null)
const updatingScope = ref<keyof SyncScopePreferences | null>(null)

const scopeKeys = [
  'settings',
  'quickLinks',
  'customSearchEngines',
  'uiPreferences',
  'blockedTopSites',
  'wallpapers',
  'onlineWallpaperUrl',
  'userIcons',
] as const satisfies readonly (keyof SyncScopePreferences)[]

watch(sharedState, (value) => {
  state.value = value
})

const pauseLabels: Record<NonNullable<LocalSyncStateV1['pauseReason']>, string> = {
  authentication: 'webdavSync.status.authentication',
  conflict: 'webdavSync.status.conflict',
  'corrupted-remote': 'webdavSync.status.corrupted',
  'encryption-password': 'webdavSync.status.encryptionPassword',
  'format-too-new': 'webdavSync.status.formatTooNew',
  'remote-deleted': 'webdavSync.status.remoteDeleted',
  'storage-full': 'webdavSync.status.storageFull',
}

const status = computed(() => {
  if (!state.value.configured)
    return { key: 'webdavSync.status.unconfigured', type: 'info' as const }
  if (state.value.paused) {
    return {
      key: state.value.pauseReason
        ? pauseLabels[state.value.pauseReason]
        : 'webdavSync.status.paused',
      type: 'danger' as const,
    }
  }
  if (state.value.pending) return { key: 'webdavSync.status.pending', type: 'warning' as const }
  if (state.value.resourceOmissions.length) {
    return { key: 'webdavSync.status.wallpaperSkipped', type: 'warning' as const }
  }
  return {
    key: state.value.lastSuccessAt ? 'webdavSync.status.synced' : 'webdavSync.status.ready',
    type: 'success' as const,
  }
})

const statusIcon = computed(() => {
  if (!state.value.configured) return CloudOffRound
  if (state.value.paused) return ErrorRound
  if (state.value.pending || state.value.resourceOmissions.length) return WarningRound
  return CloudDoneRound
})

const lastSuccess = computed(() =>
  state.value.lastSuccessAt
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(state.value.lastSuccessAt),
      )
    : t('webdavSync.never'),
)

const lastError = computed(() => {
  if (!state.value.lastError) return ''
  const statusCode = state.value.lastError.status ? ` · HTTP ${state.value.lastError.status}` : ''
  return `${t(`webdavSync.errors.${state.value.lastError.category}`, {
    defaultValue: t('webdavSync.errors.unknown'),
  })}${statusCode}`
})

async function refresh() {
  loading.value = true
  try {
    state.value =
      state.value.pauseReason === 'remote-deleted' ? await syncNow() : await getSyncState()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error))
  } finally {
    loading.value = false
  }
}

async function runSync() {
  syncing.value = true
  try {
    state.value = await syncNow()
    if (state.value.lastError) ElMessage.error(lastError.value)
    else if (!state.value.paused) ElMessage.success(t('webdavSync.messages.syncComplete'))
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t('webdavSync.errors.unknown'))
    await refresh()
  } finally {
    syncing.value = false
  }
}

async function changeScope(key: keyof SyncScopePreferences, value: boolean | string | number) {
  const enabled = Boolean(value)
  updatingScope.value = key
  try {
    state.value = await updateSyncPreferences({ scope: { [key]: enabled } })
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t('webdavSync.errors.unknown'))
  } finally {
    updatingScope.value = null
  }
}

function openPauseAction() {
  const reason = state.value.pauseReason
  if (reason === 'conflict') dialogMode.value = 'conflict'
  else if (reason === 'corrupted-remote') dialogMode.value = 'repair'
  else if (reason === 'encryption-password') dialogMode.value = 'encryption'
  else if (reason === 'remote-deleted') dialogMode.value = 'remote-deleted'
  else if (reason === 'storage-full') dialogMode.value = 'repair'
  else dialogMode.value = 'disconnect'
}

function closeDialogs() {
  setupVisible.value = false
  dialogMode.value = null
}

onDeactivated(closeDialogs)
onMounted(() => void refresh())
</script>

<template>
  <div v-loading="loading" class="settings__items-container settings-page-grid webdav-sync-page">
    <el-alert type="warning" :closable="false" show-icon class="settings-section--wide">
      <template #title>
        <span class="sync-experimental-title">
          {{ t('webdavSync.experimental.title') }}
        </span>
      </template>
      {{ t('webdavSync.experimental.description') }}
    </el-alert>

    <template v-if="!state.configured">
      <section class="sync-empty-state settings-section--wide">
        <cloud-off-round />
        <div>
          <h4>{{ t('webdavSync.empty.title') }}</h4>
        </div>
        <el-button type="primary" @click="setupVisible = true">
          {{ t('webdavSync.empty.action') }}
        </el-button>
      </section>
    </template>

    <template v-else>
      <section class="sync-status-card settings-section--wide">
        <component :is="statusIcon" class="sync-status-card__icon" />
        <div class="sync-status-card__body">
          <div class="sync-status-card__heading">
            <div>{{ t(status.key) }}</div>
          </div>
          <p>{{ t('webdavSync.lastSuccess', { time: lastSuccess }) }}</p>
          <p v-if="state.deviceName">
            {{ t('webdavSync.deviceName', { name: state.deviceName }) }}
          </p>
          <p>
            <el-tag :type="status.type" effect="light">
              {{ state.encrypted ? t('webdavSync.encrypted') : t('webdavSync.plaintext') }}
            </el-tag>
          </p>
          <p v-if="lastError" class="sync-last-error">{{ lastError }}</p>
        </div>
        <div class="sync-status-card__actions">
          <el-button
            :icon="RefreshRound"
            circle
            :aria-label="t('webdavSync.refresh')"
            @click="refresh"
          />
          <el-button
            type="primary"
            :icon="SyncRound"
            :loading="syncing"
            :disabled="state.paused"
            @click="runSync"
          >
            {{ t('webdavSync.syncNow') }}
          </el-button>
          <el-button v-if="state.paused" type="warning" @click="openPauseAction">
            {{ t('webdavSync.resolve') }}
          </el-button>
        </div>
      </section>

      <SettingsSection
        :title="t('webdavSync.scope.title')"
        :summary="t('webdavSync.scope.summary')"
        content-class="settings-control-grid"
        mobile-open
      >
        <div
          v-for="key in scopeKeys"
          :key="key"
          class="settings__item settings__item--horizontal settings__item--with-note"
        >
          <div class="settings__label">{{ t(`webdavSync.scope.${key}`) }}</div>
          <el-switch
            :model-value="state.scope[key]"
            :loading="updatingScope === key"
            @change="changeScope(key, $event)"
          />
          <p v-if="key === 'wallpapers'" class="settings__item-note">
            {{ t('webdavSync.scope.wallpapersNote') }}
          </p>
          <p v-if="key === 'onlineWallpaperUrl'" class="settings__item-note">
            {{ t('webdavSync.scope.onlineWallpaperUrlNote') }}
          </p>
          <p v-if="key === 'userIcons'" class="settings__item-note">
            {{ t('webdavSync.scope.userIconsNote') }}
          </p>
        </div>
      </SettingsSection>

      <SettingsSection
        :title="t('webdavSync.management.title')"
        :summary="t('webdavSync.management.summary')"
        content-class="settings-control-grid"
      >
        <div class="settings__item sync-button-grid settings-control-wide">
          <el-button :icon="HistoryRound" @click="dialogMode = 'history'">
            {{ t('webdavSync.management.history') }}
          </el-button>
          <el-button :icon="DevicesRound" @click="dialogMode = 'devices'">
            {{ t('webdavSync.management.devices') }}
          </el-button>
          <el-button :icon="LockRound" @click="dialogMode = 'encryption'">
            {{ t('webdavSync.management.encryption') }}
          </el-button>
          <el-button :icon="SettingsBackupRestoreRound" @click="dialogMode = 'repair'">
            {{ t('webdavSync.management.repair') }}
          </el-button>
        </div>
      </SettingsSection>

      <el-collapse class="sync-compact-collapse sync-danger-collapse">
        <el-collapse-item name="connection">
          <template #title>
            <strong>{{ t('webdavSync.connectionActions.title') }}</strong>
          </template>
          <p>{{ t('webdavSync.connectionActions.description') }}</p>
          <el-button type="danger" plain @click="dialogMode = 'disconnect'">
            {{ t('webdavSync.connectionActions.open') }}
          </el-button>
        </el-collapse-item>
      </el-collapse>
    </template>

    <RetiredCloudSyncPanel />

    <component :is="SetupDialog" v-if="setupVisible" v-model="setupVisible" @connected="refresh" />
    <component
      :is="ManagementDialogs"
      v-if="dialogMode"
      v-model="dialogMode"
      :state="state"
      @updated="refresh"
    />
  </div>
</template>

<style scoped lang="scss">
.webdav-sync-page {
  align-content: start;
}

.sync-experimental-title,
.sync-status-card__heading,
.sync-compact-title {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-weight: bold;
}

.sync-empty-state,
.sync-status-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  padding: 18px;
  background: var(--settings-option-background);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--le-radius-inner, 12px);

  > svg {
    width: 30px;
    height: 30px;
    color: var(--el-color-primary);
  }

  h4,
  p {
    margin: 0;
  }

  p {
    margin-top: 5px;
    color: var(--el-text-color-secondary);
  }
}

.sync-status-card__icon {
  width: 34px;
  height: 34px;
}

.sync-status-card__heading h3 {
  font-size: var(--el-font-size-medium);
}

.sync-status-card__actions,
.sync-button-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;

  :deep(.el-button + .el-button) {
    margin-inline-start: 0;
  }
}

.sync-last-error {
  color: var(--el-color-danger) !important;
  overflow-wrap: anywhere;
}

.sync-inclusion-list p {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 8px 0;
  color: var(--el-text-color-regular);
}

.sync-advanced-scope,
.sync-compact-collapse {
  --el-collapse-header-height: 42px;
  border: 0;
}

.sync-advanced-grid {
  display: grid;
  gap: 10px;
}

.sync-advanced-grid label {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;

  span {
    display: grid;
    gap: 3px;
  }

  small {
    color: var(--el-text-color-secondary);
  }
}

.sync-danger-collapse {
  padding: 0 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--le-radius-inner, 12px);

  p {
    margin-top: 0;
    color: var(--el-text-color-secondary);
  }
}

@media (width <= 599px) {
  .sync-empty-state,
  .sync-status-card {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .sync-empty-state > .el-button,
  .sync-status-card__actions {
    grid-column: 1 / -1;
  }
}
</style>
