<script setup lang="ts">
import { ChevronRightRound } from '@vicons/material'
import { useTranslation } from 'i18next-vue'

import Icon from '@/assets/icon.svg?component'

import { MENU_ITEMS } from '../composables/useSettingsRouter'

const { t } = useTranslation('settings')

interface Props {
  isMobile?: boolean
  isCollapse?: boolean
  activeKey?: string
}

defineProps<Props>()

const emit = defineEmits<{
  select: [key: string]
}>()

function handleMenuSelect(key: string) {
  emit('select', key)
}
</script>

<template>
  <aside class="settings-aside">
    <el-menu
      :default-active="activeKey"
      :collapse="isCollapse"
      :collapse-transition="!isMobile"
      class="settings-menu"
      @select="handleMenuSelect"
    >
      <div class="settings-menu__icon">
        <el-icon v-if="!isMobile">
          <Icon />
        </el-icon>
        <span v-else>{{ t('title') }}</span>
      </div>
      <el-menu-item
        v-for="item in MENU_ITEMS"
        :key="item.key"
        :index="item.key"
        class="settings-menu-item noselect"
        tabindex="0"
        @keydown.enter="$event.currentTarget.click()"
      >
        <el-icon>
          <component :is="item.icon" />
        </el-icon>
        <template #title>
          <span class="menu-title">{{ t(item.titleKey) }}</span>
        </template>
        <!-- 移动端右箭头 -->
        <el-icon v-if="isMobile" class="menu-chevron">
          <component :is="ChevronRightRound" />
        </el-icon>
      </el-menu-item>
    </el-menu>
  </aside>
</template>
