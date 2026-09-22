<script setup lang="ts">
import { useTranslation } from 'i18next-vue'

import { builtInApps, resolveBuiltInAppId } from '@/shared/builtinApps'
import { useQuickLinksStore } from '@/shared/quickLinks'

import BaseDialog from './BaseDialog.vue'

const opened = defineModel<boolean>({ required: true })
const { t } = useTranslation('newtab')
const store = useQuickLinksStore()
const hasNote = computed(() => store.items.some((item) => resolveBuiltInAppId(item) === 'note'))

async function toggleNote() {
  await store.setBuiltInAppEnabled('note', !hasNote.value)
}
</script>

<template>
  <base-dialog
    v-model="opened"
    :title="t('builtinApps.title')"
    width="420px"
    container-class="builtin-apps-dialog"
  >
    <div class="builtin-apps-grid">
      <div class="builtin-app-card">
        <el-icon :size="60" :alt="t('builtinApps.note')">
          <component :is="builtInApps.note.icon" />
        </el-icon>
        <strong>{{ t('builtinApps.note') }}</strong>
        <el-button :type="hasNote ? 'danger' : 'primary'" plain @click="toggleNote">
          {{ t(hasNote ? 'builtinApps.remove' : 'builtinApps.add') }}
        </el-button>
      </div>
    </div>
  </base-dialog>
</template>

<style>
.builtin-apps-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 12px;
}

.builtin-app-card {
  display: grid;
  gap: 10px;
  justify-items: center;
  padding: 18px;
  background: var(--el-fill-color-light);
  border-radius: 12px;

  .el-icon {
    padding: 15px;
    background-color: var(--el-color-primary-light-3);
    border-radius: 50%;
  }

  .el-button {
    font-size: 13px;
  }
}

.builtin-app-card img {
  width: 54px;
  height: 54px;
  object-fit: contain;
}
</style>
