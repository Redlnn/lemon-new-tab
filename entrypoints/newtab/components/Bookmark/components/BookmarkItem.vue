<script setup lang="ts">
import { onLongPress } from '@vueuse/core'

import { useDroppable } from '@dnd-kit/vue'
import { useSortable } from '@dnd-kit/vue/sortable'
import type { DropdownInstance } from 'element-plus'
import { useTranslation } from 'i18next-vue'
import Dismiss12Regular from '~icons/fluent/dismiss-12-regular'
import Pin12Regular from '~icons/fluent/pin-12-regular'
import EditOutlined from '~icons/ic/outline-edit'
import ContentCopyRound from '~icons/ic/round-content-copy'
import DeleteOutlineRound from '~icons/ic/round-delete-outline'
import DragIndicatorRound from '~icons/ic/round-drag-indicator'
import FolderOpenRound from '~icons/ic/round-folder-open'
import OpenInNewRound from '~icons/ic/round-open-in-new'

import { browser, type Browser } from 'wxt/browser'

import { acquireFaviconRef, getFaviconURL, releaseFaviconRef } from '@/shared/media'
import { useQuickLinksStore } from '@/shared/quickLinks'

import {
  BOOKMARK_ACTIVE_MAP,
  BOOKMARK_OPENED_MENU_CLOSE_FN,
  OPEN_BOOKMARK_EDIT_DIALOG,
  OPEN_QUICK_LINK_GROUP_SELECT_DIALOG,
} from '@newtab/shared/keys'
import { isHasTouchDevice, isTouchEvent } from '@newtab/shared/touch'
import { isSafeUrl, isValidUrl } from '@newtab/shared/utils'

import { useBookmarkItemContext } from '../composables/bookmarkItemContext'
import {
  BOOKMARK_DND_GROUP,
  BOOKMARK_DND_TYPE,
  bookmarkContainerDndId,
  bookmarkDndId,
} from '../composables/useBookmarkDnd'

const openBookmarkEditDialog = inject(OPEN_BOOKMARK_EDIT_DIALOG)
const openQuickLinkGroupSelectDialog = inject(OPEN_QUICK_LINK_GROUP_SELECT_DIALOG)

const { t } = useTranslation()
const quickLinksStore = useQuickLinksStore()
const { popperClass: popperPerfClass, quickLinksGrouping } = useBookmarkItemContext()

const props = withDefaults(
  defineProps<{
    node: Browser.bookmarks.BookmarkTreeNode
    depth?: number
    isSearching?: boolean
    isSortedMode?: boolean
    disableDrag?: boolean
  }>(),
  {
    depth: 1,
    isSearching: false,
    isSortedMode: false,
    disableDrag: false,
  },
)
const isFolder = computed(() => !!props.node.children)
const isTopLevel = computed(() => props.depth === 1)
// 搜索、非原始排序或显式禁用时不允许改写真实书签顺序。
const isDragDisabled = computed(() => {
  return props.disableDrag || props.isSearching || props.isSortedMode
})
const expandeds = computed(() => activeMap?.value[props.depth] ?? [])
const id = computed(() => props.node.id)
const canCollapseOther = computed(() => {
  if (!isFolder) return false

  const list = expandeds.value
  const len = list.length
  if (len === 0) return false

  const idStr = String(id.value)

  // 只有“唯一展开的就是自己”时不能折叠其它
  return !(len === 1 && list[0] === idStr)
})

const faviconRef = props.node.url ? getFaviconURL(props.node.url) : ref('')

onMounted(() => {
  if (props.node.url) acquireFaviconRef(props.node.url)
})
onUnmounted(() => {
  if (props.node.url) releaseFaviconRef(props.node.url)
})

// 右键菜单相关
const openedMenuCloseFn = inject(BOOKMARK_OPENED_MENU_CLOSE_FN)
const dropdownRef = ref<DropdownInstance>()
const position = ref({
  top: 0,
  left: 0,
  bottom: 0,
  right: 0,
} as DOMRect)
const triggerRef = ref({
  getBoundingClientRect: () => position.value,
})

const itemRef = useTemplateRef('itemRef')
const sortableRef = ref<HTMLElement | null>(null)
const childrenDropRef = ref<HTMLElement | null>(null)
const dragHandleRef = ref<HTMLElement | null>(null)

const bookmarkDndData = computed(() => ({
  kind: 'bookmark-item' as const,
  id: props.node.id,
  parentId: props.node.parentId,
  index: props.node.index,
  isFolder: isFolder.value,
}))

const bookmarkSortableDisabled = computed(() => {
  const disabled = isDragDisabled.value || isTopLevel.value
  return {
    draggable: disabled,
    droppable: disabled,
  }
})

