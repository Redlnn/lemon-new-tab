<script setup lang="ts">
import { useSettingsStore } from '@/shared/settings'

import usePerfClasses from '@newtab/composables/usePerfClasses'
import { useYiYan } from '@newtab/composables/useYiYan'

const { yiyan, yiyanOrigin, load, isEnabled } = useYiYan()
const settings = useSettingsStore()

const perf = usePerfClasses(() => ({
  transparentOff: settings.perf.disableYiyanTransparent,
  blurOff: settings.perf.disableYiyanBlur
}))
const yiyanPerfClass = perf('yiyan', { withoutPrefix: true })

onMounted(async () => {
  await load()
})
</script>

<template>
  <Transition name="opacity-fade">
    <div v-if="isEnabled" class="yiyan">
      <div
        class="yiyan__main"
        :class="[
          {
            'yiyan--shadow': settings.yiyan.enableShadow,
            'yiyan--invert yiyan--light': settings.yiyan.invertColor.light,
            'yiyan--invert yiyan--night': settings.yiyan.invertColor.night
          },
          yiyanPerfClass
        ]"
      >
        <p class="yiyan__content">「 {{ yiyan }} 」</p>
        <p v-if="yiyanOrigin" class="yiyan__extra">—— {{ yiyanOrigin }}</p>
      </div>
    </div>
  </Transition>
</template>

<style lang="scss">
@use '@newtab/styles/mixins/acrylic.scss' as acrylic;

.yiyan {
  position: absolute;
  bottom: 100px;
  display: flex;
  justify-content: center;
  transition: bottom var(--el-transition-duration-fast) ease;

  &__main {
    width: 530px;
    padding: 6px 14px;
    color: var(--el-fill-color-darker);
    text-align: center;
    border-radius: 20px;
    transition:
      background-color var(--el-transition-duration-fast) ease,
      backdrop-filter var(--el-transition-duration-fast) ease,
      color var(--el-transition-duration-fast) ease;

    .yiyan__extra {
      margin-top: 8px;
      font-size: 0.95em;
      opacity: 0;
      transition: opacity var(--el-transition-duration-fast) ease;
    }

    &.yiyan--shadow {
      text-shadow: 1px 1px 3px rgb(0 0 0 / 40%);

      &:hover {
        text-shadow: 1px 1px 3px rgb(0 0 0 / 60%);
      }

      &:not(.yiyan--opacity):hover {
        text-shadow: initial;
      }
    }

    &:hover {
      color: var(--el-text-color-regular);
      background-color: var(--el-bg-color-overlay);

      html.colorful &:not(.yiyan--opacity) {
        background-color: var(--el-color-primary-light-9);
      }

      &.yiyan--opacity {
        color: var(--el-fill-color-blank);
        background-color: var(--le-bg-color-overlay-opacity-50);
      }

      &.yiyan--blur {
        @include acrylic.acrylic;
      }

      .yiyan__extra {
        opacity: 1;
      }
    }

    &.yiyan--invert.yiyan--light,
    /* stylelint-disable-next-line no-descending-specificity */
    html.dark & {
      color: var(--el-text-color-regular);

      /* stylelint-disable-next-line no-descending-specificity */
      &:hover {
        color: var(--el-text-color-primary);
      }
    }

    html.dark &.yiyan--invert.yiyan--night {
      color: var(--el-fill-color-extra-light);

      &:hover {
        color: var(--el-fill-color);
      }
    }
  }

  @media (width <= 600px) {
    width: 80%;
  }

  @media (height <= 800px) {
    bottom: 60px;
  }
}
</style>
