<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import { builtInApps, builtInAppUrl } from '@/shared/builtinApps'
import { useQuickLinksStore } from '@/shared/quickLinks'
import { useSettingsStore } from '@/shared/settings'
import BaseDialog from './BaseDialog.vue'

const opened = defineModel<boolean>({ required: true })
const { t } = useTranslation('newtab')
const settings = useSettingsStore()
const store = useQuickLinksStore()
const hasMemo = computed(() => store.items.some((item) => item.appId === 'memo'))

async function toggleMemo() {
  await store.init()
  const item = { url: builtInAppUrl('memo'), title: t('builtinApps.memo'), favicon: builtInApps.memo.icon, appId: 'memo' as const }
  if (hasMemo.value) {
    const index = store.items.findIndex((link) => link.appId === 'memo')
    if (settings.quickLinks.grouping) {
      const group = store.groups.find((candidate) => candidate.items.some((link) => link.appId === 'memo'))
      if (group) await store.removeQuickLinkFromGroup(group.id, group.items.findIndex((link) => link.appId === 'memo'))
    } else if (index >= 0) await store.removeFlatQuickLink(index)
    return
  }
  if (settings.quickLinks.grouping) {
    const group = store.ensureDefaultGroup()
    group.items.unshift(item)
    await store.save()
  } else await store.insertFlatQuickLink({ quickLink: item, index: 0 })
}
</script>

<template>
  <base-dialog v-model="opened" :title="t('builtinApps.title')" width="420px" container-class="builtin-apps-dialog">
    <div class="builtin-apps-grid">
      <div class="builtin-app-card"><img :src="builtInApps.memo.icon" :alt="t('builtinApps.memo')" /><strong>{{ t('builtinApps.memo') }}</strong><el-button :type="hasMemo ? 'danger' : 'primary'" plain @click="toggleMemo">{{ t(hasMemo ? 'builtinApps.remove' : 'builtinApps.add') }}</el-button></div>
    </div>
  </base-dialog>
</template>

<style scoped>
/* stylelint-disable declaration-block-single-line-max-declarations */
.builtin-apps-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(130px,1fr)); gap: 12px; }.builtin-app-card { display: grid; gap: 10px; justify-items: center; padding: 18px; background: var(--el-fill-color-light); border-radius: 12px; }.builtin-app-card img { width: 54px; height: 54px; object-fit: contain; }
</style>
