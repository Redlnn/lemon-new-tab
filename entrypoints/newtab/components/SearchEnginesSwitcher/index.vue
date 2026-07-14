<script setup lang="ts">
import { DragDropProvider, type DragEndEvent } from '@dnd-kit/vue'
import { useTranslation } from 'i18next-vue'
import Plus from '~icons/fa6-solid/plus'

import { defaultSettings, useSettingsStore } from '@/shared/settings'
import type { BuiltInSearchEngineKey } from '@/shared/searchEngines'

import BaseDialog from '@newtab/components/BaseDialog.vue'
import usePerfClasses from '@newtab/composables/usePerfClasses'
import { useCustomSearchEngineStore } from '@newtab/shared/customSearchEngine'
import { useCustomEngineFavicon } from '@newtab/shared/customSearchEngine/useCustomEngineFavicon'
import { SEARCH_ENGINE_OPENED_MENU_CLOSE_FN } from '@newtab/shared/keys'
import {
  getAvailableSearchEngineIds,
  getVisibleBuiltInSearchEngineKeys,
  isBuiltInSearchEngineKey,
  normalizeBuiltInSearchEngineOrder,
  searchEngines,
} from '@newtab/shared/search'

import AddCustomSearchEngine from './components/AddCustomSearchEngine.vue'
import SearchEngineItem from './components/SearchEngineItem.vue'
import { quickLinkDndSensors } from '../QuickLinks/composables/useQuickLinkDnd'

const { t } = useTranslation()

const opened = defineModel<boolean>({ required: true })

const settings = useSettingsStore()
const customSearchEngineStore = useCustomSearchEngineStore()
const { getCustomEngineFavicon } = useCustomEngineFavicon()

const perf = usePerfClasses(() => ({
  transparent: settings.perf.dialog.transparent,
  transparency: settings.perf.dialog.transparency,
  blur: settings.perf.dialog.blur,
}))
const enginePopperClass = perf('se-switcher-item__menu-popper')

const addCustomSearchEngineRef = ref<InstanceType<typeof AddCustomSearchEngine>>()
const visibleBuiltInEngines = computed(() =>
  getVisibleBuiltInSearchEngineKeys(
    settings.search.builtInEngineOrder,
    settings.search.hiddenBuiltInEngines,
  ),
)
const availableEngineIds = computed(() =>
  getAvailableSearchEngineIds(
    settings.search.builtInEngineOrder,
    settings.search.hiddenBuiltInEngines,
    customSearchEngineStore.items.map((engine) => engine.id),
  ),
)

function selectCustomEngine(engineId: string) {
  settings.search.engine = engineId
}

function editCustomEngine(index: number) {
  addCustomSearchEngineRef.value?.openEditDialog(index)
}

async function deleteCustomEngine(index: number) {
  const engine = customSearchEngineStore.items[index]
  if (!engine) return

  try {
    await ElMessageBox.confirm(
      t('customSearchEngine.deleteConfirm', { name: engine.name }),
      t('common.warning'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.no'),
        type: 'warning',
      },
    )

    const currentIndex = availableEngineIds.value.indexOf(engine.id)
    customSearchEngineStore.items.splice(index, 1)
    await customSearchEngineStore.save()

    if (settings.search.engine !== engine.id) return
    const available = availableEngineIds.value
    if (available.length > 0) {
      settings.search.engine = available[Math.max(currentIndex, 0) % available.length]!
      return
    }

    settings.search.hiddenBuiltInEngines = settings.search.hiddenBuiltInEngines.filter(
      (key) => key !== defaultSettings.search.engine,
    )
    settings.search.engine = defaultSettings.search.engine
  } catch {
    // 用户取消删除
  }
}

const openedMenuCloseFn = ref<(() => void) | null>(null)
provide(SEARCH_ENGINE_OPENED_MENU_CLOSE_FN, openedMenuCloseFn)

function closeOpenedMenu() {
  openedMenuCloseFn.value?.()
  openedMenuCloseFn.value = null
}

