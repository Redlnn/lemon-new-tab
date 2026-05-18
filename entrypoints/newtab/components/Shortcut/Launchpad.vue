<script setup lang="ts">
import { OnLongPress } from '@vueuse/components'
import { onKeyStroke, useDebounceFn, useElementSize, useSwipe, useWindowSize } from '@vueuse/core'

import { useTranslation } from 'i18next-vue'
import { useDraggable } from 'vue-draggable-plus'
import Pin12Regular from '~icons/fluent/pin-12-regular'
import AddRound from '~icons/ic/round-add'
import SettingsRound from '~icons/ic/round-settings'

import { getFaviconURL } from '@/shared/media'
import { useSettingsStore } from '@/shared/settings'
import { useShortcutStore } from '@/shared/shortcut'

import { usePerfClasses } from '@newtab/composables/usePerfClasses'
import { OPEN_SETTINGS } from '@newtab/shared/keys'
import { isHasTouchDevice, isTouchEvent } from '@newtab/shared/touch'

import ShortcutContextMenu from './components/ShortcutContextMenu.vue'
import { buildShortcutDisplayItems } from './composables/shortcutDisplayItems'
import { useShortcutData } from './composables/useShortcutData'
import { useTopSitesMerge } from './composables/useTopSitesMerge'

// Stable Ref map so we don't re-create Refs on every render
const faviconRefMap = new Map<string, Ref<string>>()
function getOrCreateFaviconRef(url: string): string {
  if (!faviconRefMap.has(url)) {
    faviconRefMap.set(url, getFaviconURL(url))
  }
  return faviconRefMap.get(url)!.value
}

const refreshDebounced = useDebounceFn(refresh, 100)

const { topSites, shortcuts, topSitesNeedsReload } = useShortcutData(refreshDebounced)

const model = defineModel<boolean>({ required: true })

const props = defineProps<{
  onOpenAddDialog?: () => void
  onOpenEditDialog?: (index: number) => void
}>()

const { t } = useTranslation()
const settings = useSettingsStore()
const shortcutStore = useShortcutStore()

const openSettings = inject(OPEN_SETTINGS)

const { width: windowWidth } = useWindowSize({ type: 'visual' })

// ---- 状态 ----
const query = ref('')
const page = ref(0)
const containerRef = useTemplateRef<HTMLElement>('container')
const searchInputRef = useTemplateRef<{ focus: () => void }>('searchInput')
const { height: containerHeight } = useElementSize(containerRef)

const COLS = computed(() => {
  if (windowWidth.value <= 700) return 4
  else if (windowWidth.value <= 900) return 5
  else if (windowWidth.value <= 1000) return 6
  else return 7
})
const ROWS = computed(() => {
  const isSmall = windowWidth.value <= 500
  const isMid = windowWidth.value <= 800
  const h = containerHeight.value - (isSmall ? 70 : 88) - 64
  const rowHeight = isSmall ? 106 : isMid ? 114 : 122
  return Math.max(1, Math.floor((h + 8) / rowHeight))
})

const pageSize = computed(() => COLS.value * ROWS.value)

const allItems = computed(() => buildShortcutDisplayItems(shortcuts.value, topSites.value))

const isSearching = computed(() => query.value.trim().length > 0)

const filteredItems = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return allItems.value
  return allItems.value.filter(
    (item) => item.title.toLowerCase().includes(q) || item.url.toLowerCase().includes(q),
  )
})

// 添加按钮占1个槽，纳入分页计算
const pageCount = computed(() => {
  const total = !isSearching.value ? allItems.value.length + 1 : allItems.value.length
  return Math.max(1, Math.ceil(total / pageSize.value))
})

const currentItems = computed(() => {
  if (isSearching.value) return filteredItems.value
  const start = page.value * pageSize.value
  const isLastPage = page.value === pageCount.value - 1
  // 最后一页留一个槽给添加按钮
  const end = isLastPage && !isSearching.value ? start + pageSize.value - 1 : start + pageSize.value
  return allItems.value.slice(start, end)
})

