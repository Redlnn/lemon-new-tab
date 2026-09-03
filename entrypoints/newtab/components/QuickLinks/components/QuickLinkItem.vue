<script setup lang="ts">
import { OnLongPress } from '@vueuse/components'

import Pin12Regular from '~icons/fluent/pin-12-regular'

import { getFaviconDisplay } from '@/shared/media'
import { useSettingsStore } from '@/shared/settings'

import { isTouchEvent } from '@newtab/shared/touch'
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

const settings = useSettingsStore()
// 用户保存的图标不参与解析，移除后才恢复对链接 favicon 的获取。
const faviconDisplay = getFaviconDisplay(computed(() => (props.favicon ? null : props.url)))
const iconUrl = computed(() => props.favicon || faviconDisplay.value.src)
const iconPending = computed(() => !props.favicon && faviconDisplay.value.state === 'pending')
const titleInitial = computed(() => {
  const title = props.title.trim()
  return title ? String.fromCodePoint(title.codePointAt(0)!) : ''
})
const showTitleInitialFallback = computed(
  () =>
    settings.quickLinks.fallbackToTitleInitial &&
    !props.favicon &&
    faviconDisplay.value.state === 'fallback' &&
    Boolean(titleInitial.value),
)
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
    :title="title"
    @keydown.enter.prevent="openFocusedLink"
    @keydown.space.prevent="openFocusedLink"
    @dragstart.prevent
  >
    <a
      v-if="pined"
      class="quick-links__item-link"
      draggable="false"
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
            :class="{
              'span--pending': iconPending,
              'span--title-initial': showTitleInitialFallback,
            }"
            :style="{
              backgroundImage: !showTitleInitialFallback && iconUrl ? `url(${iconUrl})` : undefined,
            }"
            >{{ showTitleInitialFallback ? titleInitial : '' }}</span
          >
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
      draggable="false"
      tabindex="-1"
      :href="safeUrl"
      :target="presentation.linkTarget"
      :rel="presentation.linkRel"
      :aria-label="title"
      @contextmenu.stop.prevent="onContextMenu"
      @trigger="
        (e: PointerEvent) => {
          if (isTouchEvent(e)) onContextMenu?.(e)
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
            :class="{
              'span--pending': iconPending,
              'span--title-initial': showTitleInitialFallback,
            }"
            :style="{
              backgroundImage: !showTitleInitialFallback && iconUrl ? `url(${iconUrl})` : undefined,
            }"
            >{{ showTitleInitialFallback ? titleInitial : '' }}</span
          >
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
