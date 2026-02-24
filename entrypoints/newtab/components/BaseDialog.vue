<script setup lang="ts">
import { useElementVisibility, useWindowSize } from '@vueuse/core'

import { CloseRound } from '@vicons/material'
import type { DialogInstance, ScrollbarInstance } from 'element-plus'

import usePerfClasses from '@newtab/composables/usePerfClasses'

interface Props {
  title?: string
  modelValue: boolean
  containerClass?: string
  acrylic?: boolean
  opacity?: boolean
  appendToBody?: boolean
  destroyOnClose?: boolean
  style?: object | string
  width?: string | number
  headerClass?: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  open: []
  close: []
  closed: []
  scroll: [{ scrollLeft: number; scrollTop: number }]
}>()

const headerRef = useTemplateRef('headerRef')
const scrollbarRef = ref<ScrollbarInstance>()
const dialogRef = ref<DialogInstance>()

const headerIsVisible = useElementVisibility(headerRef)
const { width: windowWidth } = useWindowSize({ type: 'visual' })

function onClose() {
  emit('close')
  emit('update:modelValue', false)
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

const perf = usePerfClasses(() => ({
  transparentOff: !props.opacity,
  blurOff: !props.acrylic
}))

const dialogPerfClass = perf('base-dialog')

const dialogId = computed(() => {
  return (
    (dialogRef.value?.$el as HTMLElement)?.nextElementSibling?.firstElementChild?.getAttribute(
      'aria-describedby'
    ) ?? null
  )
})
</script>

<template>
  <el-dialog
    ref="dialogRef"
    :model-value="modelValue"
    :width="windowWidth < 650 ? '93%' : (props.width ?? 600)"
    :class="[containerClass, dialogPerfClass]"
    :style="style"
    :show-close="false"
    lock-scroll
    draggable
    :append-to-body="appendToBody"
    :destroy-on-close="destroyOnClose"
    :header-class="headerClass"
    @update:model-value="(val: boolean) => emit('update:modelValue', val)"
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

<style lang="scss">
.base-dialog {
  height: 500px;
  max-height: 80%;
  padding: 0;
  overflow: hidden;
  background-color: var(--el-bg-color-page);
  border-radius: 20px;
  box-shadow: 0 0 15px 0 var(--le-bg-color-page-opacity-60);
  transition:
    background-color var(--el-transition-duration-fast) ease,
    box-shadow var(--el-transition-duration-fast) ease;

  &-container {
    height: 100%;
    padding: 0 19px 0 35px;

    @media (width <= 650px) {
      padding: 0 10px 0 26px;
    }
  }

  &-scrollbar {
    padding-right: 15px;
  }

  &-divider {
    width: 100%;
    height: 1px;
    border-top: 1px color-mix(in oklch, var(--el-border-color), transparent 30%)
      var(--el-border-style);
    transition: opacity 0.1s ease;
  }

  &-bottom-spacing {
    height: 35px;
  }

  .el-dialog__header {
    position: relative;
    width: 100%;
    height: 50px;
    padding: 0;
    line-height: 50px;
    text-align: center;
  }

  .el-dialog__body {
    height: calc(100% - 51px);
    color: var(--el-text-color-primary);
    transition: color var(--el-transition-duration-fast) ease;
  }

  &-title {
    font-size: var(--el-font-size-large);
    transition: opacity 0.1s ease;
  }

  &-close-btn {
    position: absolute;
    top: 15px;
    right: 20px;
    width: 24px;
    height: 24px;
    padding: 2px;
    line-height: 1em;
    color: var(--el-text-color-regular);
    cursor: pointer;
    border-radius: 50%;
    transition: var(--el-transition-duration-fast) ease-in-out;

    &:hover,
    &:focus-visible {
      color: var(--el-text-color-primary);
      background-color: var(--el-fill-color-blank);
      transform: rotate(90deg);
    }

    &:focus-visible {
      outline: none;

      &::after {
        position: absolute;
        inset: -4px;
        pointer-events: none;
        content: '';
        border: 2px solid var(--el-color-primary);
        border-radius: 50%;
      }
    }

    svg {
      height: 100%;
    }
  }

  &-list-title {
    margin-top: 30px;
    font-size: 28px;
    font-weight: 600;
  }
}
</style>