// ---- 数据获取 ----
async function refresh() {
  shortcuts.value = shortcutStore.items.slice()

  // 合并最常访问
  if (settings.dock.launchpad.topSites) {
    topSites.value = await useTopSitesMerge({
      shortcuts: shortcuts.value,
      force: topSitesNeedsReload.value,
      noCap: true, // 不截断，获取所有可用的 top sites
    })
    topSitesNeedsReload.value = false
    // topSites.value = sites.map((s) => ({ url: s.url, title: s.title ?? '', favicon: s.favicon }))
  } else {
    topSites.value = []
  }
}

// ---- 翻页 ----
const pageDirection = ref<'forward' | 'backward'>('forward')

function prevPage() {
  if (page.value > 0) {
    pageDirection.value = 'backward'
    page.value--
  }
}

function nextPage() {
  if (page.value < pageCount.value - 1) {
    pageDirection.value = 'forward'
    page.value++
  }
}

// ---- 关闭 ----
function close() {
  if (ctxMenuOpen.value) {
    ctxMenuRef.value?.close()
    ctxMenuOpen.value = false
    return
  }
  model.value = false
}

// ---- 滑动翻页（移动端）----
useSwipe(containerRef, {
  onSwipeEnd(_e, dir) {
    if (dir === 'left') nextPage()
    else if (dir === 'right') prevPage()
  },
})

// ---- 键盘 ----
onKeyStroke('Escape', (e) => {
  if (model.value) {
    e.preventDefault()
    close()
  }
})

onKeyStroke('ArrowLeft', (e) => {
  if (model.value && !isSearching.value) {
    e.preventDefault()
    prevPage()
  }
})

onKeyStroke('ArrowRight', (e) => {
  if (model.value && !isSearching.value) {
    e.preventDefault()
    nextPage()
  }
})

// ---- 打开时重置 & 刷新 ----
watch(
  model,
  async (v) => {
    if (v) {
      query.value = ''
      page.value = 0
      await refresh()
      await nextTick()
      searchInputRef.value?.focus()
    }
  },
  { immediate: true },
)

// 搜索时回到第0页
watch(query, () => {
  page.value = 0
})

// 页数变化时确保当前页有效
watch(pageCount, (count) => {
  if (page.value >= count) page.value = Math.max(0, count - 1)
})

watch(
  () => settings.dock.launchpad.topSites,
  (enabled) => {
    if (enabled) {
      topSitesNeedsReload.value = true
    }
    refreshDebounced()
  },
)

// ---- 点击打开 ----
function openItem(url: string) {
  window.open(url, settings.dock.launchpad.openInNewTab ? '_blank' : '_self')
}

// ---- 右键菜单 ----
const perf = usePerfClasses(() => ({
  transparent: settings.perf.shortcut.transparent,
  blur: settings.perf.shortcut.blur,
}))

const popperClass = perf('shortcut__menu-popper')

const ctxMenuRef = useTemplateRef<InstanceType<typeof ShortcutContextMenu>>('ctxMenuRef')
const ctxMenuOpen = ref(false)

function openCtxMenu(
  event: MouseEvent | PointerEvent,
  item: { url: string; title: string; isPinned: boolean; originalIndex: number },
): void {
  ctxMenuRef.value?.open(event, item)
  ctxMenuOpen.value = true
}

// ---- 拖动排序（仅置顶项目）----
const gridRef = useTemplateRef<HTMLElement>('gridRef')

useDraggable(gridRef, shortcuts, {
  animation: 150,
  delayOnTouchOnly: true,
  touchStartThreshold: 10,
  delay: 100,
  handle: '.launchpad-item--pined',
  onStart() {
    ctxMenuRef.value?.close()
  },
  onUpdate() {
    shortcutStore.items = shortcuts.value
    shortcutStore.save()
    refreshDebounced()
  },
})
</script>

