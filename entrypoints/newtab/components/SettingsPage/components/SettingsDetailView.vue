<script setup lang="ts">
import { getSettingsView } from '../composables/SettingsAsyncViews'
import { SettingsRoute } from '../composables/useSettingsRouter'

interface Props {
  currentRoute: SettingsRoute
  title: string
  isMobile?: boolean
  disableTransition?: boolean
}

const props = defineProps<Props>()

const activeView = computed(() => getSettingsView(props.currentRoute))
</script>

<template>
  <el-main class="settings-main noselect" :aria-label="title">
    <el-scrollbar class="settings-content">
      <Transition :name="disableTransition ? undefined : 'settings-fade'" mode="out-in">
        <KeepAlive>
          <component v-if="activeView" :is="activeView" :key="currentRoute" />
        </KeepAlive>
      </Transition>
    </el-scrollbar>
  </el-main>
</template>
