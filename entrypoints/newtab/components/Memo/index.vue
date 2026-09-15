<script setup lang="ts">
import 'element-plus/theme-chalk/src/dialog.scss'
import '@newtab/styles/dialog.scss'
import '@newtab/styles/memo.scss'
import { onClickOutside, useWindowSize } from '@vueuse/core'

import { useLocale, type InputInstance } from 'element-plus'
import { useTranslation } from 'i18next-vue'
import Plus from '~icons/fa7-solid/plus'
import Save from '~icons/ic/baseline-save'
import CloseRound from '~icons/ic/round-close'
import Code from '~icons/ic/round-code'
import KeyboardArrowLeftRound from '~icons/ic/round-keyboard-arrow-left'
import RoundMenu from '~icons/ic/round-menu-open'
import RoundModeEditIcon from '~icons/ic/round-mode-edit'

import { getMemoTitle, listMemos, saveMemo, type MemoRecord } from '@/shared/memos'

import { useImeAwareDialog } from '@newtab/composables/useImeAwareDialog'

import MilkdownEditorWrapper from './MilkdownEditorWrapper.vue'

const MOBILE_BREAKPOINT = 600
const COLLAPSE_BREAKPOINT = 850
const { t, i18next } = useTranslation('newtab')
const { t: tElement } = useLocale()
const { width } = useWindowSize({ type: 'visual' })
const opened = defineModel<boolean>({ required: true })
const { isComposing } = useImeAwareDialog()
const isMobile = computed(() => width.value < MOBILE_BREAKPOINT)
const isFloatingAside = computed(() => !isMobile.value && width.value < COLLAPSE_BREAKPOINT)
function createDraft(): MemoRecord {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), markdown: '', createdAt: now, updatedAt: now }
}

const memos = ref<MemoRecord[]>([])
const selected = ref<MemoRecord | null>(null)
const draft = ref<MemoRecord>(createDraft())
const isReadonly = ref(true)
const isTitleEditing = ref(false)
const showAside = ref(true)
const showCode = ref(false)
const asideRef = useTemplateRef('asideRef')
const titleInputRef = useTemplateRef<InputInstance>('titleInputRef')

onClickOutside(asideRef, () => {
  if (isFloatingAside.value) {
    showAside.value = false
  }
})

const displayTitle = computed(() => draft.value.title || t('memo.untitled'))
const draftDirty = computed(() => {
  const title = draft.value.title?.trim() || undefined
  if (!selected.value) return Boolean(title || draft.value.markdown.trim())
  return selected.value.title !== title || selected.value.markdown !== draft.value.markdown
})

async function refreshMemos() {
  memos.value = await listMemos()
}

function resetView() {
  selected.value = null
  draft.value = createDraft()
  isReadonly.value = true
  isTitleEditing.value = false
  showCode.value = false
  showAside.value = true
}

async function load() {
  await refreshMemos()
  resetView()
  if (!isMobile.value && !isFloatingAside.value) createMemo()
}

async function resolveUnsaved() {
  if (!draftDirty.value) return true
  try {
    await ElMessageBox.confirm(t('memo.unsaved'), t('common.warning'), {
      confirmButtonText: t('common.save'),
      cancelButtonText: t('common.cancel'),
      distinguishCancelAndClose: true,
      type: 'warning',
    })
    await saveCurrent()
    return true
  } catch {
    return true
  }
}

async function selectMemo(memo: MemoRecord) {
  if (selected.value?.id === memo.id || !(await resolveUnsaved())) return
  const plainMemo = { ...memo }
  selected.value = plainMemo
  draft.value = structuredClone(plainMemo)
  isReadonly.value = true
  isTitleEditing.value = false
  showCode.value = false
  if (isMobile.value || isFloatingAside.value) showAside.value = false
}

function createMemo() {
  resetView()
  isReadonly.value = false
  isTitleEditing.value = true
  showCode.value = false
  if (isMobile.value || isFloatingAside.value) showAside.value = false
  nextTick(() => titleInputRef.value?.focus())
}

async function saveCurrent() {
  const saved = await saveMemo(
    selected.value
      ? draft.value
      : { ...draft.value, title: getMemoTitle(draft.value) || undefined },
  )
  selected.value = saved
  draft.value = structuredClone(saved)
  await refreshMemos()
}

