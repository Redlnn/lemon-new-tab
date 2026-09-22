<script setup lang="ts">
import 'element-plus/theme-chalk/src/dialog.scss'
import '@newtab/styles/dialog.scss'
import '@newtab/styles/note.scss'
import { useWindowSize } from '@vueuse/core'

import { useLocale, type InputInstance } from 'element-plus'
import { useTranslation } from 'i18next-vue'
import Plus from '~icons/fa7-solid/plus'
import Save from '~icons/ic/baseline-save'
import CloseRound from '~icons/ic/round-close'
import Code from '~icons/ic/round-code'
import DeleteOutline from '~icons/ic/round-delete-outline'
import FileDownload from '~icons/ic/round-file-download'
import KeyboardArrowLeftRound from '~icons/ic/round-keyboard-arrow-left'
import RoundModeEditIcon from '~icons/ic/round-mode-edit'
import Pin from '~icons/ic/round-push-pin'
import PinOff from '~icons/ic/round-push-pin'

import { downloadBlob } from '@/shared/download'
import {
  deleteNote,
  getNoteTitle,
  listNotes,
  saveNote,
  setNotePinned,
  setNoteTitle,
  type NoteRecord,
} from '@/shared/notes'

import { useImeAwareDialog } from '@newtab/composables/useImeAwareDialog'

import MilkdownEditorWrapper from './MilkdownEditorWrapper.vue'

const COLLAPSE_BREAKPOINT = 850
type NoteMode = 'idle' | 'list' | 'view' | 'edit'

const { t, i18next } = useTranslation('newtab')
const { t: tElement } = useLocale()
const { width } = useWindowSize({ type: 'visual' })
const opened = defineModel<boolean>({ required: true })
const { isComposing } = useImeAwareDialog()
const isCompact = computed(() => width.value < COLLAPSE_BREAKPOINT)
const mode = ref<NoteMode>('idle')
const notes = ref<NoteRecord[]>([])
const selected = ref<NoteRecord | null>(null)
const draft = ref<NoteRecord>(createDraft())
const isTitleEditing = ref(false)
const showCode = ref(false)
const exporting = ref(false)
const menuNote = ref<NoteRecord | null>(null)
const menuPosition = ref({ x: 0, y: 0 })
const titleInputRef = useTemplateRef<InputInstance>('titleInputRef')

const isReadonly = computed(() => mode.value !== 'edit')
const showAside = computed(() => !isCompact.value || mode.value === 'list')
const displayTitle = computed(() => draft.value.title || t('note.untitled'))
const draftDirty = computed(() => {
  const title = draft.value.title?.trim() || undefined
  if (!selected.value) return Boolean(title || draft.value.markdown.trim())
  return selected.value.title !== title || selected.value.markdown !== draft.value.markdown
})

function createDraft(): NoteRecord {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), markdown: '', createdAt: now, updatedAt: now }
}

async function refreshNotes() {
  notes.value = await listNotes()
}

function resetView(
  nextMode: Extract<NoteMode, 'idle' | 'list'> = isCompact.value ? 'list' : 'idle',
) {
  selected.value = null
  draft.value = createDraft()
  mode.value = nextMode
  isTitleEditing.value = false
  showCode.value = false
  menuNote.value = null
}

async function load() {
  await refreshNotes()
  resetView()
}

async function resolveUnsaved(): Promise<boolean> {
  if (!draftDirty.value) return true
  try {
    await ElMessageBox.confirm(t('note.unsaved'), t('common.warning'), {
      confirmButtonText: t('common.save'),
      cancelButtonText: t('note.discard'),
      distinguishCancelAndClose: true,
      type: 'warning',
    })
    await saveCurrent()
    return true
  } catch (reason) {
    return reason === 'cancel'
  }
}

async function selectNote(note: NoteRecord) {
  if (selected.value?.id === note.id || !(await resolveUnsaved())) return
  const next = { ...note }
  draft.value = next
  selected.value = { ...next }
  mode.value = 'view'
  isTitleEditing.value = false
  showCode.value = false
  menuNote.value = null
}

async function createNote() {
  if (!(await resolveUnsaved())) return
  selected.value = null
  draft.value = createDraft()
  mode.value = 'edit'
  isTitleEditing.value = true
  showCode.value = false
  menuNote.value = null
  nextTick(() => titleInputRef.value?.focus())
}

