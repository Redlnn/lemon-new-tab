<script setup lang="ts">
import { useWindowSize } from '@vueuse/core'

import { CloseRound, KeyboardArrowLeftRound } from '@vicons/material'
import { useTranslation } from 'i18next-vue'

import { useDialog } from '@newtab/composables/useDialog'

import SettingsDetailView from './components/SettingsDetailView.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import SettingsMenuView from './components/SettingsMenuView.vue'
import { MENU_ITEMS, SettingsRoute, useSettingsRouter } from './composables/useSettingsRouter'

const MOBILE_BREAKPOINT = 600
const COLLAPSE_BREAKPOINT = 900
const DESKTOP_DIALOG_WIDTH = 850

const { t } = useTranslation('settings')
const router = useSettingsRouter()
const { width: windowWidth } = useWindowSize({ type: 'visual' })
const { opened, show, hide, toggle } = useDialog()

const isMobile = computed(() => windowWidth.value < MOBILE_BREAKPOINT)
const isCollapse = computed(() => windowWidth.value < COLLAPSE_BREAKPOINT && !isMobile.value)

const currentPageTitle = computed(() => {
  if (router.isAtMenu.value) return t('title')
  const item = MENU_ITEMS.find((i) => i.key === router.currentRoute.value)
  return item?.titleKey ? t(item.titleKey) : t('title')
})

const slideTransitionName = computed(() =>
  isMobile.value ? (router.isForward.value ? 'settings-slide-left' : 'settings-slide-right') : ''
)

const resetRouter = () => router.reset(isMobile.value ? SettingsRoute.MENU : SettingsRoute.THEME)

function customShow() {
  resetRouter()
  show()
}

function customToggle() {
  if (!opened.value) {
    resetRouter()
  }
  toggle()
}

const handleMenuSelect = (key: string) => router.push(key as SettingsRoute)

const handleBack = () => {
  // 使用 back() 来触发正确的后退动画（isForward = false）
  if (router.canGoBack.value) {
    router.back()
  } else if (isMobile.value) {
    // 边缘情况：如果没有历史记录（如从桌面端切换到移动端），直接重置到 menu
    router.reset(SettingsRoute.MENU)
  }
}

watch(windowWidth, (newWidth, oldWidth) => {
  if (oldWidth) {
    const wasMobile = oldWidth < MOBILE_BREAKPOINT
    const isNowMobile = newWidth < MOBILE_BREAKPOINT
    if (wasMobile !== isNowMobile) resetRouter()
  }
})

defineExpose({ show: customShow, hide, toggle: customToggle })
</script>

<template>
  <SettingsDialog
    v-model="opened"
    :width="DESKTOP_DIALOG_WIDTH"
    class="settings__dialog settings-container--two-column"
    :class="[
      { 'is-mobile': isMobile },
      { 'is-mobile-main-menu': isMobile && router.isAtMenu.value }
    ]"
    lock-scroll
    draggable
    :show-close="false"
    header-class="settings-header noselect"
    @closed="resetRouter"
  >
    <template #header="{ close, titleId }">
      <button
        v-if="isMobile ? router.canGoBack.value : true"
        class="settings-back-btn"
        :disabled="!isMobile && !router.canGoBack.value"
        @click="handleBack"
        @keydown.enter="handleBack"
      >
        <el-icon color="currentColor" :size="20">
          <component :is="KeyboardArrowLeftRound" />
        </el-icon>
      </button>
      <div v-if="!(isMobile && router.isAtMenu.value)" :id="titleId" class="base-dialog-title">
        {{ currentPageTitle }}
      </div>
      <div v-else style="flex-grow: 1"></div>
      <div
        role="button"
        tabindex="0"
        class="base-dialog-close-btn"
        @click="close"
        @keydown.enter="close"
      >
        <component :is="CloseRound" />
      </div>
    </template>

    <template #aside>
      <settings-menu-view
        v-if="!isMobile"
        :is-collapse="isCollapse"
        :active-key="router.currentRoute.value"
        @select="handleMenuSelect"
      />
    </template>

    <Transition v-if="isMobile" :name="slideTransitionName">
      <settings-menu-view
        v-if="router.isAtMenu.value"
        key="menu"
        is-mobile
        :active-key="router.currentRoute.value"
        @select="handleMenuSelect"
      />
      <settings-detail-view
        v-else
        key="detail"
        ref="detailViewRef"
        is-mobile
        disable-transition
        :current-route="router.currentRoute.value"
        :title="currentPageTitle"
        :dialog-opened="opened"
      />
    </Transition>

    <settings-detail-view
      v-else
      ref="detailViewRef"
      :current-route="router.currentRoute.value"
      :title="currentPageTitle"
      :dialog-opened="opened"
    />
  </SettingsDialog>
</template>
