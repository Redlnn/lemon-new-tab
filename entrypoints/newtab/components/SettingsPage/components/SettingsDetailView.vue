<script setup lang="ts">
import type { ScrollbarInstance } from 'element-plus'

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
const scrollbarRef = useTemplateRef<ScrollbarInstance>('scrollbar')

defineExpose({
  getScrollTop: () => scrollbarRef.value?.wrapRef?.scrollTop ?? 0,
  setScrollTop: (top: number) => scrollbarRef.value?.setScrollTop(top),
})
</script>

<template>
  <el-main class="settings-main noselect" :aria-label="title">
    <el-scrollbar ref="scrollbar" class="settings-content">
      <Transition :name="disableTransition ? undefined : 'settings-fade'" mode="out-in">
        <KeepAlive>
          <component v-if="activeView" :is="activeView" :key="currentRoute" />
        </KeepAlive>
      </Transition>
    </el-scrollbar>
  </el-main>
</template>