async function saveCurrent() {
  const submitted = { ...draft.value }
  const saved = await saveNote(
    selected.value ? submitted : { ...submitted, title: getNoteTitle(submitted) || undefined },
  )
  if (draft.value.id === saved.id) {
    selected.value = saved
    // 等待落盘时仍可输入，只更新保存元数据，不能用旧正文覆盖后续输入。
    if (draft.value.title === submitted.title) draft.value.title = saved.title
    draft.value.updatedAt = saved.updatedAt
    draft.value.pinned = saved.pinned
  }
  await refreshNotes()
}

async function saveTitle() {
  isTitleEditing.value = false
  draft.value.title = draft.value.title?.trim() || undefined
  if (!selected.value || selected.value.title === draft.value.title) return
  const saved = await setNoteTitle(selected.value.id, draft.value.title)
  if (saved && selected.value?.id === saved.id) {
    selected.value = { ...selected.value, title: saved.title, updatedAt: saved.updatedAt }
    draft.value.updatedAt = saved.updatedAt
  }
  await refreshNotes()
}

function editTitle() {
  if (mode.value !== 'edit') return
  isTitleEditing.value = true
  nextTick(() => titleInputRef.value?.focus())
}

function submitTitle() {
  titleInputRef.value?.blur()
}

async function backToList() {
  if (!(await resolveUnsaved())) return
  resetView('list')
}

async function beforeClose(done: () => void) {
  if (await resolveUnsaved()) done()
}

function openMenu(event: MouseEvent, note: NoteRecord) {
  menuNote.value = note
  menuPosition.value = { x: event.clientX, y: event.clientY }
}

async function togglePinned() {
  const note = menuNote.value
  if (!note) return
  const saved = await setNotePinned(note.id, !note.pinned)
  if (saved && selected.value?.id === saved.id) {
    selected.value = saved
    draft.value.pinned = saved.pinned
  }
  await refreshNotes()
  menuNote.value = null
}

async function removeNote() {
  const note = menuNote.value
  if (!note) return
  if (selected.value?.id === note.id && !(await resolveUnsaved())) return
  try {
    await ElMessageBox.confirm(
      t('note.deleteConfirm', { title: getNoteTitle(note) || t('note.untitled') }),
      t('common.warning'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      },
    )
  } catch {
    return
  }
  await deleteNote(note.id)
  if (selected.value?.id === note.id) resetView(isCompact.value ? 'list' : 'idle')
  await refreshNotes()
  menuNote.value = null
}

function exportFileName() {
  const title = (getNoteTitle(draft.value) || t('note.untitled'))
    .replace(/[\\/:*?"<>|]/g, '-')
    .trim()
    .slice(0, 80)
  return `${title || 'note'}-${new Date().toISOString().slice(0, 10)}.png`
}

async function exportNote() {
  if (showCode.value) return
  const source = document.querySelector<HTMLElement>('.note-editor-frame')
  if (!source || exporting.value) return
  exporting.value = true
  try {
    const { default: html2canvas } = await import('html2canvas')
    // 只渲染便签；整页裁剪仍会解析其他 UI 中 html2canvas 不支持的 oklch 颜色。
    const canvas = await html2canvas(source, {
      backgroundColor: '#fefcf7',
      logging: false,
      scale: Math.min(window.devicePixelRatio || 1, 2),
      useCORS: true,
      onclone(_document, frame) {
        // 在副本中展开完整正文，避免 flex 收缩和滚动容器截断长便签。
        frame.style.flex = 'none'
        frame.style.height = 'auto'
        frame.style.overflow = 'visible'
        frame.querySelector<HTMLElement>('.editor')!.style.minHeight = `${source.clientHeight}px`
      },
    })
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('Canvas export failed'))),
        'image/png',
      ),
    )
    downloadBlob(blob, exportFileName())
    ElMessage.success(t('note.exported'))
  } catch (e) {
    ElMessage.error(t('note.exportFailed'))
    console.error(e)
  } finally {
    exporting.value = false
  }
}

const dateFormatters = computed(() => {
  const locale = i18next.language
  return {
    time: new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }),
    date: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }),
    year: new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }),
  }
})