async function saveTitle() {
  isTitleEditing.value = false
  draft.value.title = draft.value.title?.trim() || undefined
  if (!selected.value) return
  const saved = await saveMemo({ ...selected.value, title: draft.value.title })
  selected.value = saved
  draft.value.updatedAt = saved.updatedAt
  await refreshMemos()
}

async function backToList() {
  if (await resolveUnsaved()) resetView()
}

async function beforeClose(done: () => void) {
  if (await resolveUnsaved()) done()
}

watch(
  opened,
  (visible) => {
    if (visible) void load()
  },
  { immediate: true },
)

watch(isMobile, () => {
  if (opened.value) resetView()
})

function editTitle() {
  isTitleEditing.value = true
  nextTick(() => {
    titleInputRef.value?.focus()
  })
}

function formatMemoTime(updatedAt: string): string {
  const date = new Date(updatedAt)
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const daysAgo = Math.round((todayStart.getTime() - dateStart.getTime()) / 86_400_000)
  const locale = i18next.language
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date)

  if (daysAgo >= 0 && daysAgo <= 2) {
    return t(`memo.time.${['today', 'yesterday', 'dayBeforeYesterday'][daysAgo]}`, { time })
  }

  return new Intl.DateTimeFormat(locale, {
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
  }).format(date)
}

const asideBtnStatus = computed(() => {
  if (!isFloatingAside.value) {
    if (showAside.value) return false
    else return true
  }
  return true
})
</script>

<template>
  <el-dialog
    v-model="opened"
    :width="850"
    class="memo__dialog"
    :class="[{ 'is-mobile': isMobile }, { 'is-floating-aside': isFloatingAside }]"
    draggable
    :show-close="false"
    :close-on-press-escape="!isComposing"
    :before-close="beforeClose"
    header-class="memo-header noselect"
    body-class="memo-dialog-body"
  >
    <template #header="{ close, titleId }">
      <button v-if="isMobile && !showAside" class="memo-back-btn" @click="backToList">
        <el-icon :size="20"><component :is="KeyboardArrowLeftRound" /></el-icon>
      </button>
      <div :id="titleId" class="base-dialog-title">
        {{ t('memo.title') }}
      </div>
      <div
        role="button"
        tabindex="0"
        :aria-label="tElement('el.dialog.close')"
        class="base-dialog-close-btn"
        @click="close"
        @keydown.enter="close"
        @keydown.space.prevent="close"
      >
        <component :is="CloseRound" />
      </div>
    </template>
    <div class="memo-layout">
      <Transition :name="isMobile ? undefined : 'collapse-width'">
        <aside v-if="showAside" ref="asideRef" class="memo-aside-wrapper">
          <div class="memo-aside">
            <el-button :icon="Plus" type="primary" class="memo-create" plain @click="createMemo">
              {{ t('memo.create') }}
            </el-button>
            <div class="memo-aside-list">
              <button
                v-for="memo in memos"
                :key="memo.id"
                class="memo-aside-item"
                :class="{ 'is-active': selected?.id === memo.id }"
                @click="selectMemo(memo)"
              >
                <span class="memo-aside-title">
                  {{ memo.title || t('memo.untitled') }}
                </span>
                <span class="memo-aside-modified-time">
                  {{ formatMemoTime(memo.updatedAt) }}
                </span>
              </button>
            </div>
          </div>
        </aside>
      </Transition>
      <div v-if="!isMobile || !showAside" class="memo-main">
        <div class="memo-actions-container">
          <el-button
            :icon="RoundMenu"
            class="memo-aside-show-btn"
            :class="{ flip: asideBtnStatus }"
            @click="showAside = !showAside"
          />
          <div class="memo-title-wrap">
            <button v-if="!isTitleEditing" class="memo-title" @click="editTitle">
              {{ displayTitle }}
            </button>
            <el-input
              v-else
              v-model="draft.title"
              class="memo-title-input"
              :placeholder="displayTitle"
              @keyup.enter="saveTitle"
              @blur="saveTitle"
              ref="titleInputRef"
            />
          </div>
          <el-space class="memo-actions" :size="3">
            <el-button v-if="isReadonly" :icon="RoundModeEditIcon" @click="isReadonly = false" />
            <template v-else>
              <el-button
                :icon="Code"
                :type="showCode ? 'primary' : 'default'"
                @click="showCode = !showCode"
              />
              <el-button :icon="Save" @click="saveCurrent" />
            </template>
          </el-space>
        </div>
        <div class="memo-content-container">
          <MilkdownEditorWrapper
            v-if="!showCode"
            :key="draft.id"
            v-model:content="draft.markdown"
            v-model:readonly="isReadonly"
          />
          <el-input v-else v-model="draft.markdown" type="textarea" resize="none" />
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<style lang="scss">
.memo-dialog-body {
  display: flex;
  flex-grow: 1;
  min-height: 0;
}