const { isDragging, isDropTarget } = useSortable({
  id: computed(() => bookmarkDndId(props.node.id)),
  index: computed(() => props.node.index ?? 0),
  group: computed(() => props.node.parentId ?? BOOKMARK_DND_GROUP),
  element: sortableRef,
  handle: dragHandleRef,
  type: BOOKMARK_DND_TYPE,
  accept: BOOKMARK_DND_TYPE,
  data: bookmarkDndData,
  disabled: bookmarkSortableDisabled,
  transition: {
    duration: 150,
    easing: 'ease',
  },
})
let suppressClickUntil = 0

watch(isDragging, (dragging, wasDragging) => {
  if (!dragging && wasDragging) {
    suppressClickUntil = Date.now() + 350
  }
})

function handleClickCapture(event: MouseEvent) {
  if (isDragging.value || Date.now() < suppressClickUntil) {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
}

const { isDropTarget: isChildrenDropTarget } = useDroppable({
  id: computed(() => bookmarkContainerDndId(props.node.id)),
  element: childrenDropRef,
  type: 'bookmark-container',
  accept: BOOKMARK_DND_TYPE,
  data: computed(() => ({
    kind: 'bookmark-container' as const,
    parentId: props.node.id,
    index: props.node.children?.length ?? 0,
  })),
  disabled: computed(() => !isFolder.value || isDragDisabled.value),
})

function handleContextmenu(event: MouseEvent | TouchEvent | PointerEvent): void {
  // 打开新菜单前关闭旧菜单
  if (openedMenuCloseFn?.value) {
    openedMenuCloseFn.value()
  }

  let clientX = 0
  let clientY = 0

  if ('clientX' in event) {
    clientX = event.clientX
    clientY = event.clientY
  } else if ('touches' in event && event.touches[0]) {
    clientX = event.touches[0].clientX
    clientY = event.touches[0].clientY
  }

  position.value = DOMRect.fromRect({
    x: clientX,
    y: clientY,
  })
  dropdownRef.value?.handleOpen()

  // 记录当前菜单的关闭函数
  if (openedMenuCloseFn) {
    openedMenuCloseFn.value = () => dropdownRef.value?.handleClose()
  }
}

onLongPress(itemRef, (event) => {
  if (isHasTouchDevice.value && isTouchEvent(event)) {
    handleContextmenu(event)
  }
})

function openInNewTab() {
  if (!props.node.url) return
  open(props.node.url, '_blank')
}

function openInNewWindow() {
  if (!props.node.url || !isSafeUrl(props.node.url)) return
  browser.windows.create({ url: props.node.url })
}

function copyLink() {
  if (!props.node.url) return
  navigator.clipboard.writeText(props.node.url)
}

async function addToQuickLinks() {
  if (!props.node.url || !isValidUrl(props.node.url)) return
  const quickLink = {
    url: props.node.url,
    title: props.node.title || '',
    favicon: faviconRef.value,
  }
  if (quickLinksGrouping.value) {
    const groupId = await openQuickLinkGroupSelectDialog?.({
      title: t('quickLinks.groups.selectPinTarget'),
    })
    if (!groupId) return
    await quickLinksStore.addQuickLinkToGroup(groupId, quickLink)
  } else {
    quickLinksStore.items.push(quickLink)
    await quickLinksStore.save()
  }
  ElMessage.success(t('bookmark.added'))
}

// 注入共享的 activeMap（按深度索引），用于跨层级控制折叠展开
const activeMap = inject(BOOKMARK_ACTIVE_MAP)

// 本层嵌套 collapse 对应的深度键（children 的深度）
const childDepthKey = props.depth + 1

const model = computed({
  get: () => activeMap?.value?.[childDepthKey] ?? [],
  set: (v: string[]) => {
    if (!activeMap) return
    const prev = activeMap.value || {}
    activeMap.value = {
      ...prev,
      [childDepthKey]: v,
    }
  },
})

// 懒加载优化：判断当前节点是否展开
const isExpanded = computed(() => {
  return activeMap?.value?.[props.depth]?.includes(String(id.value)) ?? false
})

const hasBeenExpanded = ref(false)

watch(
  isExpanded,
  (val) => {
    if (val) {
      hasBeenExpanded.value = true
    }
  },
  { immediate: true },
)

const shouldRenderChildren = computed(() => hasBeenExpanded.value || isExpanded.value)

async function deleteBookmark() {
  try {
    await ElMessageBox.confirm(
      isFolder.value
        ? t('bookmark.delete.confirmFolder', { name: props.node.title })
        : t('bookmark.delete.confirm', { name: props.node.title }),
      t('common.warning'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.no'),
        type: 'warning',
      },
    )

    if (props.node.children) {
      browser.bookmarks.removeTree(id.value)
    } else {
      browser.bookmarks.remove(id.value)
    }
    ElMessage.success(t('bookmark.delete.success', { title: props.node.title }))
  } catch {
    return
  }
}

function collapseOther(e: Event | undefined, all: boolean = false) {
  const map = activeMap?.value
  if (!map) return

  const depth = props.depth
  const self = String(id.value)
  const list = map[depth] ?? []

  if (all) {
    if (list.length !== 0) map[depth] = []
    return
  }

  // 判断当前是否展开
  const isSelfExpanded = list.includes(self)

  // 目标状态
  const next = isSelfExpanded ? [self] : []

  // 避免无效写入（Vue diff 依赖引用变化）
  if (list.length !== next.length || list[0] !== next[0]) {
    map[depth] = next
  }
}
</script>

<template>
  <div
    ref="sortableRef"
    class="bookmark-dnd-item"
    :class="{
      'bookmark-dnd-item--dragging': isDragging,
      'bookmark-dnd-item--drop-target': isDropTarget,
    }"
    style="display: grid"
    @click.capture="handleClickCapture"
    @contextmenu.stop.prevent="handleContextmenu"
  >
    <el-collapse-item
      v-if="node.children"
      :name="node.id"
      :style="{ '--depth': `${depth * 20}px` }"
    >
      <template #title>
        <el-icon color="var(--el-color-primary)"><folder-open-round /></el-icon>
        <span>{{ node.title || '(未命名)' }}</span>
        <div v-if="!(depth === 1)" ref="dragHandleRef" class="bookmark-drag-handle-container">
          <el-icon v-if="!isDragDisabled" class="bookmark-drag-handle">
            <drag-indicator-round />
          </el-icon>
        </div>
      </template>
      <el-collapse v-if="shouldRenderChildren" v-model="model" expand-icon-position="left">
        <div
          ref="childrenDropRef"
          class="bookmark-dnd-children"
          :class="{ 'bookmark-dnd-children--drop-target': isChildrenDropTarget }"
        >
          <bookmark-item
            v-for="child in node.children ?? []"
            :key="child.id"
            :node="child"
            :depth="depth + 1"
            :is-searching="isSearching"
            :is-sorted-mode="isSortedMode"
            :disable-drag="isDragDisabled"
            :data-node-id="child.id"
            :data-node-indexx="child.index"
          />
        </div>
      </el-collapse>
    </el-collapse-item>
    <a
      v-else
      ref="itemRef"
      class="bookmark-link-item"
      :class="{ 'is-no-drag': isDragDisabled }"
      :href="node.url"
    >
      <img :src="faviconRef" />
      <el-text line-clamp="2">
        {{ node.title }}
      </el-text>
      <div ref="dragHandleRef" class="bookmark-drag-handle-container">
        <el-icon v-if="!isDragDisabled" class="bookmark-drag-handle">
          <drag-indicator-round />
        </el-icon>
      </div>
    </a>
    <el-dropdown
      ref="dropdownRef"
      :virtual-ref="triggerRef"
      :show-arrow="false"
      virtual-triggering
      trigger="contextmenu"
      placement="bottom-start"
      :popper-options="{
        modifiers: [{ name: 'offset', options: { offset: [0, 0] } }],
      }"
      :popper-class="popperPerfClass"
    >
      <template #dropdown>
        <el-dropdown-menu class="noselect">
          <template v-if="!isFolder">
            <el-dropdown-item :icon="OpenInNewRound" @click="openInNewTab">
              <span>{{ t('settings:common.openInNewTab') }}</span>
            </el-dropdown-item>
            <el-dropdown-item :icon="OpenInNewRound" @click="openInNewWindow">
              <span>{{ t('settings:common.openInNewWindow') }}</span>
            </el-dropdown-item>
            <el-dropdown-item :icon="ContentCopyRound" divided @click="copyLink">
              <span>{{ t('settings:common.copyLink') }}</span>
            </el-dropdown-item>
            <el-dropdown-item :icon="Pin12Regular" @click="addToQuickLinks">
              <span>{{ t('bookmark.addToQuickLinks') }}</span>
            </el-dropdown-item>
          </template>
          <template v-if="!isTopLevel">
            <el-dropdown-item
              :icon="EditOutlined"
              :divided="!isFolder"
              @click="openBookmarkEditDialog && openBookmarkEditDialog(node)"
            >
              <span>{{ t('common.edit') }}</span>
            </el-dropdown-item>
            <el-dropdown-item :icon="DeleteOutlineRound" @click="deleteBookmark">
              <span>{{ t('common.delete') }}</span>
            </el-dropdown-item>
          </template>
          <li v-if="!isTopLevel" role="separator" class="el-dropdown-menu__item--divided"></li>
          <el-dropdown-item v-if="canCollapseOther" :icon="ContentCopyRound" @click="collapseOther">
            <span>{{ t('bookmark.collapse.other') }}</span>
          </el-dropdown-item>
          <el-dropdown-item
            v-if="expandeds.length > 0"
            :icon="ContentCopyRound"
            @click="collapseOther(undefined, true)"
          >
            <span>{{ t('bookmark.collapse.all') }}</span>
          </el-dropdown-item>
          <el-dropdown-item :icon="Dismiss12Regular">
            <span>{{ t('common.cancel') }}</span>
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>
