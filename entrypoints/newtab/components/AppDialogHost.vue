<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import {
  appDialogComponents,
  AddQuickLinkDialog,
  PermissionDialog,
  SyncRetirementDialog,
} from '../composables/appDialogRegistry'
import { useAppDialogs, type SimpleDialogName } from '../composables/appDialogs'
import { usePermission } from '../composables/usePermission'
import type { useRetiredCloudSync } from '../composables/useRetiredCloudSync'

defineProps<{ retirement: ReturnType<typeof useRetiredCloudSync> }>()
defineEmits<{ quickLinksSaved: [] }>()
const dialogs = useAppDialogs()
const names = Object.keys(appDialogComponents) as SimpleDialogName[]
const mountedDialogs = computed(() => names.filter((name) => dialogs.states[name]))
const quickLinkVisible = computed({
  get: () => dialogs.states.quickLink?.visible ?? false,
  set: (visible) => {
    if (!visible) dialogs.close('quickLink')
  },
})
const {
  permissionDialogVisible,
  currentHostname,
  currentOnlyAll,
  currentContext,
  onPermissionDialogResult,
} = usePermission()
const permissionLoaded = ref(false)
// 宿主首屏挂载；启动期间已有权限请求也不能丢失，界面资源按需加载。
watch(
  permissionDialogVisible,
  (visible) => {
    if (visible) permissionLoaded.value = true
  },
  { immediate: true, flush: 'sync' },
)
</script>

<template>
  <component
    :is="appDialogComponents[name]"
    v-for="name in mountedDialogs"
    :key="name"
    :model-value="dialogs.states[name]?.visible ?? false"
    @update:model-value="!$event && dialogs.close(name)"
  />
  <AddQuickLinkDialog
    v-if="dialogs.states.quickLink"
    v-model="quickLinkVisible"
    :request="dialogs.quickLink.request"
    @saved="$emit('quickLinksSaved')"
  />
  <PermissionDialog
    v-if="permissionLoaded"
    v-model="permissionDialogVisible"
    :hostname="currentHostname"
    :only-all="currentOnlyAll"
    :context="currentContext"
    @result="onPermissionDialogResult"
  />
  <SyncRetirementDialog
    v-if="retirement.dialogLoaded.value"
    :model-value="retirement.dialogVisible.value"
    @update:model-value="!$event && retirement.closeDialog()"
    :acknowledgement-only="retirement.dialogAcknowledgementOnly.value"
    @download="retirement.downloadCloudData"
    @delete="retirement.deleteCloudData"
  />
</template>
