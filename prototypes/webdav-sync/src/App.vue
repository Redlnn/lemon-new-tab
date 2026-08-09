<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { computed, ref } from 'vue'

import { fakeSyncAdapter } from './fakeAdapter'
import SettingsShell from './components/SettingsShell.vue'
import SyncDialogs from './components/SyncDialogs.vue'
import type { DialogName, SyncScopeDraft } from './types'

const scenarios = fakeSyncAdapter.listScenarios()
const scenarioId = ref('unconfigured')
const compact = ref(false)
const dialog = ref<DialogName>(null)
const scope = ref<SyncScopeDraft>({
  searchHistory: false,
  blockedTopSites: false,
  wallpapers: false,
  onlineWallpaperUrl: true,
  quickLinkIcons: true,
})

const scenario = computed(() => fakeSyncAdapter.getScenario(scenarioId.value))

async function syncNow() {
  const result = await fakeSyncAdapter.syncNow(scenarioId.value)
  ElMessage.success(result.message)
}
</script>

<template>
  <main class="prototype-app" :class="{ 'prototype-app--compact': compact }">
    <header class="prototype-toolbar">
      <div>
        <strong>WebDAV 同步设置原型</strong>
        <span>场景和窗口尺寸仅用于评审，不会出现在扩展中</span>
      </div>
      <div class="prototype-toolbar__controls">
        <label>
          <span>场景</span>
          <el-select v-model="scenarioId" style="width: 180px" aria-label="选择原型场景">
            <el-option
              v-for="item in scenarios"
              :key="item.id"
              :label="item.label"
              :value="item.id"
            />
          </el-select>
        </label>
        <el-segmented
          v-model="compact"
          :options="[
            { label: '桌面', value: false },
            { label: '窄屏', value: true },
          ]"
          aria-label="切换原型窗口尺寸"
        />
      </div>
    </header>

    <section class="prototype-stage" aria-label="设置页原型画布">
      <SettingsShell
        :scenario="scenario"
        :scope="scope"
        @open="dialog = $event"
        @sync="syncNow"
        @update:scope="scope = $event"
      />
    </section>

    <SyncDialogs
      v-model="dialog"
      v-model:scope="scope"
      :scenario="scenario"
      :adapter="fakeSyncAdapter"
    />
  </main>
</template>
