import assert from 'node:assert/strict'
import { test } from 'node:test'

import { defaultSettings } from '../shared/settings/default.ts'
import { projectSettings } from '../shared/settings/projection.ts'
import { hashCanonicalJson } from '../shared/webdavSync/canonical.ts'
import { createSyncConflictDetails } from '../shared/webdavSync/conflictDetails.ts'
import { resolveSyncConflicts } from '../shared/webdavSync/conflicts.ts'
import { createTombstone } from '../shared/webdavSync/lifecycle.ts'
import { mergeSyncSnapshots } from '../shared/webdavSync/merge.ts'
import { decodeWorkingRecord } from '../shared/webdavSync/recovery.ts'
import { nextSyncRetry } from '../shared/webdavSync/retry.ts'
import {
  pickSyncSettings,
  normalizeRemoteSyncSettings,
  applySyncSettings,
  syncSettingsChanged,
  syncWallpaperSettingsChanged,
} from '../shared/webdavSync/settingsWhitelist.ts'
import { decodeSyncSnapshot } from '../shared/webdavSync/snapshotCodec.ts'
import { decideInitialization, decideSynchronization } from '../shared/webdavSync/syncDecision.ts'
import { validateSyncSnapshot } from '../shared/webdavSync/validation.ts'
import { compareReleaseVersions, SyncVersionError } from '../shared/webdavSync/version.ts'

const scope = {
  settings: true,
  quickLinks: true,
  notes: true,
  customSearchEngines: true,
  uiPreferences: true,
  blockedTopSites: false,
  wallpapers: false,
  onlineWallpaperUrl: false,
  userIcons: false,
}
const source = { formatVersion: 1, settingsSchemaVersion: 12, pluginVersion: '3.5.0' }

test('像素布局在本机规范化、远端校验和设置应用后保留', () => {
  const local = structuredClone(defaultSettings)
  local.layout.mainPosition = { type: 'px', value: 120 }
  const incoming = { layout: { mainPosition: { type: 'px', value: 200 } } }
  assert.deepEqual(
    projectSettings(local, { defaults: true, strict: false }).layout.mainPosition,
    local.layout.mainPosition,
  )
  assert.equal(validateSyncSnapshot({ scope, settings: incoming }).ok, true)
  assert.deepEqual(
    applySyncSettings(local, incoming).layout.mainPosition,
    incoming.layout.mainPosition,
  )
})

test('版本按数字比较；新发布阻塞发生在未知数据被清理之前', () => {
  assert.equal(compareReleaseVersions('3.10.0', '3.9.0'), 1)
  assert.equal(compareReleaseVersions('3.5', '3.5.0'), 0)
  assert.throws(() => compareReleaseVersions('', '3.5.0'), TypeError)
  const snapshot = {
    scope,
    futureCategory: { payload: 'retain raw history' },
    settings: { clock: { size: 77 } },
  }
  assert.throws(
    () => decodeSyncSnapshot(snapshot, { ...source, pluginVersion: '3.6.0' }, '3.5.0'),
    SyncVersionError,
  )
  assert.equal(snapshot.futureCategory.payload, 'retain raw history')
  assert.equal(
    decodeSyncSnapshot(snapshot, { ...source, pluginVersion: '3.6.0' }, '3.6.0').futureCategory,
    undefined,
  )
})

test('移除字段从本机和同步设置清理；旧发布缺少新增值时沿用基线', () => {
  const incoming = {
    clock: { size: 77, retired: 'discard' },
    retiredCategory: { payload: 'discard' },
  }
  assert.deepEqual(pickSyncSettings(incoming), { clock: { size: 77 } })
  const local = { ...structuredClone(defaultSettings), retired: 'discard' }
  local.background.bing.id = 'local-only'
  local.background.bing.updateDate = 123
  const applied = applySyncSettings(local, incoming)
  assert.equal(applied.retired, undefined)
  assert.equal(applied.clock.size, 77)
  assert.equal(applied.background.bing.id, 'local-only')
  assert.equal(applied.background.bing.updateDate, 123)
  assert.equal(
    normalizeRemoteSyncSettings({ clock: { size: 77, dateSize: 22 } }, { clock: { size: 66 } })
      .clock.dateSize,
    22,
  )
})

test('错误已知类型和枚举拒绝；空同步范围有效', () => {
  for (const settings of [
    { clock: { size: 'bad' } },
    { clock: [] },
    { search: { builtInEngineOrder: [7] } },
    { background: { bgType: 'future' } },
  ]) {
    assert.equal(validateSyncSnapshot({ scope, settings }).ok, false)
  }
  assert.equal(
    validateSyncSnapshot({ scope: Object.fromEntries(Object.keys(scope).map((k) => [k, false])) })
      .ok,
    true,
  )
})