<template>
  <Teleport to="body">
    <Transition name="launchpad-fade">
      <el-overlay v-show="model" :overlay-class="['launchpad-overlay', 'noselect']" :z-index="1">
        <div
          class="launchpad-wrapper"
          ref="container"
          @click.self="close"
          @contextmenu.prevent.stop
        >
          <!-- 搜索栏 -->
          <div class="launchpad-search">
            <el-input
              ref="searchInput"
              v-model="query"
              :placeholder="t('dock.launchpad.search')"
              clearable
              size="large"
              class="launchpad-search__input"
            >
              <template #prefix>
                <el-icon :size="16">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path
                      d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
                    />
                  </svg>
                </el-icon>
              </template>
            </el-input>

            <!-- 设置按钮 -->
            <div
              role="button"
              tabindex="0"
              class="launchpad-settings action-btn setting-btn"
              @click="openSettings"
            >
              <el-icon><settings-round /></el-icon>
            </div>
          </div>

          <!-- 图标网格 -->
          <Transition
            :name="pageDirection === 'backward' ? 'launchpad-page-back' : 'launchpad-page'"
            mode="out-in"
          >
            <div
              :key="isSearching ? 'search' : page"
              ref="gridRef"
              class="launchpad-grid"
              :style="{ '--lp-cols': COLS }"
              @click.self="close"
            >
              <OnLongPress
                v-for="item in currentItems"
                :key="item.url"
                as="div"
                class="launchpad-item"
                :class="{ 'launchpad-item--pined': item.isPinned }"
                @click="openItem(item.url)"
                @contextmenu.prevent="openCtxMenu($event, item)"
                @trigger="
                  (e: PointerEvent) => {
                    if (isHasTouchDevice && isTouchEvent(e)) openCtxMenu(e, item)
                  }
                "
              >
                <div class="launchpad-item__icon">
                  <img :src="item.favicon || getOrCreateFaviconRef(item.url)" :alt="item.title" />
                </div>
                <el-text :line-clamp="1" truncated class="launchpad-item__label">
                  <el-icon v-if="item.isPinned && settings.dock.launchpad.topSites">
                    <pin12-regular />
                  </el-icon>
                  {{ item.title }}
                </el-text>
              </OnLongPress>
              <!-- 无结果 -->
              <div
                v-if="currentItems.length === 0 && isSearching"
                class="launchpad-empty"
                style="pointer-events: none"
              >
                {{ t('dock.launchpad.empty') }}
              </div>
              <!-- 添加按钮（仅最后一页显示）-->
              <div
                v-if="!isSearching && page === pageCount - 1"
                class="launchpad-item"
                @click="props.onOpenAddDialog"
              >
                <el-icon class="launchpad-item__icon launchpad-item__icon--add">
                  <add-round />
                </el-icon>
                <el-text :line-clamp="1" truncated class="launchpad-item__label">
                  {{ t('dock.launchpad.add') }}
                </el-text>
              </div>
            </div>
          </Transition>

          <!-- 分页控制（非搜索模式，多于1页时显示） -->
          <div v-if="!isSearching && pageCount > 1" class="launchpad-pagination">
            <button class="launchpad-arrow" :disabled="page === 0" @click="prevPage">
              <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                <path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z" />
              </svg>
            </button>
            <div class="launchpad-dots">
              <span
                v-for="i in pageCount"
                :key="i"
                class="launchpad-dot"
                :class="{ 'launchpad-dot--active': page === i - 1 }"
                @click="page = i - 1"
              ></span>
            </div>
            <button class="launchpad-arrow" :disabled="page === pageCount - 1" @click="nextPage">
              <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
              </svg>
            </button>
          </div>
        </div>
      </el-overlay>
    </Transition>

    <!-- 右键菜单 -->
    <shortcut-context-menu
      ref="ctxMenuRef"
      :refresh-fn="refreshDebounced"
      :on-open-edit-dialog="props.onOpenEditDialog"
      :popper-class="popperClass"
      show-edit
      @visible-change="(v: boolean) => (ctxMenuOpen = v)"
    />
  </Teleport>
</template>

<style lang="scss">
.launchpad-overlay {
  overflow: hidden;
  backdrop-filter: blur(40px) saturate(1.5);
}

.launchpad-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  height: 100%;
  max-height: 100dvh;
  padding: 60px 40px 90px;

  @media (width <= 500px) {
    padding: 40px 20px 90px;
  }
}

.launchpad-search {
  display: flex;
  gap: 5px;
  align-items: center;
  width: 320px;
  max-width: 90dvw;
  margin-bottom: 48px;

  @media (width <= 500px) {
    margin-bottom: 30px;
  }

  &__input {
    --el-input-bg-color: rgb(255 255 255 / 20%);
    --el-input-border-color: rgb(255 255 255 / 30%);
    --el-input-hover-border-color: rgb(255 255 255 / 60%);
    --el-input-focus-border-color: rgb(255 255 255 / 80%);
    --el-input-text-color: #fff;
    --el-input-placeholder-color: rgb(255 255 255 / 55%);
    --el-input-clear-hover-color: #fff;

    .el-input__wrapper {
      backdrop-filter: blur(10px);
    }
  }
}

