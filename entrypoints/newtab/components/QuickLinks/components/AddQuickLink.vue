<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import AddRound from '~icons/ic/round-add'

import type { QuickLinkItemPresentation } from './quickLinkItemPresentation'

const { t } = useTranslation()

withDefaults(
  defineProps<{
    showButton?: boolean
    tabindex?: boolean
    presentation: QuickLinkItemPresentation
    onOpen?: () => void
  }>(),
  {
    showButton: true,
    tabindex: true,
  },
)
</script>

<template>
  <div
    v-if="showButton"
    role="button"
    :tabindex="tabindex ? '0' : '-1'"
    class="quick-links__item quick-links__item--add-quick-link noselect"
  >
    <div
      class="quick-links__item-link"
      style="cursor: pointer"
      @click="onOpen?.()"
      @keydown.enter="onOpen?.()"
    >
      <div class="quick-links__icon-container" :style="{ marginBottom: presentation.iconTitleGap }">
        <div
          class="quick-links__icon"
          :class="[presentation.iconClass, { border: presentation.iconBorder }]"
        >
          <add-round />
        </div>
      </div>
      <el-text
        v-if="presentation.showTitle"
        class="quick-links__title"
        :style="{ width: presentation.titleWidth }"
        truncated
      >
        {{ t('quickLinks.addLink') }}
      </el-text>
    </div>
  </div>
</template>

<style lang="scss">
.quick-links__item--add-quick-link .quick-links__item-link {
  .quick-links__title,
  .quick-links__icon {
    color: var(--le-text-color-primary-opacity-65);
  }

  .quick-links__icon {
    svg {
      min-width: 70%;
      min-height: 70%;
    }
  }

  &:hover {
    .quick-links__title,
    .quick-links__icon {
      color: var(--el-text-color-primary);
    }
  }

  .quick-links__container--item-shadow &:not(:hover) .quick-links__title {
    text-shadow: 1px 1px 4px rgb(0 0 0 / 50%);
  }

  // 白色文本容器特化
  html.light .quick-links__container--white-in-light & {
    .quick-links__title,
    .quick-links__icon {
      color: rgb(255 255 255 / 70%);

      &:not(.quick-links__icon--opacity) {
        svg {
          color: var(--le-text-color-primary-opacity-65);
        }
      }
    }

    &:hover {
      .quick-links__title,
      .quick-links__icon {
        color: var(--el-color-white);

        &:not(.quick-links__icon--opacity) {
          svg {
            color: var(--el-text-color-regular);
          }
        }
      }
    }
  }
}
</style>
