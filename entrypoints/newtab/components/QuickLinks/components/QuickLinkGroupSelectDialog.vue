<script setup lang="ts">
import { useTranslation } from 'i18next-vue'

import { DEFAULT_QUICK_LINK_GROUP_ID, useQuickLinksStore } from '@/shared/quickLinks'
import { useSettingsStore } from '@/shared/settings'

import usePerfClasses from '@newtab/composables/usePerfClasses'

const { t } = useTranslation()
const quickLinksStore = useQuickLinksStore()
const settings = useSettingsStore()
const perf = usePerfClasses(() => ({
  transparent: settings.perf.quickLinks.transparent,
  blur: settings.perf.quickLinks.blur,
}))
const dialogPerfClass = perf('quick-link-group-select-dialog')

const visible = ref(false)
const selectedGroupId = ref(DEFAULT_QUICK_LINK_GROUP_ID)
const title = ref('')
let resolveSelection: ((groupId: string | null) => void) | null = null

function open(options?: { title?: string; currentGroupId?: string }): Promise<string | null> {
  quickLinksStore.ensureDefaultGroup()
  title.value = options?.title || t('quickLinks.groups.selectTitle')
  const currentGroupId = options?.currentGroupId
  selectedGroupId.value = quickLinksStore.groups.some((group) => group.id === currentGroupId)
    ? currentGroupId!
    : (quickLinksStore.groups[0]?.id ?? DEFAULT_QUICK_LINK_GROUP_ID)
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
    :class="[dialogPerfClass, 'noselect']"
    append-to-body
    destroy-on-close
    @closed="cancel"
  >
    <el-select v-model="selectedGroupId" style="width: 100%">
      <el-option
        v-for="group in quickLinksStore.groups"
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

<style lang="scss">
@use '@newtab/styles/mixins/acrylic.scss' as acrylic;

html.colorful {
  .quick-link-group-select-dialog {
    background-color: var(--el-color-primary-light-9);
  }
}

html.dialog-transparent {
  .quick-link-group-select-dialog--opacity {
    background-color: var(--le-bg-color-overlay-opacity-15);
  }
}

html.dialog-acrylic {
  .quick-link-group-select-dialog--blur {
    @include acrylic.acrylic;
  }
}
</style>
