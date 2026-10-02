import { storage } from '#imports'

import { withSyncWriteLock } from '../storage/syncWrite.ts'

import {
  assertNoteSnapshotSize,
  NoteSaveError,
  projectNote,
  projectNotes,
  type NoteRecord,
  type NoteSnapshot,
} from './model.ts'

export * from './model.ts'

const defaultNoteSnapshot: NoteSnapshot = { notes: [] }

type ValidateNoteSnapshot = (snapshot: NoteSnapshot) => Promise<void>

function withNotesWriteLock<T>(operation: () => Promise<T>, validate?: ValidateNoteSnapshot) {
  return withNotesLock(() => (validate ? withSyncWriteLock(operation) : operation()))
}

export const noteStorage = storage.defineItem<NoteSnapshot>('local:notes', {
  fallback: structuredClone(defaultNoteSnapshot),
})

/** 所有便签写入共用跨页面/后台锁；同步调用方需从本机校验前持锁到落盘完成。 */
export function withNotesLock<T>(operation: () => Promise<T>): Promise<T> {
  return navigator.locks.request('lemon-notes', operation)
}

/** 在便签锁内清理存储，避免只清理同步副本造成反复发布。 */
export async function getNoteSnapshot(lockHeld = false): Promise<NoteSnapshot> {
  const read = async () => {
    const stored = await noteStorage.getValue()
    const current = projectNotes(stored)
    if (JSON.stringify(stored) !== JSON.stringify(current)) await noteStorage.setValue(current)
    return current
  }
  return lockHeld ? read() : withNotesLock(read)
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
  const value = await getNoteSnapshot()
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
    ...projectNote(note),
    title: note.title?.trim() || undefined,
    updatedAt: new Date().toISOString(),
  }
  return withNotesWriteLock(async () => {
    const snapshot = projectNotes(await noteStorage.getValue())
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
    assertNoteSnapshotSize(snapshot)
    await validate?.(snapshot)
    await noteStorage.setValue(snapshot)
    return next
  }, validate)
}

export async function deleteNote(id: string): Promise<void> {
  await withNotesLock(async () => {
    const snapshot = projectNotes(await noteStorage.getValue())
    snapshot.notes = snapshot.notes.filter((note) => note.id !== id)
    await noteStorage.setValue(snapshot)
  })
}

export async function setNotePinned(
  id: string,
  pinned: boolean,
  validate?: ValidateNoteSnapshot,
): Promise<NoteRecord | null> {
  return withNotesWriteLock(async () => {
    const snapshot = projectNotes(await noteStorage.getValue())
    const index = snapshot.notes.findIndex((note) => note.id === id)
    if (index < 0) return null
    const next = { ...snapshot.notes[index]!, pinned: pinned || undefined }
    snapshot.notes.splice(index, 1, next)
    assertNoteSnapshotSize(snapshot)
    await validate?.(snapshot)
    await noteStorage.setValue(snapshot)
    return next
  }, validate)
}
