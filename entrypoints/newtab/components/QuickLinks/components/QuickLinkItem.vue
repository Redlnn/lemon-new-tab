<script setup lang="ts">
import { OnLongPress } from '@vueuse/components'
import { toRef } from 'vue'

import Pin12Regular from '~icons/fluent/pin-12-regular'

import { getFaviconURL } from '@/shared/media'

import { isHasTouchDevice, isTouchEvent } from '@newtab/shared/touch'
import { isValidUrl } from '@newtab/shared/utils'

import type { QuickLinkItemPresentation } from './quickLinkItemPresentation'

const props = defineProps<{
  url: string
  title: string
  pined?: boolean
  favicon?: string
  presentation: QuickLinkItemPresentation
  onContextMenu?: (event: MouseEvent | PointerEvent) => void
}>()

// 使用 Ref 传递 url，让 getFaviconURL 内部监听变化
const faviconRef = getFaviconURL(toRef(props, 'url'))
const iconUrl = computed(() => props.favicon || faviconRef.value)
const safeUrl = computed(() => (isValidUrl(props.url) ? props.url : '#'))

function openFocusedLink(event: KeyboardEvent) {
  const link = (event.currentTarget as HTMLElement | null)?.querySelector('a')
  link?.click()
}
</script>

<template>
  <div
    role="link"
    class="quick-links__item noselect"
    :class="[{ pined: pined }]"
    :aria-label="title"
    @keydown.enter.prevent="openFocusedLink"
    @keydown.space.prevent="openFocusedLink"
  >
    <a
      v-if="pined"
      class="quick-links__item-link"
      tabindex="-1"
      :href="safeUrl"
      :target="presentation.linkTarget"
      :rel="presentation.linkRel"
      :aria-label="title"
      @contextmenu.stop.prevent="onContextMenu"
    >
      <div class="quick-links__icon-container" :style="{ marginBottom: presentation.iconTitleGap }">
        <div
          v-if="pined && presentation.showPinnedIcon"
          class="quick-links__pin-icon"
          :class="presentation.pinIconClass"
        >
          <el-icon size="11">
            <pin12-regular />
          </el-icon>
        </div>
        <div
          class="quick-links__icon"
          :class="[presentation.iconClass, { border: presentation.iconBorder }]"
        >
          <span
            class="span"
            :style="{
              backgroundImage: `url(${iconUrl})`,
            }"
          ></span>
        </div>
      </div>
      <el-text
        :data-content="title"
        v-if="presentation.showTitle"
        class="quick-links__title"
        :style="{ width: presentation.titleWidth }"
        truncated
      >
        {{ title }}
      </el-text>
    </a>
    <OnLongPress
      v-else
      as="a"
      class="quick-links__item-link"
      tabindex="-1"
      :href="safeUrl"
      :target="presentation.linkTarget"
      :rel="presentation.linkRel"
      :aria-label="title"
      @contextmenu.stop.prevent="onContextMenu"
      @trigger="
        (e: PointerEvent) => {
          if (isHasTouchDevice && isTouchEvent(e)) onContextMenu?.(e)
        }
      "
    >
      <div class="quick-links__icon-container" :style="{ marginBottom: presentation.iconTitleGap }">
        <div
          v-if="pined && presentation.showPinnedIcon"
          class="quick-links__pin-icon"
          :class="presentation.pinIconClass"
        >
          <el-icon size="11">
            <pin12-regular />
          </el-icon>
        </div>
        <div
          class="quick-links__icon"
          :class="[presentation.iconClass, { border: presentation.iconBorder }]"
        >
          <span
            class="span"
            :style="{
              backgroundImage: `url(${iconUrl})`,
            }"
          ></span>
        </div>
      </div>
      <el-text
        :data-content="title"
        v-if="presentation.showTitle"
        class="quick-links__title"
        :style="{ width: presentation.titleWidth }"
        truncated
      >
        {{ title }}
      </el-text>
    </OnLongPress>
  </div>
</template>