const noteItems = computed(() =>
  notes.value.map((note) => ({
    note,
    title: getNoteTitle(note) || t('note.untitled'),
    time: formatNoteTime(note.updatedAt),
  })),
)

function formatNoteTime(updatedAt: string): string {
  const date = new Date(updatedAt)
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const daysAgo = Math.round((todayStart.getTime() - dateStart.getTime()) / 86_400_000)
  if (daysAgo >= 0 && daysAgo <= 2) {
    return t(`note.time.${['today', 'yesterday', 'dayBeforeYesterday'][daysAgo]}`, {
      time: dateFormatters.value.time.format(date),
    })
  }
  return dateFormatters.value[date.getFullYear() === today.getFullYear() ? 'date' : 'year'].format(
    date,
  )
}

watch(
  opened,
  (visible) => {
    if (visible) void load()
  },
  { immediate: true },
)

watch(isCompact, (compact) => {
  if (opened.value && compact && mode.value === 'idle') mode.value = 'list'
})
</script>

<template>
  <el-dialog
    v-model="opened"
    :width="850"
    class="note__dialog"
    :class="{ 'is-compact': isCompact }"
    draggable
    :show-close="false"
    :close-on-press-escape="!isComposing"
    :before-close="beforeClose"
    header-class="note-header noselect"
    body-class="note-dialog-body"
  >
    <template #header="{ close, titleId }">
      <button
        v-if="isCompact && mode !== 'list'"
        class="note-back-btn"
        :aria-label="t('note.backToList')"
        @click="backToList"
      >
        <el-icon :size="20"><component :is="KeyboardArrowLeftRound" /></el-icon>
      </button>
      <div :id="titleId" class="base-dialog-title">{{ t('note.title') }}</div>
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
    <div class="note-layout">
      <aside v-if="showAside" class="note-aside-wrapper">
        <div class="note-aside">
          <el-button :icon="Plus" type="primary" class="note-create" plain @click="createNote">{{
            t('note.create')
          }}</el-button>
          <div class="note-aside-list">
            <button
              v-for="{ note, title, time } in noteItems"
              :key="note.id"
              class="note-aside-item"
              :class="{ 'is-active': selected?.id === note.id }"
              @click="selectNote(note)"
              @contextmenu.prevent="openMenu($event, note)"
            >
              <span class="note-aside-title"
                ><component :is="Pin" v-if="note.pinned" class="note-pin-icon" />{{ title }}</span
              >
              <span class="note-aside-modified-time">{{ time }}</span>
            </button>
            <p v-if="notes.length === 0" class="note-list-empty">{{ t('note.listEmpty') }}</p>
          </div>
        </div>
      </aside>
      <main v-if="!isCompact || mode !== 'list'" class="note-main">
        <template v-if="mode === 'idle'">
          <section class="note-empty-state">
            <p>{{ t('note.empty') }}</p>
            <el-button :icon="Plus" type="primary" @click="createNote">{{
              t('note.create')
            }}</el-button>
          </section>
        </template>
        <template v-else>
          <div class="note-actions-container">
            <div class="note-title-wrap">
              <button v-if="!isTitleEditing" class="note-title" @click="editTitle">
                {{ displayTitle }}
              </button>
              <el-input
                v-else
                ref="titleInputRef"
                v-model="draft.title"
                class="note-title-input"
                :placeholder="displayTitle"
                @keyup.enter.prevent="submitTitle"
                @blur="saveTitle"
              />
            </div>
            <el-space class="note-actions" :size="3">
              <el-button
                :icon="FileDownload"
                :loading="exporting"
                :disabled="showCode"
                :aria-label="t('note.export')"
                :title="t('note.export')"
                @click="exportNote"
              />
              <el-button
                v-if="isReadonly"
                :icon="RoundModeEditIcon"
                :aria-label="t('note.edit')"
                :title="t('note.edit')"
                @click="mode = 'edit'"
              />
              <template v-else>
                <el-button
                  :icon="Code"
                  :type="showCode ? 'primary' : 'default'"
                  :aria-label="t('note.toggleSource')"
                  :title="t('note.toggleSource')"
                  @click="showCode = !showCode"
                />
                <el-button
                  :icon="Save"
                  :aria-label="t('common.save')"
                  :title="t('common.save')"
                  @click="saveCurrent"
                />
              </template>
            </el-space>
          </div>
          <div class="note-content-container">
            <el-input v-if="showCode" v-model="draft.markdown" type="textarea" resize="none" />
            <template v-else>
              <MilkdownEditorWrapper
                :key="draft.id"
                v-model:content="draft.markdown"
                v-model:readonly="isReadonly"
              />
            </template>
          </div>
        </template>
      </main>
    </div>
    <div
      v-if="menuNote"
      class="note-context-menu"
      :style="{ left: `${menuPosition.x}px`, top: `${menuPosition.y}px` }"
      @mouseleave="menuNote = null"
    >
      <button @click="togglePinned">
        <component :is="menuNote.pinned ? PinOff : Pin" />{{
          t(menuNote.pinned ? 'note.unpin' : 'note.pin')
        }}
      </button>
      <button class="is-danger" @click="removeNote">
        <component :is="DeleteOutline" />{{ t('common.delete') }}
      </button>
    </div>
  </el-dialog>
