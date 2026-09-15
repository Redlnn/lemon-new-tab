import { storage } from '#imports'

export interface MemoRecord {
  id: string
  title?: string
  markdown: string
  createdAt: string
  updatedAt: string
}

export interface MemoSnapshot {
  memos: MemoRecord[]
}

const defaultMemoSnapshot: MemoSnapshot = { memos: [] }

export const memoStorage = storage.defineItem<MemoSnapshot>('local:memos', {
  fallback: structuredClone(defaultMemoSnapshot),
})

export function getMemoTitle(memo: Pick<MemoRecord, 'title' | 'markdown'>): string {
  const explicit = memo.title?.trim()
  if (explicit) return explicit
  const firstLine = memo.markdown.split(/\r?\n/, 1)[0]?.trim() ?? ''
  if (!firstLine) return ''
  const text = firstLine
    .replace(/^#{1,6}\s+/, '')
    .replace(/[`*_~[\]()]/g, '')
    .trim()
  return /^#{1,6}\s+/.test(firstLine) ? text : text.slice(0, 10)
}

export async function listMemos(): Promise<MemoRecord[]> {
  const value = await memoStorage.getValue()
  return value.memos.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function saveMemo(memo: MemoRecord): Promise<MemoRecord> {
  const snapshot = await memoStorage.getValue()
  const next = {
    ...memo,
    title: memo.title?.trim() || undefined,
    updatedAt: new Date().toISOString(),
  }
  const index = snapshot.memos.findIndex((item) => item.id === memo.id)
  if (index >= 0) snapshot.memos.splice(index, 1, next)
  else snapshot.memos.push(next)
  await memoStorage.setValue(snapshot)
  return next
}

export async function deleteMemo(id: string): Promise<void> {
  const snapshot = await memoStorage.getValue()
  snapshot.memos = snapshot.memos.filter((memo) => memo.id !== id)
  await memoStorage.setValue(snapshot)
}
