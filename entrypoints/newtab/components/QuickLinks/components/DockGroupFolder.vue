<script setup lang="ts">
import { OnLongPress } from '@vueuse/components'

import { useTranslation } from 'i18next-vue'
import AddRound from '~icons/ic/round-add'

import type { QuickLink, QuickLinkGroup } from '@/shared/quickLinks'
import { useSettingsStore } from '@/shared/settings'

import { isTouchEvent } from '@newtab/shared/touch'

import FaviconImage from './FaviconImage.vue'

const props = defineProps<{
  group: QuickLinkGroup
  popperClass: string
}>()
const emit = defineEmits<{
  openItem: [event: MouseEvent, item: QuickLink]
  itemMenu: [event: MouseEvent | PointerEvent, item: QuickLink, index: number]
  add: []
  show: []
  hide: []
}>()
const { t } = useTranslation()
const settings = useSettingsStore()
const visible = ref(false)
const triggerRef = useTemplateRef<HTMLElement>('trigger')
const panelRef = useTemplateRef<HTMLElement>('panel')
const previewItems = computed(() =>
  Array.from({ length: 4 }, (_, index) => props.group.items[index]),
)

async function onShow() {
  await nextTick()
  panelRef.value?.focus({ preventScroll: true })
}

onBeforeUnmount(() => emit('hide'))

function close() {
  visible.value = false
  triggerRef.value?.focus({ preventScroll: true })
}

function addLink() {
  visible.value = false
  emit('add')
}

function openItem(event: MouseEvent, item: QuickLink) {
  visible.value = false
  emit('openItem', event, item)
}

function onLongPress(event: PointerEvent, item: QuickLink, index: number) {
  if (isTouchEvent(event)) emit('itemMenu', event, item, index)
}
</script>

<template>
  <el-popover
    v-model:visible="visible"
    trigger="click"
    transition="dock-folder-fade"
    :show-after="0"
    :hide-after="0"
    :persistent="false"
    placement="top"
    :width="360"
    :show-arrow="false"
    :offset="16"
    :popper-class="`${popperClass} dock-folder-popper`"
    @before-enter="emit('show')"
    @show="onShow"
    @after-leave="emit('hide')"
  >
    <template #reference>
      <div
        ref="trigger"
        class="dock-item dock-folder"
        role="button"
        tabindex="0"
        :title="group.name"
        :aria-label="group.name"
        aria-haspopup="dialog"
        :aria-expanded="visible"
        @keydown.enter.prevent="visible = !visible"
        @keydown.space.prevent="visible = !visible"
        @keydown.esc.stop.prevent="close"
      >
        <span class="dock-folder__icon" aria-hidden="true">
          <span class="dock-folder__preview">
            <span v-for="(item, index) in previewItems" :key="index" class="dock-folder__tile">
              <favicon-image
                v-if="item"
                :url="item.url"
                :favicon="item.favicon"
                :icon="item.icon"
                :title="item.title"
              />
            </span>
          </span>
        </span>
      </div>
    </template>
    <div
      ref="panel"
      class="dock-folder-panel noselect"
      role="dialog"
      tabindex="-1"
      :aria-label="group.name"
      @keydown.esc.stop.prevent="close"
      @contextmenu.stop.prevent
      @dragstart.prevent
    >
      <div class="dock-folder-panel__header">
        <span class="dock-folder-panel__title">{{ group.name }}</span>
        <el-button
          :icon="AddRound"
          :aria-label="t('quickLinks.addLink')"
          circle
          text
          @click="addLink"
        />
      </div>
      <el-scrollbar
        v-if="group.items.length"
        max-height="min(calc(var(--dock-folder-row-height) * 3 + var(--dock-folder-grid-gap) * 2), 50dvh)"
        wrap-class="dock-folder-panel__scroll"
        view-class="dock-folder-panel__grid"
      >
        <OnLongPress
          v-for="(item, index) in group.items"
          :key="item.id ?? item.url"
          as="a"
          class="dock-folder-panel__link"
          draggable="false"
          :href="item.url"
          :target="settings.dock.openInNewTab ? '_blank' : '_self'"
          :rel="settings.dock.openInNewTab ? 'noopener noreferrer' : undefined"
          :title="item.title"
          @click="openItem($event, item)"
          @contextmenu.stop.prevent="emit('itemMenu', $event, item, index)"
          @trigger="onLongPress($event, item, index)"
        >
          <span class="dock-folder-panel__favicon">
            <favicon-image
              :url="item.url"
              :favicon="item.favicon"
              :icon="item.icon"
              :title="item.title"
            />
          </span>
          <span class="dock-folder-panel__label">{{ item.title }}</span>
        </OnLongPress>
      </el-scrollbar>
      <p v-else class="dock-folder-panel__empty">{{ t('settings:dock.emptyGroup') }}</p>
    </div>
  </el-popover>