function hideBuiltInEngine(key: string) {
  if (!isBuiltInSearchEngineKey(key)) return
  const currentIndex = availableEngineIds.value.indexOf(key)
  if (currentIndex < 0 || availableEngineIds.value.length <= 1) return

  settings.search.hiddenBuiltInEngines = [...settings.search.hiddenBuiltInEngines, key]
  if (settings.search.engine !== key) return

  const available = availableEngineIds.value
  settings.search.engine = available[currentIndex % available.length]!
}

function moveItem<T>(items: T[], from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return false
  const [item] = items.splice(from, 1)
  items.splice(to, 0, item!)
  return true
}

type SearchEngineDndData = {
  kind: 'search-engine'
  id: string
  index: number
  group: 'built-in' | 'custom'
}

function getDndData(source: unknown): SearchEngineDndData | null {
  const data = (source as { data?: unknown } | null)?.data
  if (!data || typeof data !== 'object' || (data as { kind?: unknown }).kind !== 'search-engine') {
    return null
  }
  return data as SearchEngineDndData
}

async function handleDragEnd(event: DragEndEvent) {
  closeOpenedMenu()
  if (event.canceled) return

  const source = event.operation.source as {
    data?: unknown
    initialIndex?: unknown
    index?: unknown
  } | null
  const data = getDndData(source)
  const from = typeof source?.initialIndex === 'number' ? source.initialIndex : data?.index
  const to = typeof source?.index === 'number' ? source.index : from
  if (!data || from === undefined || to === undefined || from === to) return

  if (data.group === 'custom') {
    if (moveItem(customSearchEngineStore.items, from, to)) {
      await customSearchEngineStore.save()
    }
    return
  }

  const targetKey = visibleBuiltInEngines.value[to]
  const order = normalizeBuiltInSearchEngineOrder(settings.search.builtInEngineOrder)
  if (!targetKey || !moveItem(order, order.indexOf(data.id as BuiltInSearchEngineKey), order.indexOf(targetKey))) {
    return
  }
  settings.search.builtInEngineOrder = order
}
</script>

<template>
  <base-dialog
    v-model="opened"
    :title="t('menu.searchEnginePreference')"
    container-class="se-switcher__dialog"
    @scroll="closeOpenedMenu"
  >
    <div style="width: 100%; margin-top: 20px; overflow: hidden">
      <DragDropProvider
        :sensors="quickLinkDndSensors"
        @dragStart="closeOpenedMenu"
        @dragEnd="handleDragEnd"
      >
        <!-- 内置搜索引擎 -->
        <div class="se-switcher-container noselect">
          <SearchEngineItem
            v-for="(key, index) in visibleBuiltInEngines"
            :id="key"
            :key="key"
            :index="index"
            group="built-in"
            :name="t(searchEngines[key].nameKey)"
            :url="searchEngines[key].url"
            :icon="searchEngines[key].icon"
            :is-active="settings.search.engine === key"
            :can-hide="availableEngineIds.length > 1"
            :popper-class="enginePopperClass"
            @select="settings.search.engine = $event"
            @hide="hideBuiltInEngine"
          />
        </div>

        <div class="se-switcher-divider noselect">
          {{ t('customSearchEngine.title') }}
        </div>
        <div class="se-switcher-container noselect">
          <SearchEngineItem
            v-for="(engine, index) in customSearchEngineStore.items"
            :id="engine.id"
            :key="engine.id"
            :index="index"
            group="custom"
            :name="engine.name"
            :url="engine.url"
            :is-active="settings.search.engine === engine.id"
            :icon-url="getCustomEngineFavicon(engine)"
            :popper-class="enginePopperClass"
            @select="selectCustomEngine"
            @edit="() => editCustomEngine(index)"
            @delete="() => deleteCustomEngine(index)"
          />
          <div
            role="button"
            tabindex="0"
            class="se-switcher-item se-switcher-item--add"
            :aria-label="t('customSearchEngine.add')"
            @click="addCustomSearchEngineRef?.openAddDialog"
            @keydown.enter="addCustomSearchEngineRef?.openAddDialog"
            @keydown.space.prevent="addCustomSearchEngineRef?.openAddDialog"
          >
            <el-icon size="16" class="se-switcher-item__icon">
              <plus />
            </el-icon>
            <div class="se-switcher-item__content">
              <div class="se-switcher-item__label" style="font-weight: var(--el-font-size-base)">
                {{ t('customSearchEngine.add') }}
              </div>
            </div>
          </div>
        </div>
      </DragDropProvider>
    </div>
  </base-dialog>

  <add-custom-search-engine ref="addCustomSearchEngineRef" />