test('设置10到12的部分投影调用原迁移：快捷链接改名，壁纸本机字段消失', () => {
  const result = decodeSyncSnapshot(
    {
      scope,
      settings: {
        shortcut: { iconSize: 65 },
        perf: { shortcut: { blur: false } },
        background: { local: { id: 'private' } },
      },
    },
    { ...source, settingsSchemaVersion: 10 },
    '3.5.0',
  )
  assert.equal(result.settings.quickLinks.iconSize, 65)
  assert.equal(result.settings.perf.quickLinks.blur, false)
  assert.equal(result.settings.shortcut, undefined)
  assert.equal(result.settings.background.local, undefined)
})

test('同步与本机采用同一数值、颜色和搜索引擎顺序规范，避免应用后反复失败', () => {
  const result = decodeSyncSnapshot(
    {
      scope,
      settings: {
        clock: { dateSize: 200.5 },
        background: { solid: { light: 'invalid' } },
        search: { builtInEngineOrder: ['bing'] },
      },
    },
    source,
    '3.5.0',
  )
  assert.equal(result.settings.clock.dateSize, 50)
  assert.equal(result.settings.background.solid.light, '')
  assert.equal(
    result.settings.search.builtInEngineOrder.length,
    defaultSettings.search.builtInEngineOrder.length,
  )
  assert.equal(result.settings.search.builtInEngineOrder[0], 'bing')
  const mutuallyExclusive = normalizeRemoteSyncSettings(
    { bookmark: { rightClickToOpen: true } },
    { dock: { launchpad: { rightClickToOpen: true } } },
  )
  assert.equal(mutuallyExclusive.dock.launchpad.rightClickToOpen, false)
})

test('未知类别、实体字段和无引用图标不会进入工作副本；历史内容及哈希原样保留', async () => {
  const raw = {
    scope: { ...scope, obsolete: true },
    settings: { clock: { size: 77, obsolete: 'discard' } },
    future: { huge: 'discard' },
    quickLinks: {
      items: [{ id: 'a', url: 'https://example.com', title: 'A', obsolete: 'discard' }],
      rootOrder: ['a'],
      groups: [],
      groupOrder: [],
    },
    inlineImages: { ['a'.repeat(64)]: 'unused' },
  }
  const hash = await hashCanonicalJson(raw)
  const result = decodeSyncSnapshot(raw, source, '3.5.0')
  assert.equal(result.future, undefined)
  assert.equal(result.scope.obsolete, undefined)
  assert.equal(result.quickLinks.items[0].obsolete, undefined)
  assert.equal(result.inlineImages, undefined)
  assert.equal(await hashCanonicalJson(raw), hash)
  assert.deepEqual(decodeSyncSnapshot(result, source, '3.5.0'), result)
})

test('历史祖先裁剪后，有效基线仍可识别远端删除；本机修改与删除保留冲突', () => {
  const base = {
    scope,
    quickLinks: {
      items: [{ id: 'a', title: 'A', url: 'https://example.com' }],
      rootOrder: ['a'],
      groups: [],
      groupOrder: [],
    },
  }
  const remote = { scope, quickLinks: { items: [], rootOrder: [], groups: [], groupOrder: [] } }
  const revisions = [
    {
      revisionId: 'head',
      parentRevisionIds: ['pruned'],
      snapshot: remote,
      tombstones: [],
      assets: [],
    },
  ]
  assert.equal(
    decideSynchronization({
      baseRevisionId: 'old',
      baseline: base,
      local: structuredClone(base),
      revisions,
    }).action,
    'apply-remote',
  )
  const edited = structuredClone(base)
  edited.quickLinks.items[0].title = 'Edited'
  assert.equal(
    decideSynchronization({ baseRevisionId: 'old', baseline: base, local: edited, revisions })
      .action,
    'conflict',
  )
})

test('恢复记录转换清除未知字段，保留操作身份和原始哈希', () => {
  const value = {
    obsoleteRecord: { huge: 'discard' },
    operationId: 'operation',
    snapshotHash: 'raw-hash',
    expectedLocal: { scope, settings: { clock: { size: 77, retired: 'discard' } } },
  }
  const result = decodeWorkingRecord({ source, value }, '3.5.0')
  assert.equal(result.snapshotHash, 'raw-hash')
  assert.equal(result.operationId, 'operation')
  assert.equal(result.expectedLocal.settings.clock.retired, undefined)
  assert.equal(result.obsoleteRecord, undefined)
})