</template>

<style>
.dock-folder__icon {
  position: relative;
  display: flex;
  align-items: flex-end;
  width: 75%;
  height: 70%;
  padding-top: 12%;
  isolation: isolate;
}

.dock-folder__icon::before,
.dock-folder__icon::after {
  position: absolute;
  z-index: -1;
  content: '';
  background: color-mix(in srgb, var(--el-color-primary) 65%, var(--el-bg-color));
}

.dock-folder__icon::before {
  inset: 0 46% 50% 0;
  border-radius: 25% 40% 0 0;
}

.dock-folder__icon::after {
  inset: 12% 0 40%;
  border-radius: 14% 14% 0 0;
}

.dock-folder__preview {
  display: grid;
  grid-template-rows: repeat(2, minmax(0, 1fr));
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8%;
  width: 100%;
  height: 100%;
  padding: 8%;
  container-type: size;
  background: linear-gradient(
    155deg,
    var(--el-color-primary-light-5),
    var(--el-color-primary-light-7)
  );
  border-radius: 15%;
  box-shadow: 0 1px 2px rgb(0 0 0 / 5%);
}

.dock-folder__tile {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  height: 50cqh;
  min-height: 0;
  aspect-ratio: 1;
  overflow: hidden;
  background: color-mix(in srgb, var(--el-bg-color) 70%, transparent) center/contain no-repeat;
  border-radius: 25%;

  &:nth-child(odd) {
    justify-self: end;
  }

  &:nth-child(even) {
    justify-self: start;
  }

  &:nth-child(-n + 2) {
    align-self: end;
  }

  &:nth-child(n + 3) {
    align-self: start;
  }
}

.dock-folder .dock-folder__tile :is(img, .favicon-image__component, .favicon-image__title-initial) {
  width: 80%;
  height: 80%;
  font-size: calc(var(--scale, 1) * var(--item-size) * 0.16);
  object-fit: contain;
  border-radius: 20%;
}

.dock-folder-popper.el-popper {
  max-width: calc(100dvw - 24px);
  padding: 16px;
  border-radius: var(--le-radius-base, 20px);
  box-shadow: 0 12px 36px rgb(0 0 0 / 18%);
}

.dock-folder-panel {
  --dock-folder-row-height: 90px;
  --dock-folder-grid-gap: 8px;

  outline: none;
}

.dock-folder-fade-enter-active {
  transition: opacity 0.1s ease-out;
}

.dock-folder-fade-leave-active {
  transition: opacity 0.1s ease-in;
}

.dock-folder-fade-enter-from,
.dock-folder-fade-leave-to {
  opacity: 0;
}

.dock-folder-panel__header {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.dock-folder-panel__title {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}

.dock-folder-panel__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-auto-rows: var(--dock-folder-row-height);
  gap: var(--dock-folder-grid-gap);
}

.dock-folder-panel__scroll {
  overscroll-behavior: contain;
}

.dock-folder-panel__link {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  min-width: 0;
  padding: 10px 4px;
  color: var(--el-text-color-primary);
  text-decoration: none;
  border-radius: var(--le-radius-small, 8px);
  transition: background-color 0.15s ease;
}

.dock-folder-panel__link:hover,
.dock-folder-panel__link:focus-visible {
  background: var(--el-fill-color);
}

.dock-folder-panel__favicon {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  overflow: hidden;
  background: var(--el-fill-color-light);
  border-radius: var(--le-radius-medium, 12px);
}

.dock-folder-panel__favicon :is(img, .favicon-image__component, .favicon-image__title-initial) {
  width: 70%;
  height: 70%;
  object-fit: contain;
  border-radius: 6px;
}

.dock-folder-panel__favicon .favicon-image__title-initial {
  display: grid;
  place-items: center;
  font-size: 24px;
}

.dock-folder-panel__label {
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  line-height: 18px;
  text-align: center;
  white-space: nowrap;
}

.dock-folder-panel__empty {
  padding: 24px 0;
  margin: 0;
  color: var(--el-text-color-secondary);
  text-align: center;
}
</style>
