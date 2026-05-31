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
  transparent: settings.perf.shortcut.transparent,
  blur: settings.perf.shortcut.blur,
}))

const iconClass = perf('shortcut__icon')
const pinIconClass = perf('shortcut__pin-icon')
</script>

<template>
  <div role="button" class="shortcut__item noselect" :class="[{ pined: pined }]">
    <OnLongPress
      as="a"
      ref="itemRef"
      class="shortcut__item-link"
      tabindex="-1"
      :href="safeUrl"
      :target="settings.shortcut.openInNewTab ? '_blank' : '_self'"
      :rel="settings.shortcut.openInNewTab ? 'noopener noreferrer' : undefined"
      @contextmenu.stop.prevent="onContextMenu"
      @trigger="
        (e: PointerEvent) => {
          if (isHasTouchDevice && isTouchEvent(e)) onContextMenu?.(e)
        }
      "
    >
      <div
        class="shortcut__icon-container"
        :style="{ marginBottom: `${settings.shortcut.spacing.iconTitleGap}px` }"
      >
        <div
          v-if="pined && settings.shortcut.pinnedIcon && settings.shortcut.topSites"
          class="shortcut__pin-icon"
          :class="pinIconClass"
        >
          <el-icon size="11">
            <pin12-regular />
          </el-icon>
        </div>
        <div
          class="shortcut__icon"
          :class="[iconClass, { border: settings.shortcut.style.border }]"
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
        v-if="settings.shortcut.title.show"
        class="shortcut__title"
        :style="{ width: `calc(var(--icon_size) + ${settings.shortcut.title.extraWidth}px)` }"
        truncated
      >
        {{ title }}
      </el-text>
    </OnLongPress>
  </div>
</template>
