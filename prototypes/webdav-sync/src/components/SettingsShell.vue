<script setup lang="ts">
import BrushRound from '~icons/ic/round-brush'
import CloudSyncRound from '~icons/ic/round-cloud-sync'
import DashboardRound from '~icons/ic/round-dashboard'
import DevicesRound from '~icons/ic/round-devices'
import MoreHorizRound from '~icons/ic/round-more-horiz'
import PictureRound from '~icons/ic/round-image'
import SearchRound from '~icons/ic/round-search'
import SettingsRound from '~icons/ic/round-settings'

import type { DialogName, PrototypeScenario, SyncScopeDraft } from '../types'
import SyncSettingsPage from './SyncSettingsPage.vue'

defineProps<{
  scenario: PrototypeScenario
  scope: SyncScopeDraft
}>()

const emit = defineEmits<{
  open: [dialog: DialogName]
  sync: []
  'update:scope': [scope: SyncScopeDraft]
}>()

const menu = [
  { label: '主题', icon: BrushRound },
  { label: '布局', icon: DashboardRound },
  { label: '搜索', icon: SearchRound },
  { label: '壁纸', icon: PictureRound },
  { label: '快速导航', icon: DevicesRound },
  { label: 'WebDAV 同步', icon: CloudSyncRound, active: true },
  { label: '其他设置', icon: MoreHorizRound },
]
</script>

<template>
  <div class="settings-window">
    <aside class="settings-window__aside" aria-label="设置分类">
      <div class="settings-window__brand" aria-label="柠檬起始页">
        <span class="lemon-mark">L</span>
        <span>设置</span>
      </div>
      <nav>
        <button
          v-for="item in menu"
          :key="item.label"
          type="button"
          :class="{ active: item.active }"
          :aria-current="item.active ? 'page' : undefined"
        >
          <component :is="item.icon" />
          <span>{{ item.label }}</span>
        </button>
      </nav>
    </aside>

    <section class="settings-window__main">
      <header class="settings-window__header">
        <settings-round aria-hidden="true" />
        <h1>WebDAV 同步</h1>
        <span class="experimental-label">实验性</span>
      </header>
      <div class="settings-window__scroll">
        <SyncSettingsPage
          :scenario="scenario"
          :scope="scope"
          @open="emit('open', $event)"
          @sync="emit('sync')"
          @update:scope="emit('update:scope', $event)"
        />
      </div>
    </section>
  </div>
</template>
