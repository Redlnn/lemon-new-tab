<script setup lang="ts">
import { useTranslation } from 'i18next-vue'

import type { SyncEventPayloadMap } from '@/shared/sync'

import { useImeAwareDialog } from '@newtab/composables/useImeAwareDialog'

const model = defineModel<boolean>({ required: true })
const props = defineProps<{
  conflict: SyncEventPayloadMap['conflict'] | null
}>()
const emit = defineEmits<{
  useCloud: []
  useLocal: []
  disableSync: []
}>()

const { t } = useTranslation('sync')
const { isComposing } = useImeAwareDialog()

const formatTime = (time: number) => {
  if (!time) return '-'
  return new Date(time).toLocaleString()
}
</script>

<template>
  <el-dialog
    v-model="model"
    :title="t('conflict.title')"
    width="400px"
    class="sync-conflict-dialog noselect"
    :close-on-click-modal="false"
    :close-on-press-escape="!isComposing"
    :show-close="false"
  >
    <div class="sync-conflict-dialog__message">{{ t('conflict.message') }}</div>
    <table class="sync-conflict-dialog__table">
      <thead>
        <tr>
          <th></th>
          <th>{{ t('conflict.cloudLabel') }}</th>
          <th>{{ t('conflict.localLabel') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>{{ t('conflict.fromDevice') }}</td>
          <td>{{ props.conflict?.cloud.fromDeviceName || '-' }}</td>
          <td></td>
        </tr>
        <!-- <tr>
          <td>{{ t('conflict.deviceId') }}</td>
          <td>{{ props.conflict?.cloud.fromDeviceId || '-' }}</td>
          <td>-</td>
        </tr> -->
        <tr>
          <td>{{ t('conflict.modifiedAt') }}</td>
          <td>{{ formatTime(props.conflict?.cloud.lastUpdate || 0) }}</td>
          <td>{{ formatTime(props.conflict?.local.localModifiedAt || 0) }}</td>
        </tr>
      </tbody>
    </table>
    <template #footer>
      <el-space fill>
        <el-button type="primary" plain @click="emit('useCloud')">
          {{ t('conflict.useCloud') }}
        </el-button>
        <el-button type="warning" @click="emit('useLocal')">
          {{ t('conflict.useLocal') }}
        </el-button>
        <el-button type="danger" @click="emit('disableSync')">
          {{ t('conflict.disableSync') }}
        </el-button>
      </el-space>
    </template>
  </el-dialog>
</template>

<style lang="scss">
.sync-conflict-dialog.el-dialog {
  padding: 25px;
}

.sync-conflict-dialog__message {
  margin-bottom: 12px;
  line-height: 1.5;
}

.sync-conflict-dialog__table {
  width: 100%;
  overflow: hidden;
  border-collapse: collapse;
  background-color: rgb(from var(--el-bg-color) r g b / 50%);
  border-radius: 10px;

  tr:first-child,
  tr:not(:last-child) {
    border-bottom: 1px solid var(--el-border-color);
  }

  tbody tr:nth-child(odd) {
    background-color: rgb(from var(--el-bg-color) r g b / 50%);
  }

  th,
  td {
    padding: 8px 10px;
    font-size: 13px;
    vertical-align: top;
    text-align: left;
    border: none;
  }

  th {
    font-weight: 600;
  }
}
</style>
