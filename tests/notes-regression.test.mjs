import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

import ts from 'typescript'

import { hashCanonicalJson } from '../shared/webdavSync/canonical.ts'
import { resolveSyncConflicts } from '../shared/webdavSync/conflicts.ts'
import { mergeSyncSnapshots } from '../shared/webdavSync/merge.ts'
import {
  isSyncScope,
  validateSyncRevision,
  validateCommitRecord,
} from '../shared/webdavSync/validation.ts'

const scope = {
  settings: true,
  quickLinks: true,
  customSearchEngines: true,
  uiPreferences: true,
  blockedTopSites: false,
  wallpapers: false,
  onlineWallpaperUrl: false,
  userIcons: false,
}
const note = () => ({
  id: crypto.randomUUID(),
  markdown: 'base',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
})
const snapshot = (items) => ({ scope: { ...scope, notes: true }, notes: { items } })

test('旧 revision 和 commit 在校验后保留原始 scope 和快照哈希', async () => {
  const original = { scope }
  const revision = {
    formatVersion: 1,
    vaultId: crypto.randomUUID(),
    generationId: crypto.randomUUID(),
    revisionId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    settingsSchemaVersion: 1,
    pluginVersion: '3.4.0',
    parentRevisionIds: [],
    device: { id: crypto.randomUUID(), name: 'test' },
    createdAt: note().createdAt,
    reason: 'initial',
    snapshot: original,
    tombstones: [],
    assets: [],
    snapshotHash: await hashCanonicalJson(original),
  }
  const validated = validateSyncRevision(revision)
  assert.equal(validated.ok, true)
  assert.equal(await hashCanonicalJson(validated.value.snapshot), revision.snapshotHash)
  const commit = validateCommitRecord({
    ...revision,
    payloadPath: 'revisions/test.json',
    payloadHash: 'a'.repeat(64),
    payloadSize: 100,
    encrypted: false,
    complete: true,
    scope,
  })
  assert.equal(commit.ok, true)
  assert.deepEqual(commit.value.scope, scope)
})

test('仅启用便签及全部关闭同步范围都有效', () => {
  const disabled = Object.fromEntries(Object.keys(scope).map((key) => [key, false]))
  assert.equal(isSyncScope({ ...disabled, notes: true }), true)
  assert.equal(isSyncScope({ ...disabled, notes: false }), true)
  assert.equal(isSyncScope(scope), true)
})

for (const deletedSide of ['local', 'remote']) {
  test(`保留 ${deletedSide} 删除与另一端修改的冲突，并正确应用用户选择`, () => {
    const original = note()
    const base = snapshot([original])
    const edited = snapshot([{ ...original, markdown: 'edited' }])
    const local = deletedSide === 'local' ? snapshot([]) : edited
    const remote = deletedSide === 'remote' ? snapshot([]) : edited
    const merged = mergeSyncSnapshots(base, local, remote)
    assert.equal(merged.conflicts.length, 1)
    const conflict = merged.conflicts[0]
    assert.equal(conflict.kind, 'delete-vs-modify')
    for (const choice of ['local', 'remote']) {
      const resolved = resolveSyncConflicts({
        base,
        local,
        remote,
        resolutions: [{ conflictId: conflict.id, choice }],
      })
      assert.deepEqual(resolved.notes.items, (choice === 'local' ? local : remote).notes.items)
    }
  })
}

test('同一便签多个字段冲突合为一条，保留两份仍有效', () => {
  const original = note()
  const base = snapshot([original])
  const local = snapshot([{ ...original, title: 'local', markdown: 'local' }])
  const remote = snapshot([{ ...original, title: 'remote', markdown: 'remote' }])
  const merged = mergeSyncSnapshots(base, local, remote)
  assert.equal(merged.conflicts.length, 1)
  const resolved = resolveSyncConflicts({
    base,
    local,
    remote,
    resolutions: [
      {
        conflictId: merged.conflicts[0].id,
        choice: 'both',
        duplicateId: crypto.randomUUID(),
      },
    ],
  })
  assert.deepEqual(
    new Set(resolved.notes.items.map((item) => item.markdown)),
    new Set(['local', 'remote']),
  )
})

test('独立模块实例并发保存、置顶和删除不丢失其他便签', async () => {
  let stored = { notes: [] }
  // 模拟扩展存储的克隆边界；保留真实保存函数及运行时 Web Locks。
  globalThis.__noteTestStorage = {
    getValue: async () => structuredClone(stored),
    setValue: async (value) => {
      stored = structuredClone(value)
    },
  }
  const source = (
    await readFile(new URL('../shared/notes/noteStorage.ts', import.meta.url), 'utf8')
  )
    .replace(
      "import { storage } from '#imports'",
      'const storage = { defineItem: () => globalThis.__noteTestStorage }',
    )
    .replace(
      /'\.\/model\.ts'/g,
      JSON.stringify(pathToFileURL(resolve('shared/notes/model.ts')).href),
    )
    .replace(
      "'../storage/syncWrite.ts'",
      JSON.stringify(pathToFileURL(resolve('shared/storage/syncWrite.ts')).href),
    )
  const js = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText
  const url = `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
  const first = await import(`${url}#first`)
  const second = await import(`${url}#second`)
  const a = note(),
    b = note(),
    c = note()
  try {
    await Promise.all([first.saveNote(a), second.saveNote(b)])
    assert.deepEqual(new Set(stored.notes.map((item) => item.id)), new Set([a.id, b.id]))
    await Promise.all([first.setNotePinned(a.id, true), second.saveNote(c), first.deleteNote(b.id)])
    assert.deepEqual(new Set(stored.notes.map((item) => item.id)), new Set([a.id, c.id]))
    assert.equal(stored.notes.find((item) => item.id === a.id).pinned, true)
    await Promise.all([
      first.saveNote({ ...a, markdown: 'updated' }, a),
      second.saveNote({ ...a, title: 'renamed' }, a),
    ])
    const updated = stored.notes.find((item) => item.id === a.id)
    assert.equal(updated.markdown, 'updated')
    assert.equal(updated.title, 'renamed')
    assert.equal(updated.pinned, true)
  } finally {
    delete globalThis.__noteTestStorage
  }
})
