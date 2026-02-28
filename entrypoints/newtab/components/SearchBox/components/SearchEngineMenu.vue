<script setup lang="ts">
import { useTimeoutFn } from '@vueuse/core'

import type { TooltipInstance } from 'element-plus'
import { useTranslation } from 'i18next-vue'

import { getFaviconURL } from '@/shared/media'
import { useSettingsStore } from '@/shared/settings'

import usePerfClasses from '@newtab/composables/usePerfClasses'
import { useCustomSearchEngineStore } from '@newtab/shared/customSearchEngine'
import { searchEngines } from '@newtab/shared/search'
import { useFocusStore } from '@newtab/shared/store'

const { t } = useTranslation()

const focusStore = useFocusStore()
const settings = useSettingsStore()
const customSearchEngineStore = useCustomSearchEngineStore()
const searchEngineMenu = ref<TooltipInstance>()

const isBuiltInEngine = computed(() => {
  return settings.search.engine in searchEngines
})

// 缓存自定义搜索引擎的 favicon Ref
const customEngineFaviconCache = new Map<string, Ref<string>>()

function getCustomEngineFavicon(engine: { id: string; url: string; icon?: string }): string {
  if (engine.icon) {
    return engine.icon
  }

  if (!customEngineFaviconCache.has(engine.id)) {
    customEngineFaviconCache.set(engine.id, getFaviconURL(engine.url))
  }

  return customEngineFaviconCache.get(engine.id)!.value
}

const currentCustomEngine = computed(() => {
  if (isBuiltInEngine.value) {
    return null
  } else {
    return customSearchEngineStore.items.find((engine) => engine.id === settings.search.engine)
  }
})

function hide() {
  searchEngineMenu.value?.hide()
}

let stop: () => void
const showingToast = ref(false)
const currentEngineName = ref('')

function showEngineToast() {
  if (stop) stop()

  // 获取当前搜索引擎的名字
  if (isBuiltInEngine.value) {
    const engine = searchEngines[settings.search.engine as keyof typeof searchEngines]
    currentEngineName.value = t(engine.nameKey)
  } else {
    const customEngine = customSearchEngineStore.items.find((e) => e.id === settings.search.engine)
    currentEngineName.value = customEngine?.name || ''
  }

  // 显示提示
  showingToast.value = true
  // 3秒后自动隐藏
  const { stop: timeoutStop } = useTimeoutFn(() => {
    showingToast.value = false
  }, 1000)
  stop = timeoutStop
}

const perf = usePerfClasses(() => ({
  transparentOff: settings.perf.disableSearchBarTransparent,
  blurOff: settings.perf.disableSearchBarBlur
}))

const popperPerfClass = perf('search-engine-menu')

defineExpose({ hide, showEngineToast })
</script>

