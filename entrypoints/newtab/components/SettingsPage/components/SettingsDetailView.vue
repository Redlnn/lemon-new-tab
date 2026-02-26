<script setup lang="ts">
import { useTimeoutFn } from '@vueuse/core'

import { getSettingsView } from '../composables/SettingsAsyncViews'
import { SettingsRoute } from '../composables/useSettingsRouter'

interface Props {
  currentRoute: SettingsRoute
  title: string
  isMobile?: boolean
  disableTransition?: boolean
  dialogOpened?: boolean
}

const props = defineProps<Props>()

const shouldRenderActiveView = ref(false)

const ensureActiveViewMounted = () => {
  // 用于确保需要开始挂载
  // 通过 shouldRenderActiveView 控制是否渲染
  if (!shouldRenderActiveView.value) {
    shouldRenderActiveView.value = true
  }
}

let rafId: number | null = null

const schedulePreRender = () => {
  // 如果已经渲染过，就不用重复安排
  if (shouldRenderActiveView.value) return
  // 此时 SettingsDialog 没有被打开
  // 使用 requestAnimationFrame 延迟渲染
  // 等页面加载得差不多了再触发预加载
  rafId = requestAnimationFrame(() => {
    useTimeoutFn(() => {
      ensureActiveViewMounted()
    }, 500)
    rafId = null
  })
}

onMounted(() => {
  if (props.dialogOpened) {
    ensureActiveViewMounted()
  } else {
    // 预加载逻辑
    // 由于 SettingsDialog 设置了 render=true
    // 因此这里在页面初次加载完后就会被执行
    schedulePreRender()
  }
})

onBeforeUnmount(() => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
})

watch(
  () => props.dialogOpened,
  (opened) => {
    if (opened) {
      ensureActiveViewMounted()
    }
  },
  { immediate: true }
)

const activeView = computed(() => {
  if (!shouldRenderActiveView.value) return null
  return getSettingsView(props.currentRoute)
})
</script>

<template>
  <el-main class="settings-main noselect">
    <el-scrollbar class="settings-content">
      <Transition :name="disableTransition ? undefined : 'settings-fade'" mode="out-in">
        <KeepAlive>
          <component v-if="activeView" :is="activeView" :key="currentRoute" />
        </KeepAlive>
      </Transition>
    </el-scrollbar>
  </el-main>
</template>