test('重试有界退避；用户暂停和空范围不会安排重试', () => {
  const state = { enabled: true, scope, lastError: { category: 'network' } }
  assert.deepEqual(nextSyncRetry(state, 100), { attempt: 1, nextAttemptAt: 30100 })
  assert.equal(nextSyncRetry({ ...state, enabled: false }, 100), undefined)
  assert.equal(
    nextSyncRetry(
      { ...state, scope: Object.fromEntries(Object.keys(scope).map((k) => [k, false])) },
      100,
    ),
    undefined,
  )
  assert.deepEqual(nextSyncRetry({ ...state, retry: { attempt: 6 } }, 100), {
    attempt: 7,
    nextAttemptAt: undefined,
  })
})

test('设置首次创建和删除的存储事件可以识别同步变化', () => {
  assert.equal(syncSettingsChanged(undefined, defaultSettings), true)
  assert.equal(syncSettingsChanged(defaultSettings, undefined), true)
  assert.equal(syncWallpaperSettingsChanged(undefined, defaultSettings), true)
  assert.equal(syncWallpaperSettingsChanged(defaultSettings, undefined), true)
})

test('首次连接独立实体自动合并；删除记录阻止无基线设备自动复活已删实体', () => {
  const collection = (items) => ({
    items,
    rootOrder: items.map((i) => i.id),
    groups: [],
    groupOrder: [],
  })
  const base = { scope }
  const local = {
    scope,
    settings: { clock: { size: 77 } },
    quickLinks: collection([
      { id: 'deleted', title: 'Old', url: 'https://old.example' },
      { id: 'local', title: 'L', url: 'https://local.example' },
    ]),
  }
  const remote = {
    scope,
    settings: { clock: { size: 77 } },
    quickLinks: collection([{ id: 'remote', title: 'R', url: 'https://remote.example' }]),
  }
  assert.equal(mergeSyncSnapshots(base, local, remote).conflicts.length, 0)
  const tombstones = [createTombstone('quick-link', 'deleted', 'head')]
  const decision = decideInitialization({
    base,
    local,
    revisions: [
      { revisionId: 'head', parentRevisionIds: [], snapshot: remote, tombstones, assets: [] },
    ],
  })
  assert.equal(decision.action, 'conflict')
  assert.equal(decision.stage, 'local-remote')
  assert.equal(decision.conflicts.length, 1)
  assert.equal(decision.conflicts[0].kind, 'delete-vs-modify')
  const conflictId = decision.conflicts[0].id
  assert.equal(createSyncConflictDetails(decision).conflicts[0].id, conflictId)
  const resolved = resolveSyncConflicts({
    base,
    local,
    remote,
    tombstones,
    resolutions: [{ conflictId, choice: 'remote' }],
  })
  assert.deepEqual(resolved.quickLinks.items.map((i) => i.id).sort(), ['local', 'remote'])
  assert.equal(
    resolveSyncConflicts({
      base,
      local,
      remote,
      tombstones,
      resolutions: [{ conflictId, choice: 'local' }],
    }).quickLinks.items.some((i) => i.id === 'deleted'),
    true,
  )
  const copied = resolveSyncConflicts({
    base,
    local,
    remote,
    tombstones,
    resolutions: [{ conflictId, choice: 'both', duplicateId: 'restored' }],
  })
  assert.equal(
    copied.quickLinks.items.some((i) => i.id === 'deleted'),
    false,
  )
  assert.equal(
    copied.quickLinks.items.some((i) => i.id === 'restored'),
    true,
  )
})

test('含点号的实体ID在字段冲突中不会被当成属性路径拆开', () => {
  const base = {
    scope,
    quickLinks: {
      items: [{ id: 'link.id', title: 'Base', url: 'https://example.com' }],
      rootOrder: ['link.id'],
      groups: [],
      groupOrder: [],
    },
  }
  const local = structuredClone(base),
    remote = structuredClone(base)
  local.quickLinks.items[0].title = 'Local'
  remote.quickLinks.items[0].title = 'Remote'
  const conflict = mergeSyncSnapshots(base, local, remote).conflicts[0]
  const resolved = resolveSyncConflicts({
    base,
    local,
    remote,
    resolutions: [{ conflictId: conflict.id, choice: 'remote' }],
  })
  assert.equal(resolved.quickLinks.items[0].title, 'Remote')
})
