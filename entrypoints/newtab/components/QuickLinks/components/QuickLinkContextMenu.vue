<script setup lang="ts">
import type { DropdownInstance } from 'element-plus'
import { useTranslation } from 'i18next-vue'
import Edit16Regular from '~icons/fluent/edit-16-regular'
import Pin12Regular from '~icons/fluent/pin-12-regular'
import PinOff16Regular from '~icons/fluent/pin-off-16-regular'
import Star12Regular from '~icons/fluent/star-12-regular'
import BlockRound from '~icons/ic/round-block'
import ContentCopyRound from '~icons/ic/round-content-copy'
import OpenInNewRound from '~icons/ic/round-open-in-new'

import type { QuickLinkTarget } from '@/shared/quickLinks'
import { useSettingsStore } from '@/shared/settings'

import { useQuickLinkContextMenu } from '../composables/useQuickLinkContextMenu'
import type { CtxQuickLinkItem } from '../composables/useQuickLinkContextMenu'

const props = withDefaults(
  defineProps<{
    refreshFn: () => Promise<void>
    onOpenEditDialog?: (target: QuickLinkTarget) => void
    onPin?: (item: CtxQuickLinkItem) => Promise<void> | void
    onMove?: (item: CtxQuickLinkItem) => Promise<void> | void
    placement?: 'bottom-start' | 'top-start'
    popperClass?: string
    showEdit?: boolean
    showMove?: boolean
  }>(),
  {
    placement: 'bottom-start',
    showEdit: false,
    showMove: false,
  },
)

const emit = defineEmits<{
  (e: 'visible-change', visible: boolean): void
}>()

const { t } = useTranslation()
const settings = useSettingsStore()

const dropdownRef = useTemplateRef<DropdownInstance>('dropdownRef')

const {
  ctxTriggerRef,
  ctxItem,
  setCtxContext,
  ctxOpenInNewTab,
  ctxOpenInNewWindow,
  ctxCopyLink,
  ctxCreateBookmark,
  ctxUnpin,
  ctxPin,
  ctxMove,
  ctxBlockSite,
  ctxEdit,
} = useQuickLinkContextMenu({
  refreshFn: props.refreshFn,
  onOpenEditDialog: (index) => props.onOpenEditDialog?.(index),
  onPin: (item) => props.onPin?.(item),
  onMove: (item) => props.onMove?.(item),
})

function open(
  event: MouseEvent | PointerEvent | TouchEvent,
  item: Parameters<typeof setCtxContext>[1],
): void {
  setCtxContext(event, item)
  dropdownRef.value?.handleOpen()
}

function close(): void {
  dropdownRef.value?.handleClose()
}

defineExpose({ open, close })
</script>

<template>
  <el-dropdown
    ref="dropdownRef"
    :virtual-ref="ctxTriggerRef"
    :show-arrow="false"
    virtual-triggering
    trigger="contextmenu"
    :placement="placement"
    :popper-options="{
      modifiers: [{ name: 'offset', options: { offset: [0, 0] } }],
    }"
    :popper-class="popperClass"
    @visible-change="(v: boolean) => emit('visible-change', v)"
  >
    <template #dropdown>
      <el-dropdown-menu class="noselect">
        <el-dropdown-item :icon="OpenInNewRound" @click="ctxOpenInNewTab">
          <span>{{ t('settings:common.openInNewTab') }}</span>
        </el-dropdown-item>
        <el-dropdown-item :icon="OpenInNewRound" @click="ctxOpenInNewWindow">
          <span>{{ t('settings:common.openInNewWindow') }}</span>
        </el-dropdown-item>
        <el-dropdown-item :icon="ContentCopyRound" @click="ctxCopyLink">
          <span>{{ t('settings:common.copyLink') }}</span>
        </el-dropdown-item>
        <el-dropdown-item :icon="Star12Regular" @click="ctxCreateBookmark">
          <span>{{ t('quickLinks.bookmark.add') }}</span>
        </el-dropdown-item>
        <template v-if="ctxItem?.isPinned">
          <el-dropdown-item v-if="showEdit" :icon="Edit16Regular" divided @click="ctxEdit">
            <span>{{ t('common.edit') }}</span>
          </el-dropdown-item>
          <el-dropdown-item
            v-if="showMove && settings.quickLinks.grouping && ctxItem?.groupId"
            :divided="!showEdit"
            @click="ctxMove"
          >
            <span>{{ t('quickLinks.groups.moveTo') }}</span>
          </el-dropdown-item>
          <el-dropdown-item :icon="PinOff16Regular" :divided="!showEdit" @click="ctxUnpin">
            <span>{{ t('quickLinks.unpin') }}</span>
          </el-dropdown-item>
        </template>
        <template v-else>
          <el-dropdown-item :icon="Pin12Regular" divided @click="ctxPin">
            <span>{{ t('quickLinks.pin') }}</span>
          </el-dropdown-item>
          <el-dropdown-item :icon="BlockRound" @click="ctxBlockSite">
            <span>{{ t('quickLinks.hide') }}</span>
          </el-dropdown-item>
        </template>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>