.memo-layout {
  display: flex;
  flex: 1;
  width: 100%;
  min-height: 0;
  padding: 0 15px 15px;
}

.memo-aside {
  width: 200px;
  margin-right: 10px;

  &-wrapper {
    overflow: hidden;
  }

  .is-floating-aside & {
    margin-right: unset;
  }
}

.memo-aside-show-btn.flip {
  i {
    transform: scaleX(-1);
  }
}

.memo-create.el-button {
  justify-content: flex-start;
  width: 100%;
  height: 36px;
  margin-bottom: 10px;
  font-weight: bold;
  border: 0;
  border-radius: 15px;
}

.memo-aside-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.memo-aside-item {
  width: 100%;
  padding: 10px 18px;
  text-align: left;
  cursor: pointer;
  background: var(--memo-item-background);
  border: 0;
  border-radius: 15px;
}

.memo-aside-item.is-active {
  color: white;
  background: var(--el-color-primary);
}

.memo-aside-title,
.memo-aside-modified-time {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.memo-aside-title {
  margin-bottom: 2px;
  font-weight: bold;
}

.memo-aside-modified-time {
  font-size: var(--el-font-size-extra-small);
  opacity: 0.75;
}

.memo-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.memo-actions-container {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  min-height: 36px;
  margin-bottom: 10px;
}

.memo-title-wrap {
  flex: 1;
  min-width: 0;
}

.memo-title {
  width: 100%;
  max-width: 100%;
  padding: 6px 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 16px;
  font-weight: 700;
  text-align: left;
  white-space: nowrap;
  cursor: text;
  background: transparent;
  border: 0;
}

.memo-actions {
  flex-shrink: 0;
}

.memo-content-container {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  border-radius: 10px;
}

.memo-content-container .el-textarea,
.memo-content-container .el-textarea__inner {
  height: 100%;
}

.memo-content-container .el-textarea__inner {
  background: #fefcf7;
  border-radius: 10px;
}

.collapse-width-enter-from,
.collapse-width-leave-to {
  width: 0;
  opacity: 0;
}

.collapse-width-enter-to,
.collapse-width-leave-from {
  width: 210px;
  opacity: 1;
}

.collapse-width-enter-active,
.collapse-width-leave-active {
  transition:
    width var(--el-transition-duration-fast) ease,
    opacity var(--el-transition-duration-fast) ease;
}

.is-floating-aside .memo-aside-wrapper {
  position: absolute;
  z-index: 11;
  height: calc(100% - 65px);
  padding: 8px;
  background: var(--el-bg-color);
  border-radius: 20px;
  box-shadow: var(--el-box-shadow);
}

.is-mobile .memo-layout {
  position: relative;
  padding: 0 12px 12px;
}

.is-mobile .memo-aside-wrapper {
  position: absolute;
  inset: 0 12px 12px;
  z-index: 2;
}

.is-mobile .memo-aside {
  width: 100%;
  margin: 0;
}

.is-mobile .memo-aside-show-btn {
  display: none;
}

.is-mobile .is-mobile .memo-actions-container {
  align-items: stretch;
}

.is-mobile .memo-title-wrap {
  width: 100%;
}

.is-mobile .memo-title-input {
  max-width: none;
}

.is-mobile .memo-actions {
  align-self: flex-end;
}
</style>
