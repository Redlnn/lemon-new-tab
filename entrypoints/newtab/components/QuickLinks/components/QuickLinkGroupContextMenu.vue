<script setup lang="ts">
import type { DropdownInstance } from 'element-plus'
import { useTranslation } from 'i18next-vue'
import ChevronDown20Filled from '~icons/fluent/chevron-down-20-filled'
import ChevronUp20Filled from '~icons/fluent/chevron-up-20-filled'
import Edit16Regular from '~icons/fluent/edit-16-regular'
import DeleteRound from '~icons/ic/round-delete'

import { DEFAULT_QUICK_LINK_GROUP_ID, type QuickLinkGroup } from '@/shared/quickLinks'

const props = defineProps<{
  groups: readonly QuickLinkGroup[]
  showSortActions: boolean
  popperClass?: string
}>()
const emit = defineEmits<{
  rename: [group: QuickLinkGroup]
  delete: [group: QuickLinkGroup]
  move: [group: QuickLinkGroup, direction: -1 | 1]
  'visible-change': [visible: boolean]
}>()
const { t } = useTranslation('newtab')
const dropdownRef = useTemplateRef<DropdownInstance>('dropdownRef')
const group = ref<QuickLinkGroup | null>(null)
const position = ref(DOMRect.fromRect())
const triggerRef = ref({ getBoundingClientRect: () => position.value })
const groupIndex = computed(() => props.groups.findIndex((item) => item.id === group.value?.id))

function open(event: MouseEvent | PointerEvent, target: QuickLinkGroup) {
  group.value = target
  position.value = DOMRect.fromRect({ x: event.clientX, y: event.clientY })
  dropdownRef.value?.handleOpen()
}

function close() {
  dropdownRef.value?.handleClose()
}

defineExpose({ open, close })
</script>

<template>
  <el-dropdown
    ref="dropdownRef"
    :virtual-ref="triggerRef"
    virtual-triggering
    trigger="contextmenu"
    :show-arrow="false"
    placement="bottom-start"
    :popper-class="popperClass"
    :popper-options="{ modifiers: [{ name: 'offset', options: { offset: [0, 0] } }] }"
    @visible-change="(visible: boolean) => emit('visible-change', visible)"
  >
    <template #dropdown>
      <el-dropdown-menu class="quick-links__group-menu noselect">
        <template v-if="group">
          <el-dropdown-item :icon="Edit16Regular" @click="emit('rename', group)">
            {{ t('quickLinks.groups.rename') }}
          </el-dropdown-item>
          <el-dropdown-item
            v-if="group.id !== DEFAULT_QUICK_LINK_GROUP_ID"
            :icon="DeleteRound"
            @click="emit('delete', group)"
          >
            {{ t('common.delete') }}
          </el-dropdown-item>
          <template v-if="showSortActions">
            <el-dropdown-item
              v-if="groupIndex > 0"
              :icon="ChevronUp20Filled"
              divided
              @click="emit('move', group, -1)"
            >
              {{ t('quickLinks.groups.moveUp') }}
            </el-dropdown-item>
            <el-dropdown-item
              v-if="groupIndex >= 0 && groupIndex < groups.length - 1"
              :icon="ChevronDown20Filled"
              :divided="groupIndex <= 0"
              @click="emit('move', group, 1)"
            >
              {{ t('quickLinks.groups.moveDown') }}
            </el-dropdown-item>
          </template>
        </template>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>
