<!-- https://github.com/element-plus/element-plus/blob/dev/packages/components/dialog/src/dialog-content.ts -->
<script lang="ts" setup>
import { dialogInjectionKey, useDraggable, useLocale } from 'element-plus'
import { type DialogContentProps } from 'element-plus/es/components/dialog/src/dialog-content'
import {
  dialogContentEmits,
  dialogContentPropsDefaults,
} from 'element-plus/es/components/dialog/src/dialog-content.mjs'
import { FOCUS_TRAP_INJECTION_KEY } from 'element-plus/es/components/focus-trap/src/tokens'
import { composeRefs } from 'element-plus/es/utils/vue/refs'

const { t: t_ } = useLocale()

const props = withDefaults(defineProps<DialogContentProps>(), dialogContentPropsDefaults)
defineEmits(dialogContentEmits)

const { dialogRef, headerRef, bodyId, ns, style } = inject(dialogInjectionKey)!
const { focusTrapRef } = inject(FOCUS_TRAP_INJECTION_KEY)!

const composedDialogRef = composeRefs(focusTrapRef, dialogRef)

const draggable = computed(() => !!props.draggable)
const overflow = computed(() => !!props.overflow)
const { resetPosition, updatePosition, isDragging } = useDraggable(
  dialogRef,
  headerRef,
  draggable,
  overflow,
)

const dialogKls = computed(() => [
  ns.b(),
  ns.is('fullscreen', props.fullscreen),
  ns.is('draggable', draggable.value),
  ns.is('dragging', isDragging.value),
  ns.is('align-center', !!props.alignCenter),
  { [ns.m('center')]: props.center },
])

defineExpose({
  resetPosition,
  updatePosition,
})
</script>

<template>
  <div :ref="composedDialogRef" :class="dialogKls" :style="style" tabindex="-1">
    <slot name="aside"></slot>
    <div :id="bodyId" :class="[ns.e('body'), bodyClass]">
      <header ref="headerRef" :class="[ns.e('header'), headerClass, { 'show-close': showClose }]">
        <slot name="header">
          <span role="heading" :aria-level="ariaLevel" :class="ns.e('title')">
            {{ title }}
          </span>
        </slot>
        <button
          v-if="showClose"
          :aria-label="t_('el.dialog.close')"
          :class="ns.e('headerbtn')"
          type="button"
          @click="$emit('close')"
        >
          <el-icon :class="ns.e('close')">
            <component :is="closeIcon" />
          </el-icon>
        </button>
      </header>
      <slot></slot>
      <footer v-if="$slots.footer" :class="[ns.e('footer'), footerClass]">
        <slot name="footer"></slot>
      </footer>
    </div>
  </div>
</template>