.launchpad-settings {
  position: absolute;
  top: 25px;
  right: 35px;
  color: rgb(255 255 255 / 30%);

  @media (width <= 480px) {
    position: static;
  }
}

.launchpad-grid {
  display: grid;
  flex: 1;
  grid-template-columns: repeat(var(--lp-cols, 7), 1fr);
  gap: 8px;
  align-content: start;
  width: 100%;
  max-width: 1000px;
}

.launchpad-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 8px;
  overflow: hidden;
  cursor: pointer;
  border-radius: 16px;
  transition:
    background-color 0.15s ease,
    transform 0.15s ease;

  &--pined {
    cursor: grab;

    &:active {
      cursor: grabbing;
    }
  }

  &:hover:not(:has(.launchpad-item__icon--add)),
  &:focus-visible {
    background-color: rgb(255 255 255 / 12%);
  }

  &:hover,
  &:focus-visible {
    transform: scale(1.06);

    .launchpad-item__icon--add {
      background-color: rgb(255 255 255 / 25%);
    }
  }

  &__icon {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 72px;
    height: 72px;
    margin-bottom: 8px;
    overflow: hidden;
    border-radius: 18px;
    transition: 0.15s ease;

    @media (width <= 800px) {
      width: 64px;
      height: 64px;
      border-radius: 14px;
    }

    @media (width <= 500px) {
      width: 56px;
      height: 56px;
      border-radius: 12px;
    }

    img {
      width: 75%;
      height: 75%;
      object-fit: contain;
      border-radius: 10px;
    }

    &--add {
      font-size: 38px;
      color: rgb(255 255 255 / 85%);
      background-color: rgb(255 255 255 / 15%);
    }
  }

  &__label {
    font-size: 12px;
    font-weight: 500;
    color: #fff;
    text-shadow: 0 1px 4px rgb(0 0 0 / 40%);
  }
}

.launchpad-empty {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  justify-content: center;
  height: 200px;
  font-size: 16px;
  color: rgb(255 255 255 / 50%);
}

.launchpad-pagination {
  display: flex;
  flex-shrink: 0;
  gap: 12px;
  align-items: center;
  margin-top: 32px;
}

.launchpad-dots {
  display: flex;
  gap: 8px;
}

.launchpad-dot {
  width: 7px;
  height: 7px;
  cursor: pointer;
  background-color: rgb(255 255 255 / 35%);
  border-radius: 50%;
  transition:
    background-color 0.2s ease,
    transform 0.2s ease;

  &:hover {
    background-color: rgb(255 255 255 / 65%);
  }

  &--active {
    background-color: #fff;
    transform: scale(1.2);
  }
}

.launchpad-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  overflow: hidden;
  color: rgb(255 255 255 / 70%);
  cursor: pointer;
  background: rgb(255 255 255 / 12%);
  border: none;
  border-radius: 50%;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;

  &:hover:not(:disabled) {
    color: #fff;
    background: rgb(255 255 255 / 25%);
  }

  &:disabled {
    cursor: default;
    opacity: 0.3;
  }
}

/* ---- 入场/离场动画 ---- */
.launchpad-fade-enter-active,
.launchpad-fade-leave-active {
  transition:
    opacity 0.3s ease,
    backdrop-filter 0.3s ease;

  .launchpad-wrapper {
    transition: transform 0.3s ease;
  }
}

.launchpad-fade-enter-from,
.launchpad-fade-leave-to {
  opacity: 0;

  .launchpad-wrapper {
    transform: scale(1.05);
  }
}

/* ---- 翻页动画（下一页：右→左）---- */
.launchpad-page-enter-active,
.launchpad-page-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.launchpad-page-enter-from {
  opacity: 0;
  transform: translateX(24px);
}

.launchpad-page-leave-to {
  opacity: 0;
  transform: translateX(-24px);
}

/* ---- 翻页动画（上一页：左→右）---- */
.launchpad-page-back-enter-active,
.launchpad-page-back-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.launchpad-page-back-enter-from {
  opacity: 0;
  transform: translateX(-24px);
}

.launchpad-page-back-leave-to {
  opacity: 0;
  transform: translateX(24px);
}
</style>