<template>
  <div :style="{ opacity: focusStore.isFocused || settings.search.showIconAlways ? 1 : 0 }">
    <el-tooltip
      ref="searchEngineMenu"
      trigger="click"
      :disabled="!focusStore.isFocused && !settings.search.showIconAlways"
      :show-arrow="false"
      :popper-class="popperPerfClass"
      placement="bottom-start"
      effect="customized"
    >
      <template #content>
        <!-- 内置搜索引擎 -->
        <div
          v-for="key in Object.keys(searchEngines) as (keyof typeof searchEngines)[]"
          :key="key"
          class="search-engine-menu-item"
          :class="{
            'search-engine-menu-item--active': settings.search.engine === key
          }"
          @click="settings.search.engine = key"
        >
          <div style="display: flex; align-items: center">
            <el-icon class="search-engine-menu-item__icon"
              ><component :is="searchEngines[key].icon"
            /></el-icon>
            <span>{{ t(searchEngines[key].nameKey) }}</span>
          </div>
          <div
            v-if="key === settings.search.engine"
            style="font-size: 11px; color: var(--el-text-color-secondary)"
          >
            {{ t('search.searchEngineMenu.current') }}
          </div>
        </div>

        <!-- 自定义搜索引擎 -->
        <template v-if="customSearchEngineStore.items.length > 0">
          <el-divider />
          <div
            v-for="engine in customSearchEngineStore.items"
            :key="engine.id"
            class="search-engine-menu-item"
            :class="{
              'search-engine-menu-item--active': settings.search.engine === engine.id
            }"
            @click="settings.search.engine = engine.id"
          >
            <div style="display: flex; align-items: center">
              <div
                class="search-engine-menu-item__icon search-engine-menu-item__icon--custom"
                :style="{
                  backgroundImage: `url(${getCustomEngineFavicon(engine)})`
                }"
              ></div>
              <span>{{ engine.name }}</span>
            </div>
            <div
              v-if="engine.id === settings.search.engine"
              style="font-size: 11px; color: var(--el-text-color-secondary)"
            >
              {{ t('search.searchEngineMenu.current') }}
            </div>
          </div>
        </template>
        <div class="search-engine-menu__tip">
          <span>{{ t('search.searchEngineMenu.tipPrefix') }}</span>
          <kbd class="search-engine-menu__kbd">Tab</kbd>
          <span>{{ t('search.searchEngineMenu.tipSuffix') }}</span>
        </div>
      </template>
      <el-icon v-if="isBuiltInEngine" class="search-engine-menu__icon">
        <component :is="searchEngines[settings.search.engine as keyof typeof searchEngines].icon" />
      </el-icon>
      <div v-else class="search-engine-menu__icon search-engine-menu__icon--custom">
        <img :src="getCustomEngineFavicon(currentCustomEngine!)" />
      </div>
    </el-tooltip>
    <transition name="engine-toast" mode="out-in">
      <div v-if="showingToast" :key="currentEngineName" class="search-engine-menu__toast">
        {{ currentEngineName }}
      </div>
    </transition>
  </div>
</template>

<style lang="scss">
@use '@newtab/styles/mixins/acrylic.scss' as acrylic;

.search-engine-menu {
  &.is-customized {
    --el-popper-border-radius: 15px;

    min-width: 210px;
    padding: 5px;
    background-color: var(--el-bg-color-overlay);
    transition:
      background-color var(--el-transition-duration-fast) ease,
      opacity var(--el-transition-duration-fast) ease;

    &.search-engine-menu--opacity {
      background-color: var(--le-bg-color-overlay-opacity-30);
    }

    &.search-engine-menu--blur {
      @include acrylic.acrylic;
    }
  }

  &-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 18px;
    overflow: hidden;
    font-size: var(--el-font-size-extra-small);
    color: var(--el-text-color-primary);
    cursor: pointer;
    border-radius: 10px;

    &:hover,
    &:focus-visible {
      background: var(--le-bg-color-overlay-opacity-30);
    }

    &--active {
      background: var(--le-bg-color-overlay-opacity-20);
    }

    .search-engine-menu-item__icon {
      margin-right: 10px;
      font-size: var(--el-font-size-small);
      color: var(--el-text-color-regular);

      &.search-engine-menu-item__icon--custom {
        width: 1em;
        height: 1em;
        background-repeat: no-repeat;
        background-position: center;
        background-size: contain;
      }
    }
  }

  &__tip {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 20px;
    padding: 0 10px;
    margin-top: 5px;
    font-size: 11px;
    color: var(--el-text-color-secondary);
    transition: color var(--el-transition-duration-fast) ease;

    .search-engine-menu__kbd {
      padding: 2px 4px;
      margin: 0 3px;
      font-size: 10px;
      line-height: 1em;
      border: solid 1px currentColor;
      border-radius: 3px;
    }
  }

  .el-divider--horizontal {
    width: calc(100% - 36px);
    margin: 5px 18px;
  }

  &__toast {
    position: absolute;
    top: 50%;
    left: 40px;
    font-size: var(--el-font-size-small);
    color: var(--el-text-color-regular);
    transform: translateY(-50%);
  }
}

.engine-toast-enter-active {
  transition: all 0.1s ease-out;
}

.engine-toast-leave-active {
  transition: all 0.1s ease-in;
}

.engine-toast-enter-from {
  opacity: 0;
  transform: translateY(-10%);
}

.engine-toast-leave-to {
  opacity: 0;
  transform: translateY(-70%);
}
</style>
