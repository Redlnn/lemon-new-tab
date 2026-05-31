<script setup lang="ts">
import { useTranslation } from 'i18next-vue'

import { DEFAULT_SHORTCUT_GROUP_ID, useShortcutStore } from '@/shared/shortcut'

const { t } = useTranslation()
const shortcutStore = useShortcutStore()

const visible = ref(false)
const selectedGroupId = ref(DEFAULT_SHORTCUT_GROUP_ID)
const title = ref('')
let resolveSelection: ((groupId: string | null) => void) | null = null

function open(options?: { title?: string; currentGroupId?: string }): Promise<string | null> {
  shortcutStore.ensureDefaultGroup()
  title.value = options?.title || t('shortcut.groups.selectTitle')
  const currentGroupId = options?.currentGroupId
  selectedGroupId.value = shortcutStore.groups.some((group) => group.id === currentGroupId)
    ? currentGroupId!
    : (shortcutStore.groups[0]?.id ?? DEFAULT_SHORTCUT_GROUP_ID)
  visible.value = true
  return new Promise((resolve) => {
    resolveSelection = resolve
  })
}

function confirm() {
  visible.value = false
  resolveSelection?.(selectedGroupId.value)
  resolveSelection = null
}

function cancel() {
  visible.value = false
  resolveSelection?.(null)
  resolveSelection = null
}

defineExpose({ open })
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="360"
    append-to-body
    destroy-on-close
    @closed="cancel"
  >
    <el-select v-model="selectedGroupId" style="width: 100%">
      <el-option
        v-for="group in shortcutStore.groups"
        :key="group.id"
        :label="group.name"
        :value="group.id"
      />
    </el-select>
    <template #footer>
      <el-button round @click="cancel">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" round @click="confirm">{{ t('common.confirm') }}</el-button>
    </template>
  </el-dialog>
</template>
