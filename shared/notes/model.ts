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

/** 当前便签唯一的字段投影，供本机保存、同步和备份共用。 */
export function projectNote(note: NoteRecord): NoteRecord {
  return {
    id: note.id,
    ...(note.title !== undefined ? { title: note.title } : {}),
    markdown: note.markdown,
    ...(note.pinned !== undefined ? { pinned: note.pinned } : {}),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  }
}

export function projectNotes(snapshot: NoteSnapshot): NoteSnapshot {
  return { notes: snapshot.notes.map(projectNote) }
}

export function assertNoteSnapshotSize(snapshot: NoteSnapshot): void {
  const encoder = new TextEncoder()
  if (
    snapshot.notes.some(
      (note) => encoder.encode(JSON.stringify(note)).byteLength > MAX_NOTE_BYTES,
    ) ||
    encoder.encode(JSON.stringify(snapshot)).byteLength > MAX_NOTES_BYTES
  )
    throw new NoteSaveError('tooLarge')
}
