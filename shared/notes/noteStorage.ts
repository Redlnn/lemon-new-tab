import { storage } from '#imports'

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

export async function saveNote(note: NoteRecord): Promise<NoteRecord> {
  const next = {
    ...note,
    title: note.title?.trim() || undefined,
    updatedAt: new Date().toISOString(),
  }
  return withNotesLock(async () => {
    const snapshot = await noteStorage.getValue()
    const index = snapshot.notes.findIndex((item) => item.id === next.id)
    // 正文保存不能撤销另一页面刚完成的置顶操作。
    if (index >= 0) next.pinned = snapshot.notes[index]!.pinned
    if (index >= 0) snapshot.notes.splice(index, 1, next)
    else snapshot.notes.push(next)
    await noteStorage.setValue(snapshot)
    return next
  })
}

export async function deleteNote(id: string): Promise<void> {
  await withNotesLock(async () => {
    const snapshot = await noteStorage.getValue()
    snapshot.notes = snapshot.notes.filter((note) => note.id !== id)
    await noteStorage.setValue(snapshot)
  })
}

export async function setNotePinned(id: string, pinned: boolean): Promise<NoteRecord | null> {
  return updateNote(id, { pinned: pinned || undefined })
}

export async function setNoteTitle(
  id: string,
  title: string | undefined,
): Promise<NoteRecord | null> {
  return updateNote(id, { title: title?.trim() || undefined, updatedAt: new Date().toISOString() })
}

async function updateNote(id: string, patch: Partial<NoteRecord>): Promise<NoteRecord | null> {
  return withNotesLock(async () => {
    const snapshot = await noteStorage.getValue()
    const index = snapshot.notes.findIndex((note) => note.id === id)
    if (index < 0) return null
    const next = { ...snapshot.notes[index]!, ...patch }
    snapshot.notes.splice(index, 1, next)
    await noteStorage.setValue(snapshot)
    return next
  })
}
