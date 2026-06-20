<script setup lang="ts">
import { useElementBounding, useElementHover, useEventListener } from '@vueuse/core'

import { ElMessage } from 'element-plus'
import i18next from 'i18next'
import ContentCopyTwotone from '~icons/ic/twotone-content-copy'

import { useSettingsStore } from '@/shared/settings'

import usePerfClasses from '@newtab/composables/usePerfClasses'
import { useYiYan } from '@newtab/composables/useYiYan'

const { yiyan, yiyanOrigin, load, isEnabled } = useYiYan()
const settings = useSettingsStore()

const perf = usePerfClasses(() => ({
  transparent: settings.perf.yiyan.transparent,
  blur: settings.perf.yiyan.blur,
}))
const yiyanPerfClass = perf('yiyan', { withoutPrefix: true })

onMounted(load)

interface Ripple {
  id: number
  x: number
  y: number
  size: number
  leaving: boolean
  entered: boolean
  wantLeave: boolean
}

const yiyanRef = useTemplateRef('yiyan')
const ripples = ref<Ripple[]>([])
const { left, top, width, height } = useElementBounding(yiyanRef)
const isHovered = useElementHover(yiyanRef)

/**
 * 动画结束判断（会多次触发）
 */
function onTransitionEnd(e: TransitionEvent, ripple: Ripple) {
  // 进场动画结束
  if (e.propertyName === 'transform') {
    ripple.entered = true

    if (ripple.wantLeave) {
      ripple.leaving = true
    }
  }

  // 只在离场动画（opacity）真正结束时才删除节点
  if (ripple.leaving && e.propertyName === 'opacity') {
    const index = ripples.value.findIndex((r) => r.id === ripple.id)
    if (index !== -1) {
      ripples.value.splice(index, 1)
    }
  }
}

function onPointerDown(e: PointerEvent) {
  if (!settings.perf.yiyan.ripple) return

  const x = e.clientX - left.value
  const y = e.clientY - top.value

  const dx = Math.max(x, width.value - x)
  const dy = Math.max(y, height.value - y)
  const size = Math.hypot(dx, dy) * 2

  const id = Date.now()

  const ripple = {
    id,
    x,
    y,
    size,
    leaving: false,
    entered: false,
    wantLeave: false,
  }

  ripples.value.push(ripple)

  const handleLeave = () => {
    const ripple = ripples.value.find((r) => r.id === id)
    if (!ripple) return

    ripple.wantLeave = true

    // 如果已经进入完成，直接 leave
    if (ripple.entered) {
      ripple.leaving = true
    }
  }

  // 监听 pointerup，触发 leave
  useEventListener(window, 'pointerup', handleLeave, { once: true })
  // 如果鼠标离开一言区域也触发消失
  watch(isHovered, handleLeave, { once: true })
}

async function copyToClipboard() {
  if (!yiyan.value) return
  try {
    await navigator.clipboard.writeText(yiyan.value || '')
    ElMessage.success(i18next.t('yiyan.copied'))
  } catch {}
}
</script>

<template>
  <Transition name="el-fade-in">
    <div
      v-if="isEnabled"
      class="yiyan noselect"
      :class="[
        {
          'yiyan--shadow': settings.yiyan.style.shadow,
          'yiyan--invert yiyan--light': settings.yiyan.style.invertColor.light,
          'yiyan--invert yiyan--night': settings.yiyan.style.invertColor.night,
        },
        yiyanPerfClass,
      ]"
      ref="yiyan"
      @pointerdown="onPointerDown"
    >
      <button class="yiyan__copy-btn" @click="copyToClipboard">
        <el-icon>
          <content-copy-twotone />
        </el-icon>
      </button>
      <div class="yiyan__content">「 {{ yiyan }} 」</div>
      <div v-if="yiyanOrigin" class="yiyan__extra">—— {{ yiyanOrigin }}</div>
      <TransitionGroup name="ripple">
        <span
          v-for="r in ripples"
          :key="r.id"
          class="ripple"
          :class="{ leaving: r.leaving }"
          :style="{
            width: r.size + 'px',
            height: r.size + 'px',
            left: r.x - r.size / 2 + 'px',
            top: r.y - r.size / 2 + 'px',
          }"
          @transitionend="(e) => onTransitionEnd(e, r)"
        ></span>
      </TransitionGroup>
    </div>
  </Transition>
