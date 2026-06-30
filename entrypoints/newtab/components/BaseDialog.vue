<script setup lang="ts">
import '@newtab/styles/dialog.scss'
import { useElementVisibility, useWindowSize } from '@vueuse/core'

import type { DialogInstance, ScrollbarInstance } from 'element-plus'
import CloseRound from '~icons/ic/round-close'

import { useImeAwareDialog } from '@newtab/composables/useImeAwareDialog'

interface Props {
  title?: string
  containerClass?: string
  appendToBody?: boolean
  destroyOnClose?: boolean
  style?: object | string
  width?: string | number
  headerClass?: string
}

const props = defineProps<Props>()
const model = defineModel<boolean>({ required: true })
const emit = defineEmits<{
  open: []
  close: []
  closed: []
  scroll: [{ scrollLeft: number; scrollTop: number }]
}>()

const headerRef = useTemplateRef('headerRef')
const scrollbarRef = ref<ScrollbarInstance>()
const dialogRef = ref<DialogInstance>()
const { isComposing } = useImeAwareDialog()

const headerIsVisible = useElementVisibility(headerRef)
const { width: windowWidth } = useWindowSize({ type: 'visual' })

function onClose() {
  emit('close')
  model.value = false
}

function onClosed() {
  emit('closed')
}

function onOpen() {
  emit('open')
  scrollbarRef.value?.setScrollTop(0)
  scrollbarRef.value?.update()
}

function onScroll(e: { scrollLeft: number; scrollTop: number }) {
  emit('scroll', e)
}

const dialogId = computed(() => {
  return (
    (dialogRef.value?.$el as HTMLElement)?.nextElementSibling?.firstElementChild?.getAttribute(
      'aria-describedby',
    ) ?? null
  )
})
</script>

<template>
  <el-dialog
    ref="dialogRef"
    v-model="model"
    :width="windowWidth < 650 ? '93%' : (props.width ?? 600)"
    :class="[containerClass, 'base-dialog']"
    :style="style"
    :show-close="false"
    draggable
    :append-to-body="appendToBody"
    :destroy-on-close="destroyOnClose"
    :header-class="headerClass"
    :close-on-press-escape="!isComposing"
    @open="onOpen"
    @close="onClose"
    @closed="onClosed"
  >
    <template #header="{ titleId }">
      <div
        :id="titleId"
        class="base-dialog-title noselect"
        :style="{ opacity: !headerIsVisible ? 1 : 0 }"
      >
        {{ title }}
      </div>
      <div
        role="button"
        tabindex="0"
        class="base-dialog-close-btn"
        @click="onClose"
        @keydown.enter="onClose"
      >
        <component :is="CloseRound" />
      </div>
    </template>
    <div
      v-if="title"
      class="base-dialog-divider"
      :style="{ opacity: !headerIsVisible ? 1 : 0 }"
    ></div>
    <div class="base-dialog-container">
      <el-scrollbar ref="scrollbarRef" class="base-dialog-scrollbar" @scroll="onScroll">
        <div ref="headerRef" class="base-dialog-list-title noselect">
          {{ title }}
        </div>
        <slot></slot>
        <div class="base-dialog-bottom-spacing"></div>
        <el-backtop
          v-if="dialogId"
          :target="`#${dialogId} .el-scrollbar__wrap`"
          style="position: absolute"
          :right="15"
          :bottom="20"
        />
      </el-scrollbar>
    </div>
  </el-dialog>
</template>
