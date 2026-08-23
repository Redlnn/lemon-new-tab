<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import DeleteRound from '~icons/ic/round-delete'
import DownloadRound from '~icons/ic/round-download'

import {
  clearRetiredCloudStorage,
  downloadRetiredCloudSnapshot,
  getRetiredCloudSnapshot,
  hasRetiredCloudData,
} from '@/shared/settings'

const { t } = useTranslation('settings')
const loading = ref(false)
const hasData = ref(false)

async function refresh() {
  hasData.value = hasRetiredCloudData(await getRetiredCloudSnapshot())
}

async function download() {
  loading.value = true
  try {
    if (await downloadRetiredCloudSnapshot())
      ElMessage.success(t('other.syncRetirement.downloadStarted'))
    else ElMessage.info(t('other.syncRetirement.noCloudData'))
  } catch {
    ElMessage.error(t('other.syncRetirement.downloadFailed'))
  } finally {
    loading.value = false
  }
}

async function clear() {
  try {
    await ElMessageBox.confirm(t('webdavSync.legacy.clearConfirm'), t('webdavSync.legacy.title'), {
      type: 'warning',
    })
  } catch {
    return
  }
  loading.value = true
  try {
    await clearRetiredCloudStorage()
    await refresh()
    ElMessage.success(t('other.syncRetirement.clearSuccess'))
  } catch {
    ElMessage.error(t('other.syncRetirement.clearFailedTitle'))
  } finally {
    loading.value = false
  }
}

onMounted(() => void refresh())
</script>

<template>
  <el-collapse class="sync-compact-collapse settings-section--wide">
    <el-collapse-item name="legacy">
      <template #title>
        <span class="sync-compact-title">
          <strong>{{ t('webdavSync.legacy.title') }}</strong>
          <el-tag v-if="hasData" size="small" type="warning">
            {{ t('webdavSync.legacy.found') }}
          </el-tag>
        </span>
      </template>
      <p>{{ t('webdavSync.legacy.description') }}</p>
      <div class="sync-compact-actions">
        <el-button :icon="DownloadRound" :loading="loading" :disabled="!hasData" @click="download">
          {{ t('other.syncRetirement.downloadCloudData') }}
        </el-button>
        <el-button :icon="DeleteRound" :loading="loading" :disabled="!hasData" @click="clear">
          {{ t('other.syncRetirement.clearCloudData') }}
        </el-button>
      </div>
    </el-collapse-item>
  </el-collapse>
</template>

<style scoped>
.sync-compact-collapse {
  --el-collapse-header-height: 42px;
  border: 0;
}

.sync-compact-title,
.sync-compact-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

p {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
}
</style>
