<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import DownloadRound from '~icons/ic/round-download'

const model = defineModel<boolean>({ required: true })
defineProps<{
  acknowledgementOnly?: boolean
}>()
const emit = defineEmits<{
  download: []
  delete: []
}>()

const { t } = useTranslation('settings')
</script>

<template>
  <el-dialog
    v-model="model"
    :title="t('other.syncRetirement.title')"
    width="430px"
    class="sync-retirement-dialog noselect"
    :show-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <div class="sync-retirement-dialog__message">
      {{ t('other.syncRetirement.message') }}
    </div>
    <div v-if="!acknowledgementOnly" class="sync-retirement-dialog__backup-note">
      {{ t('other.syncRetirement.downloadNote') }}
    </div>
    <template #footer>
      <el-space v-if="acknowledgementOnly" wrap>
        <el-button @click="emit('delete')">
          {{ t('other.syncRetirement.clearCloudData') }}
        </el-button>
        <el-button type="primary" @click="model = false">
          {{ t('other.syncRetirement.acknowledge') }}
        </el-button>
      </el-space>
      <el-space v-else wrap>
        <el-button :icon="DownloadRound" @click="emit('download')">
          {{ t('other.syncRetirement.downloadCloudData') }}
        </el-button>
        <el-button type="danger" @click="emit('delete')">
          {{ t('other.syncRetirement.clearCloudData') }}
        </el-button>
      </el-space>
    </template>
  </el-dialog>
</template>

<style lang="scss">
.sync-retirement-dialog.el-dialog {
  padding: 25px;
}

.sync-retirement-dialog__message,
.sync-retirement-dialog__backup-note {
  line-height: 1.5;
}

.sync-retirement-dialog__backup-note {
  margin-top: 12px;
  font-size: var(--el-font-size-small);
  color: var(--el-text-color-secondary);
}
</style>
