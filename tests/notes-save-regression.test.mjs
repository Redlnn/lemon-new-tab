import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

import ts from 'typescript'

let stored = { notes: [] }
globalThis.__noteSaveStorage = {
  getValue: async () => structuredClone(stored),
  setValue: async (value) => {
    stored = structuredClone(value)
  },
}
const source = (await readFile('shared/notes/noteStorage.ts', 'utf8'))
  .replace(
    "import { storage } from '#imports'",
    'const storage = { defineItem: () => globalThis.__noteSaveStorage }',
  )
  .replace(/'\.\/model\.ts'/g, JSON.stringify(pathToFileURL(resolve('shared/notes/model.ts')).href))
  .replace(
    "'../storage/syncWrite.ts'",
    JSON.stringify(pathToFileURL(resolve('shared/storage/syncWrite.ts')).href),
  )
const js = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
}).outputText
const { saveNote, deleteNote, NoteSaveError } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
)
const note = () => ({
  id: crypto.randomUUID(),
  title: 'base',
  markdown: 'base',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

test('旧正文草稿保存保留另一页面的新标题', async () => {
  const base = await saveNote(note())
  await saveNote({ ...base, title: 'remote title' }, base)
  const saved = await saveNote({ ...base, markdown: 'local body' }, base)
  assert.equal(saved.title, 'remote title')
  assert.equal(saved.markdown, 'local body')
})

test('同一字段的并发修改拒绝覆盖，删除后保存不能复活', async () => {
  const base = await saveNote(note())
  await saveNote({ ...base, markdown: 'remote body' }, base)
  await assert.rejects(
    saveNote({ ...base, markdown: 'local body' }, base),
    (error) => error.code === 'conflict',
  )
  await deleteNote(base.id)
  await assert.rejects(
    saveNote({ ...base, markdown: 'local body' }, base),
    (error) => error.code === 'deleted',
  )
  assert.equal(
    stored.notes.some((item) => item.id === base.id),
    false,
  )
})

test('超大正文及多字节正文在写入前拒绝，原数据保留', async () => {
  const base = await saveNote(note())
  const before = structuredClone(stored)
  for (const markdown of ['a'.repeat(10 * 1024 * 1024), '字'.repeat(400000)]) {
    await assert.rejects(
      saveNote({ ...base, markdown }, base),
      (error) => error.code === 'tooLarge',
    )
    assert.deepEqual(stored, before)
  }
})

test('单条均合规时，便签总量仍不能超过限额', async () => {
  stored = { notes: [] }
  for (let i = 0; i < 8; i++)
    await saveNote({ ...note(), markdown: 'a'.repeat(1024 * 1024 - 1024) })
  const before = structuredClone(stored)
  await assert.rejects(
    saveNote({ ...note(), markdown: 'a'.repeat(10000) }),
    (error) => error.code === 'tooLarge',
  )
  assert.deepEqual(stored, before)
})

test('完整快照校验失败时不落盘，校验和写入共用两把锁，重试可恢复', async () => {
  stored = { notes: [] }
  const base = await saveNote(note())
  const before = structuredClone(stored)
  let fail = true
  const validate = async (snapshot) => {
    const locks = (await navigator.locks.query()).held.map((lock) => lock.name)
    assert.ok(locks.includes('lemon-notes'))
    assert.ok(locks.includes('lemon-sync-data'))
    assert.equal(snapshot.notes[0].markdown, 'edited')
    if (fail) throw new NoteSaveError('snapshotTooLarge')
  }
  await assert.rejects(
    saveNote({ ...base, markdown: 'edited' }, base, validate),
    (error) => error.code === 'snapshotTooLarge',
  )
  assert.deepEqual(stored, before)
  fail = false
  await saveNote({ ...base, markdown: 'edited' }, base, validate)
  assert.equal(stored.notes[0].markdown, 'edited')
})

test('首次保存被拒绝时不能污染存储返回的默认快照', async () => {
  const fallback = { notes: [] }
  const getValue = globalThis.__noteSaveStorage.getValue
  globalThis.__noteSaveStorage.getValue = async () => fallback
  try {
    await assert.rejects(
      saveNote({ ...note(), markdown: 'a'.repeat(2 * 1024 * 1024) }),
      (error) => error.code === 'tooLarge',
    )
    assert.deepEqual(fallback, { notes: [] })
  } finally {
    globalThis.__noteSaveStorage.getValue = getValue
  }
})

test('保存时清理全部便签的废弃字段，保留正文和其他便签', async () => {
  const base = note()
  const other = note()
  stored = {
    notes: [
      { ...base, obsolete: 'old' },
      { ...other, obsolete: 'old' },
    ],
    obsolete: true,
  }
  await saveNote({ ...base, markdown: 'edited', obsolete: 'old' }, base)
  assert.equal(stored.obsolete, undefined)
  assert.equal(stored.notes[0].obsolete, undefined)
  assert.deepEqual(stored.notes[1], other)
})