</template>

<style lang="scss">
@use '@newtab/styles/mixins/acrylic.scss' as acrylic;

.yiyan {
  position: absolute;
  bottom: 100px;
  width: 500px;
  padding: 20px 26px;
  overflow: hidden;
  color: var(--el-fill-color-darker);
  text-align: center;
  border-radius: 20px;
  transition: bottom var(--el-transition-duration-fast) ease;
  transition:
    background-color var(--el-transition-duration-fast) ease,
    backdrop-filter var(--el-transition-duration-fast) ease,
    color var(--el-transition-duration-fast) ease,
    bottom var(--el-transition-duration-fast) ease;
  animation: delayedFadeIn 0.25s;

  .yiyan__copy-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 25px;
    height: 25px;
    padding: 0;
    color: var(--el-text-color-secondary);
    cursor: pointer;
    background: transparent;
    border: none;
    border-radius: 50%;
    opacity: 0;
    transition: all var(--el-transition-duration-fast) ease;

    &:hover,
    &:focus-visible {
      color: var(--el-text-color-primary);
      background-color: var(--el-fill-color-darker);
    }

    &:focus-visible {
      outline: 2px solid var(--el-color-primary);
      outline-offset: -2px;
    }
  }

  &.yiyan--opacity .yiyan__copy-btn {
    color: #eee;

    &:hover,
    &:focus-visible {
      color: #fff;
      background-color: var(--le-bg-color-overlay-opacity-60);
    }
  }

  .yiyan__extra {
    margin-top: 8px;
    font-size: 0.95em;
    opacity: 0;
    transition: opacity var(--el-transition-duration-fast) ease;
  }

  .yiyan__content {
    white-space: pre-wrap;
  }

  &.yiyan--shadow {
    text-shadow: 1px 1px 3px rgb(0 0 0 / 40%);

    &:hover,
    &:focus-within {
      text-shadow: 1px 1px 3px rgb(0 0 0 / 60%);
    }

    &:not(.yiyan--opacity):hover,
    &:not(.yiyan--opacity):focus-within {
      text-shadow: initial;
    }
  }

  &:hover,
  &:focus-within {
    color: var(--el-text-color-regular);
    background-color: var(--el-bg-color-overlay);

    html.colorful &:not(.yiyan--opacity) {
      background-color: var(--el-color-primary-light-9);
    }

    &.yiyan--opacity {
      color: var(--el-fill-color-blank);
      background-color: var(--le-bg-color-overlay-opacity-80);
    }

    &.yiyan--blur {
      @include acrylic.acrylic(10px, 1.2, 1.1);
    }

    .yiyan__extra {
      opacity: 1;
    }

    .yiyan__copy-btn {
      opacity: 1;
    }
  }

  &.yiyan--invert.yiyan--light,
    /* stylelint-disable-next-line no-descending-specificity */
    html.dark & {
    color: var(--el-text-color-regular);

    /* stylelint-disable-next-line no-descending-specificity */
    &:hover,
    &:focus-within {
      color: var(--el-text-color-primary);
    }
  }

  html.dark &.yiyan--invert.yiyan--night {
    color: var(--el-fill-color-extra-light);

    &:hover,
    &:focus-within {
      color: var(--el-fill-color);
    }
  }

  @media (width <= 600px) {
    width: 80%;
  }

  @media (height <= 800px) {
    bottom: 70px;
  }
}

.app--quick-links-scroll .yiyan {
  position: relative;
  bottom: auto;
  flex-shrink: 0;
  margin: 20px 0 0;
}

.ripple {
  position: absolute;
  pointer-events: none;
  background: rgb(white, 15%);
  border-radius: 50%;
  opacity: 1;
  filter: blur(5px);
  transform: scale(1);
  transform-origin: center;
  transition: 0.3s ease-out;
  will-change: transform, opacity;
}

.ripple-enter-from {
  opacity: 0;
  transform: scale(0);
}

.ripple-enter-to {
  transform: scale(1);
}

.ripple.leaving {
  opacity: 0;
}
</style>
