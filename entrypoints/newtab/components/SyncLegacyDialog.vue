<script setup lang="ts">
import { useTranslation } from 'i18next-vue'

import { useImeAwareDialog } from '@newtab/composables/useImeAwareDialog'

const model = defineModel<boolean>({ required: true })
const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const { t } = useTranslation('sync')
const { isComposing } = useImeAwareDialog()
</script>

<template>
  <el-dialog
    v-model="model"
    :title="t('legacyFormat.title')"
    width="400px"
    class="sync-legacy-dialog noselect"
    :close-on-click-modal="false"
    :close-on-press-escape="!isComposing"
  >
    <div class="sync-legacy-dialog__message">{{ t('legacyFormat.message') }}</div>
    <template #footer>
      <el-space>
        <el-button @click="emit('cancel')">{{ t('legacyFormat.cancel') }}</el-button>
        <el-button type="primary" @click="emit('confirm')">
          {{ t('legacyFormat.confirm') }}
        </el-button>
      </el-space>
    </template>
  </el-dialog>
</template>

<style lang="scss">
.sync-legacy-dialog.el-dialog {
  padding: 25px;
}

.sync-legacy-dialog__message {
  line-height: 1.5;
}
</style>