</template>

<style lang="scss">
@use '@newtab/styles/mixins/acrylic.scss' as acrylic;

.se-switcher__dialog {
  --se-item-background: var(--el-bg-color);
  --se-item-hover-background: var(--el-fill-color-dark);
  --se-item-active-background: var(--el-color-primary);
  --se-icon-background: var(--el-fill-color-blank);
  --se-icon-active-background: var(--se-icon-background);
  --se-active-url-color: var(--el-fill-color);
}

html.dark .se-switcher__dialog {
  --se-item-active-background: var(--el-color-primary-light-3);
  --se-icon-background: var(--le-text-color-primary-opacity-65);
  --se-icon-active-background: var(--el-text-color-primary);
  --se-active-url-color: var(--el-text-color-secondary);
}

html.colorful .se-switcher__dialog {
  --se-item-background: var(--el-color-primary-light-8);
  --se-item-hover-background: var(--el-color-primary-light-7);
}

.se-switcher-divider {
  display: flex;
  align-items: center;
  margin: 24px 0;
  font-size: var(--el-font-size-extra-small);
  color: var(--el-text-color-placeholder);

  &::before,
  &::after {
    flex: 1;
    min-width: 0; /* 允许缩小到 0，避免被文本撑开 */
    height: 0.5px; /* 粗细 */
    content: '';
    background: currentColor;
  }

  &::before {
    margin-right: 0.75em;
  }

  &::after {
    margin-left: 0.75em;
  }
}

.se-switcher-container {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.se-switcher-item {
  display: flex;
  align-items: center;
  height: 65px;
  padding: 16px 18px;
  touch-action: manipulation;
  cursor: pointer;
  background-color: var(--se-item-background);
  border-radius: var(--le-radius-surface, 15px);

  &:hover {
    background-color: var(--se-item-hover-background);
  }

  &.is-active {
    color: var(--el-color-white);
    background-color: var(--se-item-active-background);
  }

  &--add {
    color: var(--el-text-color-secondary);
  }

  &__icon {
    flex-grow: 0;
    flex-shrink: 0;
    width: 30px;
    height: 30px;
    margin-right: 8px;
    background-color: var(--se-icon-background);
    border-radius: 50%;

    &:has(img) {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    img {
      width: 16px;
      height: 16px;
      object-fit: cover;
    }

    &--default {
      opacity: 0.5;
    }

    .se-switcher-item:hover &,
    .se-switcher-item.is-active & {
      background-color: var(--se-icon-active-background);
    }
  }

  &__content {
    flex-grow: 1;
    min-width: 0;
  }

  &__label {
    font-weight: 600;
  }

  &__url {
    margin-top: 1px;
    vertical-align: text-bottom;
    color: var(--el-text-color-secondary);
  }

  &.is-active &__url {
    color: var(--se-active-url-color);
  }

  &__checked {
    display: none;
    flex-grow: 0;
    margin-left: 12px;

    .is-active & {
      display: block;
    }
  }
}

.se-switcher-item__menu-popper.el-dropdown__popper.el-popper {
  --le-radius-popper: var(--le-radius-surface, 15px);
  --le-menu-padding: 4px;
  --el-popper-border-radius: var(--le-radius-popper);

  border-radius: var(--le-radius-popper);

  &.se-switcher-item__menu-popper--opacity.se-switcher-item__menu-popper--blur {
    // 只有模糊时才有透明度效果，否则会影响可读性
    background-color: var(--le-bg-color-overlay-dialog-menu);
  }

  &.se-switcher-item__menu-popper--blur {
    @include acrylic.acrylic;
  }

  .el-dropdown-menu {
    padding: var(--le-menu-padding);
    background-color: initial;
  }

  .el-dropdown-menu__item {
    padding: 3px 30px 2px 10px;
    font-size: var(--el-font-size-extra-small);
    border-radius: var(--le-radius-menu-item);
  }
}
</style>