</template>

<style lang="scss">
.note-dialog-body {
  display: flex;
  flex-grow: 1;
  min-height: 0;
}

.note-layout {
  display: flex;
  flex: 1;
  width: 100%;
  min-height: 0;
  padding: 0 15px 15px;
}

.note-aside {
  width: 200px;
  margin-right: 10px;
}

.note-aside-wrapper {
  overflow: hidden;
}

.note-create.el-button {
  justify-content: flex-start;
  width: 100%;
  height: 36px;
  margin-bottom: 10px;
  font-weight: bold;
  border: 0;
  border-radius: 15px;
}

.note-aside-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.note-aside-item {
  width: 100%;
  padding: 10px 18px;
  text-align: left;
  cursor: pointer;
  background: var(--note-item-background);
  border: 0;
  border-radius: 15px;
}

.note-aside-item.is-active {
  color: white;
  background: var(--el-color-primary);
}

.note-aside-title,
.note-aside-modified-time {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-aside-title {
  margin-bottom: 2px;
  font-weight: bold;
}

.note-pin-icon {
  width: 14px;
  height: 14px;
  margin-right: 4px;
  vertical-align: -2px;
}

.note-aside-modified-time {
  font-size: var(--el-font-size-extra-small);
  opacity: 0.75;
}

.note-list-empty {
  margin: 16px 8px;
  color: var(--el-text-color-secondary);
  text-align: center;
}

.note-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.note-empty-state {
  display: grid;
  flex: 1;
  gap: 16px;
  place-content: center;
  justify-items: center;
  color: var(--el-text-color-secondary);
}

.note-actions-container {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  min-height: 36px;
  margin-bottom: 10px;
}

.note-title-wrap {
  flex: 1;
  min-width: 0;
}

.note-title {
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

.note-actions {
  flex-shrink: 0;
}

.note-content-container {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  border-radius: 10px;
}

.note-content-container .el-textarea,
.note-content-container .el-textarea__inner {
  height: 100%;
}

.note-content-container .el-textarea__inner {
  background: #fefcf7;
  border-radius: 10px;
}

.note-context-menu {
  position: fixed;
  z-index: 3000;
  display: grid;
  min-width: 130px;
  padding: 4px;
  background: var(--el-bg-color-overlay);
  border-radius: 10px;
  box-shadow: var(--el-box-shadow);
}

.note-context-menu button {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  color: var(--el-text-color-primary);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 7px;
}

.note-context-menu button:hover {
  background: var(--el-fill-color-light);
}

.note-context-menu .is-danger {
  color: var(--el-color-danger);
}

.note-export-host {
  position: fixed;
  top: 0;
  left: -100000px;
  width: max-content;
  pointer-events: none;
}

.is-compact .note-layout {
  position: relative;
  padding: 0 12px 12px;
}

.is-compact .note-aside-wrapper {
  position: absolute;
  inset: 0 12px 12px;
  z-index: 2;
  overflow: auto;
}

.is-compact .note-aside {
  width: 100%;
  margin: 0;
}

@media (width <= 599px) {
  .note-actions-container {
    align-items: stretch;
  }

  .note-title-wrap {
    width: 100%;
  }

  .note-title-input {
    max-width: none;
  }

  .note-actions {
    align-self: flex-end;
  }
}
</style>
