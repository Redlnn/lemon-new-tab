<script setup lang="ts">
import { OnLongPress } from '@vueuse/components'
import { toRef } from 'vue'

import Pin12Regular from '~icons/fluent/pin-12-regular'

import { getFaviconURL } from '@/shared/media'
import { useSettingsStore } from '@/shared/settings'

import usePerfClasses from '@newtab/composables/usePerfClasses'
import { isHasTouchDevice, isTouchEvent } from '@newtab/shared/touch'
import { isValidUrl } from '@newtab/shared/utils'

const settings = useSettingsStore()

const props = defineProps<{
  url: string
  title: string
  pined?: boolean
  favicon?: string
  onContextMenu?: (event: MouseEvent | PointerEvent) => void
}>()

// 使用 Ref 传递 url，让 getFaviconURL 内部监听变化
const faviconRef = getFaviconURL(toRef(props, 'url'))
const iconUrl = computed(() => props.favicon || faviconRef.value)
const safeUrl = computed(() => (isValidUrl(props.url) ? props.url : '#'))

const perf = usePerfClasses(() => ({
  transparent: settings.perf.quickLinks.transparent,
  blur: settings.perf.quickLinks.blur,
}))

const iconClass = perf('quick-links__icon')
const pinIconClass = perf('quick-links__pin-icon')
</script>

<template>
  <div role="button" class="quick-links__item noselect" :class="[{ pined: pined }]">
    <a
      v-if="pined"
      class="quick-links__item-link"
      tabindex="-1"
      :href="safeUrl"
      :target="settings.quickLinks.openInNewTab ? '_blank' : '_self'"
      :rel="settings.quickLinks.openInNewTab ? 'noopener noreferrer' : undefined"
      @contextmenu.stop.prevent="onContextMenu"
    >
      <div
        class="quick-links__icon-container"
        :style="{ marginBottom: `${settings.quickLinks.spacing.iconTitleGap}px` }"
      >
        <div
          v-if="pined && settings.quickLinks.pinnedIcon && settings.quickLinks.topSites"
          class="quick-links__pin-icon"
          :class="pinIconClass"
        >
          <el-icon size="11">
            <pin12-regular />
          </el-icon>
        </div>
        <div
          class="quick-links__icon"
          :class="[iconClass, { border: settings.quickLinks.style.border }]"
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
        v-if="settings.quickLinks.title.show"
        class="quick-links__title"
        :style="{ width: `calc(var(--icon_size) + ${settings.quickLinks.title.extraWidth}px)` }"
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
      :target="settings.quickLinks.openInNewTab ? '_blank' : '_self'"
      :rel="settings.quickLinks.openInNewTab ? 'noopener noreferrer' : undefined"
      @contextmenu.stop.prevent="onContextMenu"
      @trigger="
        (e: PointerEvent) => {
          if (isHasTouchDevice && isTouchEvent(e)) onContextMenu?.(e)
        }
      "
    >
      <div
        class="quick-links__icon-container"
        :style="{ marginBottom: `${settings.quickLinks.spacing.iconTitleGap}px` }"
      >
        <div
          v-if="pined && settings.quickLinks.pinnedIcon && settings.quickLinks.topSites"
          class="quick-links__pin-icon"
          :class="pinIconClass"
        >
          <el-icon size="11">
            <pin12-regular />
          </el-icon>
        </div>
        <div
          class="quick-links__icon"
          :class="[iconClass, { border: settings.quickLinks.style.border }]"
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
        v-if="settings.quickLinks.title.show"
        class="quick-links__title"
        :style="{ width: `calc(var(--icon_size) + ${settings.quickLinks.title.extraWidth}px)` }"
        truncated
      >
        {{ title }}
      </el-text>
    </OnLongPress>
  </div>
</template>
