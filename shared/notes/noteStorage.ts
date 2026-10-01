import { storage } from '#imports'

import { withSyncWriteLock } from '../storage/syncWrite.ts'

export interface NoteRecord {
  id: string
  title?: string
  markdown: string
  pinned?: boolean
  createdAt: string
  updatedAt: string
}

export interface NoteSnapshot {
  notes: NoteRecord[]
}

const defaultNoteSnapshot: NoteSnapshot = { notes: [] }

// 为设置、快捷方式等同步数据预留空间；按 UTF-8 JSON 字节而非字符数计量。
export const MAX_NOTE_BYTES = 1024 * 1024
export const MAX_NOTES_BYTES = 8 * 1024 * 1024

export class NoteSaveError extends Error {
  readonly code: 'conflict' | 'deleted' | 'tooLarge' | 'snapshotTooLarge'

  constructor(code: NoteSaveError['code']) {
    super(code)
    this.code = code
  }
}

type ValidateNoteSnapshot = (snapshot: NoteSnapshot) => Promise<void>

function withNotesWriteLock<T>(operation: () => Promise<T>, validate?: ValidateNoteSnapshot) {
  return withNotesLock(() => (validate ? withSyncWriteLock(operation) : operation()))
}

function assertNoteSize(snapshot: NoteSnapshot, note: NoteRecord) {
  const encoder = new TextEncoder()
  if (
    encoder.encode(JSON.stringify(note)).byteLength > MAX_NOTE_BYTES ||
    encoder.encode(JSON.stringify(snapshot)).byteLength > MAX_NOTES_BYTES
  )
    throw new NoteSaveError('tooLarge')
}

export const noteStorage = storage.defineItem<NoteSnapshot>('local:notes', {
  fallback: structuredClone(defaultNoteSnapshot),
})

/** 所有便签写入共用跨页面/后台锁；同步调用方需从本机校验前持锁到落盘完成。 */
export function withNotesLock<T>(operation: () => Promise<T>): Promise<T> {
  return navigator.locks.request('lemon-notes', operation)
}

export function getNoteTitle(note: Pick<NoteRecord, 'title' | 'markdown'>): string {
  const explicit = note.title?.trim()
  if (explicit) return explicit
  const firstLine = note.markdown.split(/\r?\n/, 1)[0]?.trim() ?? ''
  if (!firstLine) return ''
  const text = firstLine
    .replace(/^#{1,6}\s+/, '')
    .replace(/[`*_~[\]()]/g, '')
    .trim()
  return /^#{1,6}\s+/.test(firstLine) ? text : text.slice(0, 10)
}

export async function listNotes(): Promise<NoteRecord[]> {
  const value = await noteStorage.getValue()
  return value.notes.slice().sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
    return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)
  })
}

export async function saveNote(
  note: NoteRecord,
  before?: NoteRecord,
  validate?: ValidateNoteSnapshot,
): Promise<NoteRecord> {
  let next: NoteRecord = {
    ...note,
    title: note.title?.trim() || undefined,
    updatedAt: new Date().toISOString(),
  }
  return withNotesWriteLock(async () => {
    const snapshot = { notes: [...(await noteStorage.getValue()).notes] }
    const index = snapshot.notes.findIndex((item) => item.id === next.id)
    if (before && index < 0) throw new NoteSaveError('deleted')
    if (index >= 0) {
      if (!before || before.id !== note.id) throw new NoteSaveError('conflict')
      const current = snapshot.notes[index]!
      next = { ...current, updatedAt: next.updatedAt }
      // 只重放实际编辑；同一字段发生分歧时保留两端数据，交由用户处理。
      for (const key of ['title', 'markdown'] as const) {
        const edited = key === 'title' ? note.title?.trim() || undefined : note.markdown
        if (edited === before[key]) continue
        if (current[key] !== before[key] && current[key] !== edited)
          throw new NoteSaveError('conflict')
        Object.assign(next, { [key]: edited })
      }
    }
    if (index >= 0) snapshot.notes.splice(index, 1, next)
    else snapshot.notes.push(next)
    assertNoteSize(snapshot, next)
    await validate?.(snapshot)
    await noteStorage.setValue(snapshot)
    return next
  }, validate)
}

export async function deleteNote(id: string): Promise<void> {
  await withNotesLock(async () => {
    const snapshot = { notes: [...(await noteStorage.getValue()).notes] }
    snapshot.notes = snapshot.notes.filter((note) => note.id !== id)
    await noteStorage.setValue(snapshot)
  })
}

export async function setNotePinned(
  id: string,
  pinned: boolean,
  validate?: ValidateNoteSnapshot,
): Promise<NoteRecord | null> {
  return updateNote(id, { pinned: pinned || undefined }, validate)
}

export async function setNoteTitle(
  id: string,
  title: string | undefined,
): Promise<NoteRecord | null> {
  return updateNote(id, { title: title?.trim() || undefined, updatedAt: new Date().toISOString() })
}

async function updateNote(
  id: string,
  patch: Partial<NoteRecord>,
  validate?: ValidateNoteSnapshot,
): Promise<NoteRecord | null> {
  return withNotesWriteLock(async () => {
    const snapshot = { notes: [...(await noteStorage.getValue()).notes] }
    const index = snapshot.notes.findIndex((note) => note.id === id)
    if (index < 0) return null
    const next = { ...snapshot.notes[index]!, ...patch }
    snapshot.notes.splice(index, 1, next)
    assertNoteSize(snapshot, next)
    await validate?.(snapshot)
    await noteStorage.setValue(snapshot)
    return next
  }, validate)
}
