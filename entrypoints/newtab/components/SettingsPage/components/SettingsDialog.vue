<!-- https://github.com/element-plus/element-plus/blob/dev/packages/components/dialog/src/dialog.vue -->
<script lang="ts" setup>
import type { TransitionProps } from 'vue'

import {
  dialogEmits,
  dialogInjectionKey,
  type DialogProps,
  useDialog,
  useNamespace,
  useSameTarget,
} from 'element-plus'
import { dialogPropsDefaults } from 'element-plus/es/components/dialog/src/dialog'
import ElFocusTrap from 'element-plus/es/components/focus-trap/src/focus-trap.mjs'

import SettingsDialogContent from './SettingsDialogContent.vue'

type DialogProps_ = DialogProps & {
  class?: ClassValue
}

const props = withDefaults(defineProps<DialogProps_>(), {
  ...dialogPropsDefaults,
  class: '',
})
defineEmits(dialogEmits)

const ns = useNamespace('dialog')
const dialogRef = ref<HTMLElement>()
const headerRef = ref<HTMLElement>()
const dialogContentRef = ref<InstanceType<typeof SettingsDialogContent>>()

const {
  visible,
  titleId,
  bodyId,
  style,
  overlayDialogStyle,
  rendered,
  transitionConfig,
  zIndex,
  _draggable,
  _alignCenter,
  _overflow,
  penetrable,
  handleClose,
  onModalClick,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onCloseRequested,
  onFocusoutPrevented,
  bringToFront,
  closing,
} = useDialog(props, dialogRef)

provide(dialogInjectionKey, {
  dialogRef,
  headerRef,
  bodyId,
  ns,
  rendered,
  style,
})

const overlayEvent = useSameTarget(onModalClick)

const resetPosition = () => {
  dialogContentRef.value?.resetPosition()
}

defineExpose({
  /** @description 对话框是否可见 */
  visible,
  dialogContentRef,
  resetPosition,
  handleClose,
})
</script>

<template>
  <Teleport :to="appendTo" :disabled="appendTo !== 'body' ? false : !appendToBody">
    <transition v-bind="transitionConfig as TransitionProps">
      <el-overlay
        v-show="visible"
        custom-mask-event
        :mask="modal"
        :overlay-class="[
          modalClass ?? '',
          `${ns.namespace.value}-modal-dialog`,
          ns.is('penetrable', penetrable),
        ]"
        :z-index="zIndex"
      >
        <div
          role="dialog"
          aria-modal="true"
          :aria-label="title || undefined"
          :aria-labelledby="!title ? titleId : undefined"
          :aria-describedby="bodyId"
          :class="[`${ns.namespace.value}-overlay-dialog`, ns.is('closing', closing)]"
          :style="overlayDialogStyle"
          @click="overlayEvent.onClick"
          @mousedown="overlayEvent.onMousedown"
          @mouseup="overlayEvent.onMouseup"
        >
          <el-focus-trap
            loop
            :trapped="visible"
            focus-start-el="container"
            @focus-after-trapped="onOpenAutoFocus"
            @focus-after-released="onCloseAutoFocus"
            @focusout-prevented="onFocusoutPrevented"
            @release-requested="onCloseRequested"
          >
            <settings-dialog-content
              v-if="rendered"
              ref="dialogContentRef"
              v-bind="$attrs"
              :class="props.class"
              :center="center"
              :align-center="_alignCenter"
              :close-icon="closeIcon"
              :draggable="_draggable"
              :overflow="_overflow"
              :fullscreen="fullscreen"
              :header-class="headerClass"
              :body-class="bodyClass"
              :footer-class="footerClass"
              :show-close="showClose"
              :title="title"
              :aria-level="headerAriaLevel"
              @close="handleClose"
              @mousedown="bringToFront"
            >
              <template #aside>
                <slot name="aside" />
              </template>
              <template #header>
                <slot
                  name="header"
                  :close="handleClose"
                  :title-id="titleId"
                  :title-class="ns.e('title')"
                />
              </template>
              <slot />
              <template v-if="$slots.footer" #footer>
                <slot name="footer" />
              </template>
            </settings-dialog-content>
          </el-focus-trap>
        </div>
      </el-overlay>
    </transition>
  </Teleport>
</template>
