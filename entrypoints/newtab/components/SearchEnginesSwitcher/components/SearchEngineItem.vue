<script setup lang="ts">
import { useSortable } from '@dnd-kit/vue/sortable'
import type { DropdownInstance } from 'element-plus'
import { useTranslation } from 'i18next-vue'
import type { Component } from 'vue'
import CheckmarkCircle12Filled from '~icons/fluent/checkmark-circle-12-filled'
import Delete16Regular from '~icons/fluent/delete-16-regular'
import Edit16Regular from '~icons/fluent/edit-16-regular'
import BlockRound from '~icons/ic/round-block'

import { SEARCH_ENGINE_OPENED_MENU_CLOSE_FN } from '@newtab/shared/keys'

import {
  QUICK_LINK_DND_CLICK_SUPPRESS_DURATION,
  QUICK_LINK_TOUCH_CONTEXT_MENU_EVENT,
} from '../../QuickLinks/composables/useQuickLinkDnd'

const props = defineProps<{
  id: string
  index: number
  group: 'built-in' | 'custom'
  name: string
  url: string
  icon?: Component
  iconUrl?: string
  isActive?: boolean
  canHide?: boolean
  popperClass: string
}>()

const emit = defineEmits<{
  select: [id: string]
  edit: []
  delete: []
  hide: [id: string]
}>()

const { t } = useTranslation()
const openedMenuCloseFn = inject(SEARCH_ENGINE_OPENED_MENU_CLOSE_FN)
const itemRef = ref<HTMLElement | null>(null)
const dropdownRef = ref<DropdownInstance | null>(null)
const position = ref<DOMRect | null>(null)
const triggerRef = { getBoundingClientRect: () => position.value ?? new DOMRect() }

const { isDragging, isDropTarget } = useSortable({
  id: computed(() => `search-engine:${props.group}:${props.id}`),
  index: computed(() => props.index),
  group: computed(() => props.group),
  element: itemRef,
  handle: itemRef,
  type: computed(() => `search-engine:${props.group}`),
  accept: computed(() => `search-engine:${props.group}`),
  data: computed(() => ({
    kind: 'search-engine',
    id: props.id,
    index: props.index,
    group: props.group,
  })),
  transition: { duration: 150, easing: 'ease' },
})

let suppressClickUntil = 0
watch(isDragging, (dragging, wasDragging) => {
  if (!dragging && wasDragging) {
    suppressClickUntil = Date.now() + QUICK_LINK_DND_CLICK_SUPPRESS_DURATION
  }
})

function suppressDragClick(event: MouseEvent) {
  if (isDragging.value || Date.now() < suppressClickUntil) {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
}

function openMenu(event: MouseEvent | TouchEvent | PointerEvent) {
  openedMenuCloseFn?.value?.()
  const point = 'clientX' in event ? event : event.touches[0]
  if (!point) return

  position.value = DOMRect.fromRect({ x: point.clientX, y: point.clientY })
  dropdownRef.value?.handleOpen()
  if (openedMenuCloseFn) openedMenuCloseFn.value = () => dropdownRef.value?.handleClose()
}

function openTouchMenu(event: Event) {
  const pointerEvent = (event as CustomEvent<{ event?: PointerEvent }>).detail?.event
  if (!pointerEvent) return
  suppressClickUntil = Date.now() + QUICK_LINK_DND_CLICK_SUPPRESS_DURATION
  openMenu(pointerEvent)
}
</script>

<template>
  <div
    ref="itemRef"
    role="button"
    tabindex="0"
    class="se-switcher-item"
    :aria-label="name"
    :aria-pressed="isActive"
    :class="{
      'is-active': isActive,
      'se-switcher-item--dragging': isDragging,
      'se-switcher-item--drop-target': isDropTarget,
    }"
    @click.capture="suppressDragClick"
    @click="emit('select', id)"
    @keydown.enter.prevent="emit('select', id)"
    @contextmenu.stop.prevent="openMenu"
    @[QUICK_LINK_TOUCH_CONTEXT_MENU_EVENT].stop="openTouchMenu"
  >
    <el-icon v-if="icon" size="16" class="se-switcher-item__icon">
      <component :is="icon" />
    </el-icon>
    <div v-else class="se-switcher-item__icon">
      <img :src="iconUrl" alt="" />
    </div>
    <div class="se-switcher-item__content">
      <div class="se-switcher-item__label">{{ name }}</div>
      <el-text truncated class="se-switcher-item__url">{{ url }}</el-text>
    </div>
    <el-icon size="16" class="se-switcher-item__checked">
      <CheckmarkCircle12Filled />
    </el-icon>

    <el-dropdown
      ref="dropdownRef"
      :virtual-ref="triggerRef"
      :show-arrow="false"
      virtual-triggering
      trigger="contextmenu"
      placement="bottom-start"
      :popper-options="{ modifiers: [{ name: 'offset', options: { offset: [0, 0] } }] }"
      :popper-class="popperClass"
    >
      <template #dropdown>
        <el-dropdown-menu class="noselect">
          <template v-if="group === 'custom'">
            <el-dropdown-item :icon="Edit16Regular" @click="$emit('edit')">
              <span>{{ t('common.edit') }}</span>
            </el-dropdown-item>
            <el-dropdown-item :icon="Delete16Regular" @click="$emit('delete')">
              <span>{{ t('common.delete') }}</span>
            </el-dropdown-item>
          </template>
          <el-dropdown-item
            v-else
            :icon="BlockRound"
            :disabled="!canHide"
            @click="canHide && emit('hide', id)"
          >
            <span>{{ t('search.enginePreference.hide') }}</span>
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>

<style scoped lang="scss">
.se-switcher-item {
  &--dragging {
    z-index: 1;
    opacity: 0.45;
  }

  &--drop-target {
    outline: 1px solid var(--el-color-primary-light-5);
  }
}
</style>
