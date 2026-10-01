import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import ts from 'typescript'

import { preserveExcludedScope } from '../shared/webdavSync/apply.ts'
import { hashCanonicalJson, jsonEquals } from '../shared/webdavSync/canonical.ts'
import { resolveSyncConflicts } from '../shared/webdavSync/conflicts.ts'
import { compareSyncSnapshots } from '../shared/webdavSync/differences.ts'
import { deriveSnapshotTombstones } from '../shared/webdavSync/lifecycle.ts'
import { mergeSyncSnapshots } from '../shared/webdavSync/merge.ts'
import { findRevisionHeads } from '../shared/webdavSync/syncDecision.ts'
import { WebDavError } from '../shared/webdavSync/webdav.ts'

// 执行实际入口函数，仅替换存储、网络和发布边界，避免复制一份待测实现。
async function loadFunction(file, name, dependencies) {
  const source = await readFile(new URL(`../shared/webdavSync/${file}.ts`, import.meta.url), 'utf8')
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const declaration = parsed.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
  )
  assert.ok(declaration, `Missing function: ${name}`)
  const body = ts.transpileModule(declaration.getText(parsed).replace(/^export\s+/, ''), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText
  return Function(...Object.keys(dependencies), `${body}; return ${name}`)(
    ...Object.values(dependencies),
  )
}

const scope = {
  settings: true,
  quickLinks: false,
  notes: false,
  customSearchEngines: false,
  uiPreferences: false,
  blockedTopSites: false,
  wallpapers: false,
  onlineWallpaperUrl: false,
  userIcons: false,
}
const snapshot = (size, markdown) => ({
  scope,
  settings: { clock: { size } },
  notes: {
    items: [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        markdown,
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
    ],
  },
})

function fixture() {
  const baseline = snapshot(60, 'old')
  const local = snapshot(70, 'old')
  const actualRemote = snapshot(80, 'remote-new')
  const head = {
    revisionId: 'head',
    parentRevisionIds: ['base'],
    snapshot: actualRemote,
    tombstones: [],
    assets: [],
  }
  const state = { configured: true, scope, paused: false, generationId: 'g', vaultId: 'v' }
  const published = []
  const dependencies = {
    getOrCreateSyncState: async () => state,
    getBaseline: async () => baseline,
    captureBrowserSyncSnapshot: async () => local,
    preserveExcludedScope,
    hashCanonicalJson,
    jsonEquals,
    WebDavError,
    findRevisionHeads,
    resolveSyncConflicts,
    compareSyncSnapshots,
    deriveSnapshotTombstones,
    mergeTombstones: (left, right) => [...left, ...right],
    publishAndFinalize: async (input) => published.push(input),
  }
  return { baseline, local, actualRemote, head, state, published, dependencies }
}

for (const choice of ['local', 'remote']) {
  test(`解决${choice}设置冲突时保留远端最新的停用便签`, async () => {
    const f = fixture()
    f.state.pauseReason = 'conflict'
    const remote = preserveExcludedScope(f.actualRemote, f.baseline, scope)
    const conflicts = mergeSyncSnapshots(f.baseline, f.local, remote).conflicts
    assert.deepEqual(conflicts.map((conflict) => conflict.path), ['settings.clock.size'])
    const stored = {
      stage: 'local-remote',
      base: f.baseline,
      local: f.local,
      remote,
      remoteRevisionIds: ['head'],
      tombstones: [],
    }
    const resolve = await loadFunction('browserEngine', 'resolveBrowserSyncConflict', {
      ...f.dependencies,
      webDavSyncConfigStorage: { getValue: async () => ({ directory: 'vault' }) },
      getWebDavPassword: async () => 'test-password',
      getStoredConflict: async () => stored,
      WebDavVaultRepository: class {
        async inspect() {
          return { metadata: { encrypted: false } }
        }
      },
      createClient: () => null,
      requireConfiguredVaultInspection: (value) => value,
      readRevisions: async () => [f.head],
      patchSyncState: async (patch) => Object.assign(f.state, patch),
    })
    await resolve(conflicts.map((conflict) => ({ conflictId: conflict.id, choice })))
    assert.equal(f.published.length, 1)
    assert.deepEqual(f.published[0].snapshot.notes, f.actualRemote.notes)
    assert.equal(f.published[0].snapshot.settings.clock.size, choice === 'local' ? 70 : 80)
  })
}

test('历史预览只展示启用类别，恢复保留停用类别的最新远端数据', async () => {
  const f = fixture()
  const history = { ...f.head, revisionId: 'history', snapshot: snapshot(50, 'historical') }
  f.head.parentRevisionIds = ['history']
  const prepareHistoricalSnapshot = await loadFunction(
    'browserManagement',
    'prepareHistoricalSnapshot',
    {},
  )
  const dependencies = {
    ...f.dependencies,
    prepareHistoricalSnapshot,
    openConfiguredVault: async () => ({ state: f.state, revisions: [history, f.head] }),
  }
  const preview = await loadFunction('browserManagement', 'previewBrowserSyncHistory', dependencies)
  const restore = await loadFunction('browserManagement', 'restoreBrowserSyncHistory', dependencies)
  const review = await preview('history')
  assert.deepEqual(review.differences.map((difference) => difference.path), ['settings.clock.size'])
  await restore('history', review)
  assert.equal(f.published.length, 1)
  assert.deepEqual(f.published[0].snapshot.notes, f.actualRemote.notes)
  assert.equal(f.published[0].snapshot.settings.clock.size, 50)
})
