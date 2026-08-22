import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canonicalJson,
  compareSyncSnapshots,
  captureSyncSnapshot,
  createTombstone,
  createEncryptionAad,
  createLocalBackupArchive,
  createVaultEncryption,
  decryptSyncBytes,
  deriveEncryptionKey,
  decideInitialization,
  deduplicateQuickLinkIcons,
  decideSynchronization,
  getSyncAvailability,
  inspectStaticWallpaper,
  encryptSyncBytes,
  materializeQuickLinks,
  mergeSyncSnapshots,
  mergeImportedSnapshot,
  mergeSyncSettings,
  parseJsonBackup,
  parseLocalBackupArchive,
  preserveExcludedScope,
  preserveBaselineWallpapers,
  mustReinitializeDevice,
  pruneExpiredTombstones,
  quickLinkIconHashesAreValid,
  resolveSyncConflicts,
  sanitizeSettings,
  serializeJsonBackup,
  sha256Hex,
  SyncCoordinator,
  validateCommitRecord,
  validateSyncRevision,
  unlockVaultEncryption,
} from '../../shared/webdavSync/index.ts'
import type { SyncRevisionV1, SyncSnapshotV1 } from '../../shared/webdavSync/types.ts'

function snapshot(): SyncSnapshotV1 {
  return {
    settings: {
      clock: { size: 50 },
      search: { placeholder: '' },
    },
    quickLinks: {
      items: [{ id: 'link-a', title: 'A', url: 'https://a.example/' }],
      rootOrder: ['link-a'],
      groups: [],
      groupOrder: [],
    },
    customSearchEngines: { items: [], order: [] },
    ui: { language: 'zh-CN', colorMode: 'auto' },
  }
}

function branchRevision(
  revisionId: string,
  parentRevisionIds: string[],
  value: SyncSnapshotV1,
): SyncRevisionV1 {
  return {
    formatVersion: 1,
    settingsSchemaVersion: 11,
    vaultId: '11111111-1111-4111-8111-111111111111',
    generationId: '22222222-2222-4222-8222-222222222222',
    revisionId,
    parentRevisionIds,
    operationId: crypto.randomUUID(),
    device: { id: crypto.randomUUID(), name: 'Test device' },
    createdAt: '2026-08-09T00:00:00.000Z',
    reason: 'local-change',
    snapshot: value,
    tombstones: [],
    assets: [],
    snapshotHash: 'a'.repeat(64),
  }
}

test('canonical JSON sorts object keys but preserves array order', () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, x: [3, 1] } }), '{"a":{"x":[3,1],"y":2},"z":1}')
  assert.equal(canonicalJson(JSON.parse('{"__proto__":{"polluted":true}}')), '{"__proto__":{"polluted":true}}')
  assert.equal(Reflect.has(Object.prototype, 'polluted'), false)
})

test('history comparison lists changed fields and stable entities without choosing a winner', () => {
  const current = snapshot()
  const target = structuredClone(current)
  target.settings.clock = { size: 60 }
  target.quickLinks.items[0]!.title = 'Restored A'
  target.quickLinks.items.push({ id: 'link-b', title: 'B', url: 'https://b.example/' })
  target.quickLinks.rootOrder.push('link-b')

  const result = compareSyncSnapshots(current, target)
  assert.equal(result.truncated, false)
  assert.ok(result.differences.some((item) => item.path === 'settings.clock.size'))
  assert.ok(result.differences.some((item) => item.path === 'quickLinks.items.link-a.title'))
  assert.ok(result.differences.some((item) => item.path === 'quickLinks.items.link-b'))
  assert.ok(result.differences.some((item) => item.path === 'quickLinks.rootOrder'))
})

test('settings capture removes device-only and cache fields', () => {
  const result = sanitizeSettings({
    version: 11,
    sync: { enabled: true },
    readChangeLog: true,
    pluginVersion: '3.5.0',
    background: {
      bgType: 'bing',
      local: { id: 'local', url: 'blob:local', mediaType: 'image' },
      localDark: { id: 'dark', url: 'blob:dark', mediaType: 'video' },
      bing: {
        id: 'cache',
        url: 'blob:bing',
        updateDate: 'today',
        resolution: 'uhd',
        cachedResolution: 'uhd',
      },
    },
  })

  assert.deepEqual(result, {
    background: { bgType: 'bing', bing: { resolution: 'uhd' } },
    version: 11,
  })
})

test('snapshot capture keeps stable entity IDs and selected optional data', () => {
  const result = captureSyncSnapshot({
    settings: { version: 11, sync: { enabled: false } },
    quickLinks: {
      items: [{ id: 'link-a', title: 'A', url: 'https://a.example/' }],
    },
    customSearchEngines: {
      items: [{ id: 'engine-a', name: 'A', url: 'https://a.example/?q=%s' }],
    },
    ui: { language: 'en', colorMode: 'dark' },
    scope: {
      searchHistory: true,
      blockedTopSites: true,
      wallpapers: false,
      onlineWallpaperUrl: true,
      quickLinkIcons: true,
    },
    searchHistory: [
      { id: 'history-a', text: 'lemon', createdAt: '2026-08-09T00:00:00.000Z' },
    ],
    blockedTopSites: ['https://example.com/#section', 'javascript:alert(1)'],
  })

  assert.deepEqual(result.quickLinks.rootOrder, ['link-a'])
  assert.deepEqual(result.customSearchEngines.order, ['engine-a'])
  assert.deepEqual(result.optional?.blockedTopSites?.urls, ['https://example.com/'])
  assert.deepEqual(result.optional?.searchHistory?.order, ['history-a'])
})

test('snapshot only includes explicitly user-selected Quick Link icons', () => {
  const makeSnapshot = (quickLinkIcons: boolean) =>
    captureSyncSnapshot({
      settings: { version: 11 },
      quickLinks: {
        items: [
          {
            id: 'user-icon',
            title: 'User',
            url: 'https://user.example/',
            favicon: 'data:image/png;base64,user',
            faviconSource: 'user-selected',
          },
          {
            id: 'automatic-icon',
            title: 'Automatic',
            url: 'https://automatic.example/',
            favicon: 'data:image/png;base64,automatic',
            faviconSource: 'automatic',
          },
          {
            id: 'legacy-icon',
            title: 'Legacy',
            url: 'https://legacy.example/',
            favicon: 'data:image/png;base64,unknown',
          },
        ],
      },
      customSearchEngines: { items: [] },
      ui: { language: 'zh-CN', colorMode: 'auto' },
      scope: {
        searchHistory: false,
        blockedTopSites: false,
        wallpapers: false,
        onlineWallpaperUrl: true,
        quickLinkIcons,
      },
    })

  assert.equal(makeSnapshot(true).quickLinks.items[0]?.favicon, 'data:image/png;base64,user')
  assert.equal(makeSnapshot(true).quickLinks.items[1]?.favicon, undefined)
  assert.equal(makeSnapshot(true).quickLinks.items[2]?.favicon, undefined)
  assert.equal(makeSnapshot(false).quickLinks.items[0]?.favicon, undefined)
})

test('snapshot stores duplicate user-selected Quick Link icons once by SHA-256', async () => {
  const value = snapshot()
  value.quickLinks.items.push({
    id: 'link-b',
    title: 'B',
    url: 'https://b.example/',
  })
  value.quickLinks.rootOrder.push('link-b')
  for (const item of value.quickLinks.items) item.favicon = 'data:image/png;base64,same'

  await deduplicateQuickLinkIcons(value)

  const hashes = value.quickLinks.items.map((item) => item.faviconHash)
  assert.equal(new Set(hashes).size, 1)
  assert.equal(Object.keys(value.quickLinks.icons ?? {}).length, 1)
  assert.ok(value.quickLinks.items.every((item) => item.favicon === undefined))
  assert.equal(await quickLinkIconHashesAreValid(value), true)
  value.quickLinks.icons![hashes[0]!] = 'tampered'
  assert.equal(await quickLinkIconHashesAreValid(value), false)
})

test('online wallpaper URL follows its advanced scope without removing other preferences', () => {
  const settings = {
    background: {
      online: { url: 'https://images.example/api?token=secret', cache: { enabled: true } },
    },
  }

  assert.deepEqual(sanitizeSettings(settings, { includeOnlineWallpaperUrl: false }), {
    background: { online: { cache: { enabled: true } } },
  })
  assert.deepEqual(sanitizeSettings(settings, { includeOnlineWallpaperUrl: true }), settings)
})

test('local apply preserves excluded settings and only applies fields present in the snapshot', () => {
  const current = {
    background: {
      local: { id: 'local-image', url: 'blob:local' },
      online: { url: 'https://local.example/api', cache: { enabled: false } },
    },
    clock: { size: 50 },
  }
  const result = mergeSyncSettings(current, {
    background: { online: { cache: { enabled: true } } },
    clock: { size: 64 },
  })
  assert.deepEqual(result, {
    background: {
      local: { id: 'local-image', url: 'blob:local' },
      online: { url: 'https://local.example/api', cache: { enabled: true } },
    },
    clock: { size: 64 },
  })
})

test('local Quick Link apply preserves device-only icons without reviving removed user icons', () => {
  const incoming = {
    items: [
      { id: 'auto', title: 'Auto', url: 'https://auto.example/' },
      { id: 'removed-user', title: 'Removed', url: 'https://removed.example/' },
      {
        id: 'remote-user',
        title: 'Remote',
        url: 'https://remote.example/',
        favicon: 'data:image/png;base64,remote',
      },
    ],
    rootOrder: ['auto', 'removed-user', 'remote-user'],
    groups: [],
    groupOrder: [],
  }
  const current = {
    items: [
      {
        id: 'auto',
        title: 'Auto',
        url: 'https://auto.example/',
        favicon: 'data:image/png;base64,auto',
        faviconSource: 'automatic' as const,
      },
      {
        id: 'removed-user',
        title: 'Removed',
        url: 'https://removed.example/',
        favicon: 'data:image/png;base64,local-user',
        faviconSource: 'user-selected' as const,
      },
    ],
  }
  const result = materializeQuickLinks(incoming, current, true)
  assert.equal(result.items[0]?.faviconSource, 'automatic')
  assert.equal(result.items[1]?.favicon, undefined)
  assert.equal(result.items[2]?.faviconSource, 'user-selected')

  const excluded = materializeQuickLinks(incoming, current, false)
  assert.equal(excluded.items[1]?.favicon, 'data:image/png;base64,local-user')
  assert.equal(excluded.items[2]?.favicon, undefined)
})

test('disabled optional ranges preserve the confirmed baseline instead of creating deletions', () => {
  const base = snapshot()
  base.quickLinks.items[0]!.favicon = 'data:image/png;base64,remote'
  ;(base.settings.background as Record<string, unknown>) = {
    online: { url: 'https://remote.example/api', cache: { enabled: true } },
  }
  base.optional = {
    searchHistory: {
      items: [{ id: 'history-a', text: 'remote', createdAt: '2026-08-09T00:00:00.000Z' }],
      order: ['history-a'],
    },
    blockedTopSites: { urls: ['https://hidden.example/'] },
    wallpapers: {
      light: {
        assetId: `sha256-${'a'.repeat(64)}`,
        size: 10,
        mimeType: 'image/png',
        sha256: 'a'.repeat(64),
      },
    },
  }
  const captured = snapshot()
  ;(captured.settings.background as Record<string, unknown>) = {
    online: { cache: { enabled: false } },
  }
  const result = preserveExcludedScope(captured, base, {
    searchHistory: false,
    blockedTopSites: false,
    wallpapers: false,
    onlineWallpaperUrl: false,
    quickLinkIcons: false,
  })
  assert.equal(result.quickLinks.items[0]?.favicon, 'data:image/png;base64,remote')
  assert.equal(
    ((result.settings.background as Record<string, unknown>).online as Record<string, unknown>).url,
    'https://remote.example/api',
  )
  assert.deepEqual(result.optional, base.optional)
})

test('core-only storage fallback preserves the confirmed wallpaper state', () => {
  const base = snapshot()
  base.optional = {
    wallpapers: {
      light: {
        assetId: `sha256-${'a'.repeat(64)}`,
        size: 10,
        mimeType: 'image/png',
        sha256: 'a'.repeat(64),
      },
    },
  }
  const changed = snapshot()
  changed.settings.clock = { size: 60 }
  changed.optional = {
    wallpapers: {
      dark: {
        assetId: `sha256-${'b'.repeat(64)}`,
        size: 20,
        mimeType: 'image/webp',
        sha256: 'b'.repeat(64),
      },
    },
  }

  const fallback = preserveBaselineWallpapers(changed, base)
  assert.deepEqual(fallback.optional?.wallpapers, base.optional.wallpapers)
  assert.deepEqual(fallback.settings.clock, { size: 60 })
  assert.equal(preserveBaselineWallpapers(changed).optional, undefined)
})

test('merge import preserves current entities that are absent from the backup', () => {
  const current = snapshot()
  current.quickLinks.items.push({ id: 'current-only', title: 'Current', url: 'https://current.example/' })
  current.quickLinks.rootOrder.push('current-only')
  current.customSearchEngines = {
    items: [{ id: 'current-engine', name: 'Current', url: 'https://current.example/?q=%s' }],
    order: ['current-engine'],
  }
  const imported = snapshot()
  imported.quickLinks.items[0]!.title = 'Imported A'
  imported.quickLinks.items.push({ id: 'imported-only', title: 'Imported', url: 'https://imported.example/' })
  imported.quickLinks.rootOrder.push('imported-only')
  imported.customSearchEngines = {
    items: [{ id: 'imported-engine', name: 'Imported', url: 'https://imported.example/?q=%s' }],
    order: ['imported-engine'],
  }

  const merged = mergeImportedSnapshot(current, imported)

  assert.deepEqual(merged.quickLinks.rootOrder, ['link-a', 'imported-only', 'current-only'])
  assert.equal(merged.quickLinks.items.find((item) => item.id === 'link-a')?.title, 'Imported A')
  assert.deepEqual(merged.customSearchEngines.order, ['imported-engine', 'current-engine'])
})

test('snapshot capture rejects duplicate stable entity IDs instead of collapsing data', () => {
  const link = { id: 'link-a', title: 'A', url: 'https://a.example/' }
  assert.throws(
    () =>
      captureSyncSnapshot({
        settings: { version: 11 },
        quickLinks: { items: [link, link] },
        customSearchEngines: { items: [] },
        ui: { language: 'en', colorMode: 'auto' },
        scope: {
          searchHistory: false,
          blockedTopSites: false,
          wallpapers: false,
          onlineWallpaperUrl: true,
          quickLinkIcons: true,
        },
      }),
    /Duplicate Quick Link ID/,
  )
})

test('catalog explains user exclusions, unsupported video, size and pending permission', () => {
  const scope = {
    searchHistory: false,
    blockedTopSites: false,
    wallpapers: true,
    onlineWallpaperUrl: true,
    quickLinkIcons: true,
  }
  assert.equal(getSyncAvailability('searchHistory', { scope }).state, 'excluded-by-user')
  assert.equal(getSyncAvailability('onlineWallpaperUrl', { scope }).state, 'included')
  assert.equal(getSyncAvailability('quickLinkIcons', { scope }).state, 'included')
  assert.equal(
    getSyncAvailability('wallpaper.light', {
      scope,
      wallpapers: { light: { selected: true, mediaType: 'video' } },
    }).state,
    'unsupported-resource',
  )
  assert.equal(
    getSyncAvailability('wallpaper.dark', {
      scope,
      wallpapers: { dark: { selected: true, mediaType: 'image', size: 20 * 1024 * 1024 + 1 } },
    }).state,
    'too-large',
  )
  assert.equal(
    getSyncAvailability('permission.monet', {
      scope,
      pendingPermissions: new Set(['monet']),
    }).state,
    'pending-permission',
  )
})

test('three-way merge combines non-overlapping settings changes', () => {
  const base = snapshot()
  const local = structuredClone(base)
  const remote = structuredClone(base)
  ;(local.settings.clock as { size: number }).size = 64
  ;(remote.settings.search as { placeholder: string }).placeholder = 'Search'

  const result = mergeSyncSnapshots(base, local, remote)
  assert.equal(result.status, 'merged')
  assert.equal((result.snapshot.settings.clock as { size: number }).size, 64)
  assert.equal((result.snapshot.settings.search as { placeholder: string }).placeholder, 'Search')
})

test('three-way merge combines different fields of the same entity', () => {
  const base = snapshot()
  const local = structuredClone(base)
  const remote = structuredClone(base)
  local.quickLinks.items[0]!.title = 'Local title'
  remote.quickLinks.items[0]!.url = 'https://remote.example/'

  const result = mergeSyncSnapshots(base, local, remote)
  assert.equal(result.status, 'merged')
  assert.deepEqual(result.snapshot.quickLinks.items[0], {
    id: 'link-a',
    title: 'Local title',
    url: 'https://remote.example/',
  })
})

test('three-way merge reports simultaneous list order changes', () => {
  const base = snapshot()
  base.quickLinks.items.push(
    { id: 'link-b', title: 'B', url: 'https://b.example/' },
    { id: 'link-c', title: 'C', url: 'https://c.example/' },
  )
  base.quickLinks.rootOrder = ['link-a', 'link-b', 'link-c']
  const local = structuredClone(base)
  const remote = structuredClone(base)
  local.quickLinks.rootOrder = ['link-b', 'link-a', 'link-c']
  remote.quickLinks.rootOrder = ['link-a', 'link-c', 'link-b']

  const result = mergeSyncSnapshots(base, local, remote)
  assert.equal(result.status, 'conflict')
  assert.ok(
    result.conflicts.some(
      (conflict) => conflict.kind === 'order' && conflict.path === 'quickLinks.rootOrder',
    ),
  )
})

test('three-way merge reports same-field and order conflicts without choosing remote', () => {
  const base = snapshot()
  base.quickLinks.items.push({ id: 'link-b', title: 'B', url: 'https://b.example/' })
  base.quickLinks.rootOrder.push('link-b')
  const local = structuredClone(base)
  const remote = structuredClone(base)
  ;(local.settings.clock as { size: number }).size = 60
  ;(remote.settings.clock as { size: number }).size = 70
  local.quickLinks.rootOrder.reverse()
  remote.quickLinks.rootOrder = ['link-a', 'link-b']
  remote.quickLinks.items[0]!.title = 'Remote A'

  const result = mergeSyncSnapshots(base, local, remote)
  assert.equal(result.status, 'conflict')
  assert.ok(result.conflicts.some((conflict) => conflict.path === 'settings.clock.size'))
  assert.equal((result.snapshot.settings.clock as { size: number }).size, 60)
})

test('delete versus modify stays visible as a resolvable entity conflict', () => {
  const base = snapshot()
  const local = structuredClone(base)
  const remote = structuredClone(base)
  local.quickLinks.items = []
  local.quickLinks.rootOrder = []
  remote.quickLinks.items[0]!.title = 'Changed remotely'

  const result = mergeSyncSnapshots(base, local, remote)
  assert.equal(result.status, 'conflict')
  const conflict = result.conflicts.find((item) => item.kind === 'delete-vs-modify')
  assert.equal(conflict?.canKeepBoth, true)
  assert.equal(result.snapshot.quickLinks.items[0]?.title, 'Changed remotely')
})

test('Quick Link merge preserves one location per item across multiple groups', () => {
  const base = snapshot()
  base.quickLinks = {
    items: [
      { id: 'link-a', title: 'A', url: 'https://a.example/' },
      { id: 'link-b', title: 'B', url: 'https://b.example/' },
    ],
    rootOrder: [],
    groups: [
      { id: 'group-a', name: 'Group A', itemIds: ['link-a'] },
      { id: 'group-b', name: 'Group B', itemIds: ['link-b'] },
    ],
    groupOrder: ['group-a', 'group-b'],
  }
  const local = structuredClone(base)
  local.quickLinks.items[0]!.title = 'Local A'
  const remote = structuredClone(base)
  remote.quickLinks.groups[1]!.name = 'Remote B'
  const result = mergeSyncSnapshots(base, local, remote)
  assert.equal(result.conflicts.length, 0)
  assert.deepEqual(result.snapshot.quickLinks.groups.map((group) => group.itemIds), [
    ['link-a'],
    ['link-b'],
  ])
})

test('conflict choices apply only after every unresolved value has a decision', () => {
  const base = snapshot()
  const local = structuredClone(base)
  const remote = structuredClone(base)
  local.settings.clock = { size: 60 }
  remote.settings.clock = { size: 70 }
  const conflict = mergeSyncSnapshots(base, local, remote).conflicts[0]!
  assert.throws(() =>
    resolveSyncConflicts({ base, local, remote, resolutions: [] }),
  )
  const resolved = resolveSyncConflicts({
    base,
    local,
    remote,
    resolutions: [{ conflictId: conflict.id, choice: 'remote' }],
  })
  assert.deepEqual(resolved.settings.clock, { size: 70 })
})

test('keeping simultaneous creates preserves the remote entity as the duplicate', () => {
  const base = snapshot()
  base.quickLinks = { items: [], rootOrder: [], groups: [], groupOrder: [] }
  const local = structuredClone(base)
  const remote = structuredClone(base)
  local.quickLinks.items = [{ id: 'shared', title: 'Local', url: 'https://local.example/' }]
  local.quickLinks.rootOrder = ['shared']
  remote.quickLinks.items = [{ id: 'shared', title: 'Remote', url: 'https://remote.example/' }]
  remote.quickLinks.rootOrder = ['shared']
  const conflict = mergeSyncSnapshots(base, local, remote).conflicts.find(
    (item) => item.kind === 'simultaneous-create',
  )!

  const resolved = resolveSyncConflicts({
    base,
    local,
    remote,
    resolutions: [{ conflictId: conflict.id, choice: 'both', duplicateId: 'remote-copy' }],
  })

  assert.deepEqual(resolved.quickLinks.items, [
    { id: 'shared', title: 'Local', url: 'https://local.example/' },
    { id: 'remote-copy', title: 'Remote', url: 'https://remote.example/' },
  ])
})

test('sync decision converges concurrent non-overlapping branches without choosing by time', () => {
  const baseRevisionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const base = snapshot()
  const left = structuredClone(base)
  const right = structuredClone(base)
  ;(left.settings.clock as { size: number }).size = 60
  ;(right.settings.search as { placeholder: string }).placeholder = 'Remote'
  const decision = decideSynchronization({
    baseRevisionId,
    baseline: base,
    local: base,
    revisions: [
      branchRevision('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', [baseRevisionId], left),
      branchRevision('cccccccc-cccc-4ccc-8ccc-cccccccccccc', [baseRevisionId], right),
    ],
  })

  assert.equal(decision.action, 'publish')
  if (decision.action !== 'publish') return
  assert.equal(decision.reason, 'merge')
  assert.deepEqual(decision.parents, [
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  ])
  assert.equal((decision.snapshot.settings.clock as { size: number }).size, 60)
  assert.equal((decision.snapshot.settings.search as { placeholder: string }).placeholder, 'Remote')
})

test('sync decision stops on conflicting branches or an unknown ancestor', () => {
  const baseRevisionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const base = snapshot()
  const left = structuredClone(base)
  const right = structuredClone(base)
  ;(left.settings.clock as { size: number }).size = 60
  ;(right.settings.clock as { size: number }).size = 70
  const conflict = decideSynchronization({
    baseRevisionId,
    baseline: base,
    local: base,
    revisions: [
      branchRevision('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', [baseRevisionId], left),
      branchRevision('cccccccc-cccc-4ccc-8ccc-cccccccccccc', [baseRevisionId], right),
    ],
  })
  assert.equal(conflict.action, 'conflict')
  if (conflict.action === 'conflict') {
    assert.deepEqual(
      mergeSyncSnapshots(conflict.base, conflict.local, conflict.remote).conflicts,
      conflict.conflicts,
    )
  }

  const unknown = decideSynchronization({
    baseRevisionId,
    baseline: base,
    local: base,
    revisions: [
      branchRevision(
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'],
        left,
      ),
    ],
  })
  assert.equal(unknown.action, 'unknown-ancestor')
})

test('initialization keeps the device snapshot separate from conflicting remote branches', () => {
  const base = snapshot()
  const device = structuredClone(base)
  const left = structuredClone(base)
  const right = structuredClone(base)
  ;(device.settings.search as { placeholder: string }).placeholder = 'Device'
  ;(left.settings.clock as { size: number }).size = 60
  ;(right.settings.clock as { size: number }).size = 70

  const decision = decideInitialization({
    base,
    local: device,
    revisions: [
      branchRevision('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', [], left),
      branchRevision('cccccccc-cccc-4ccc-8ccc-cccccccccccc', [], right),
    ],
  })

  assert.equal(decision.action, 'conflict')
  if (decision.action === 'conflict') {
    assert.equal(decision.stage, 'remote-branches')
    assert.deepEqual(decision.deviceLocal, device)
    assert.deepEqual(
      mergeSyncSnapshots(decision.base, decision.local, decision.remote).conflicts,
      decision.conflicts,
    )
  }
})

test('tombstones expire after 180 days and stale devices reinitialize', () => {
  const deletedAt = new Date('2026-01-01T00:00:00.000Z')
  const tombstone = createTombstone('quick-link', 'link-a', 'revision-a', deletedAt)
  assert.equal(pruneExpiredTombstones([tombstone], new Date('2026-06-29T23:59:59.000Z')).length, 1)
  assert.equal(pruneExpiredTombstones([tombstone], new Date('2026-06-30T00:00:00.001Z')).length, 0)
  assert.equal(mustReinitializeDevice('2026-01-01T00:00:00.000Z', new Date('2026-07-01')), true)

  const base = snapshot()
  const local = structuredClone(base)
  const remote = structuredClone(base)
  ;(local.settings.clock as { size: number }).size = 60
  ;(remote.settings.search as { placeholder: string }).placeholder = 'Remote'
  const decision = decideInitialization({
    base,
    local,
    revisions: [
      branchRevision('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', [], remote),
    ],
  })
  assert.equal(decision.action, 'publish')
  if (decision.action === 'publish') {
    assert.equal((decision.snapshot.settings.clock as { size: number }).size, 60)
    assert.equal((decision.snapshot.settings.search as { placeholder: string }).placeholder, 'Remote')
  }
})

test('commit validation rejects unsafe paths and accepts complete metadata', () => {
  const record = {
    formatVersion: 1,
    vaultId: '11111111-1111-4111-8111-111111111111',
    generationId: '22222222-2222-4222-8222-222222222222',
    revisionId: '33333333-3333-4333-8333-333333333333',
    payloadPath: 'generations/g/revisions/r.json',
    payloadHash: 'a'.repeat(64),
    payloadSize: 128,
    encrypted: false,
    complete: true,
  }
  assert.equal(validateCommitRecord(record).ok, true)
  assert.equal(validateCommitRecord({ ...record, payloadPath: '../settings.json' }).ok, false)
})

test('revision validation checks nested snapshot, tombstones and assets', () => {
  const revision = {
    formatVersion: 1,
    settingsSchemaVersion: 11,
    vaultId: '11111111-1111-4111-8111-111111111111',
    generationId: '22222222-2222-4222-8222-222222222222',
    revisionId: '33333333-3333-4333-8333-333333333333',
    parentRevisionIds: ['44444444-4444-4444-8444-444444444444'],
    operationId: '55555555-5555-4555-8555-555555555555',
    device: { id: '66666666-6666-4666-8666-666666666666', name: 'Chrome · Windows · A7K3' },
    createdAt: '2026-08-09T00:00:00.000Z',
    reason: 'local-change',
    snapshot: snapshot(),
    tombstones: [
      {
        entityType: 'quick-link',
        entityId: 'link-deleted',
        deletedByRevisionId: '33333333-3333-4333-8333-333333333333',
        deletedAt: '2026-08-09T00:00:00.000Z',
        expiresAt: '2027-02-05T00:00:00.000Z',
      },
    ],
    assets: [
      {
        id: 'sha256-wallpaper',
        path: 'generations/g/assets/wallpaper.webp',
        role: 'wallpaper-light',
        size: 1024,
        mimeType: 'image/webp',
        sha256: 'b'.repeat(64),
      },
    ],
    snapshotHash: 'a'.repeat(64),
  }

  assert.equal(validateSyncRevision(revision).ok, true)
  assert.equal(
    validateSyncRevision({
      ...revision,
      snapshot: {
        ...revision.snapshot,
        quickLinks: { ...revision.snapshot.quickLinks, rootOrder: [] },
      },
    }).ok,
    false,
  )
  assert.equal(
    validateSyncRevision({
      ...revision,
      assets: [{ ...revision.assets[0], path: '../wallpaper.webp' }],
    }).ok,
    false,
  )
})

test('coordinator debounces changes and never overlaps network work', async () => {
  let calls = 0
  let active = 0
  let maximumActive = 0
  const triggers: string[] = []
  const coordinator = new SyncCoordinator(
    {
      isConfigured: async () => true,
      synchronize: async (trigger) => {
        calls += 1
        active += 1
        maximumActive = Math.max(maximumActive, active)
        triggers.push(trigger)
        await new Promise((resolve) => setTimeout(resolve, 8))
        active -= 1
      },
    },
    5,
  )

  coordinator.dataChanged()
  coordinator.dataChanged()
  coordinator.dataChanged()
  await new Promise((resolve) => setTimeout(resolve, 7))
  const first = coordinator.trigger('natural')
  const second = coordinator.trigger('manual')
  await Promise.all([first, second])

  assert.equal(maximumActive, 1)
  assert.equal(calls, 2)
  assert.deepEqual(triggers, ['data-change', 'manual'])
  coordinator.dispose()
})

test('client encryption binds ciphertext to its vault object and rejects wrong passwords', async () => {
  const vaultId = '11111111-1111-4111-8111-111111111111'
  const generationId = '22222222-2222-4222-8222-222222222222'
  const created = await createVaultEncryption('correct horse battery staple', vaultId, generationId)
  assert.equal(created.key.extractable, false)
  const aad = createEncryptionAad({
    vaultId,
    generationId,
    objectType: 'revision',
    objectId: '33333333-3333-4333-8333-333333333333',
  })
  const encrypted = await encryptSyncBytes(created.key, new TextEncoder().encode('private data'), aad)
  assert.equal(
    new TextDecoder().decode(await decryptSyncBytes(created.key, encrypted, aad)),
    'private data',
  )
  const tampered = encrypted.slice()
  tampered[tampered.length - 1]! ^= 1
  await assert.rejects(decryptSyncBytes(created.key, tampered, aad))
  await assert.rejects(
    decryptSyncBytes(
      created.key,
      encrypted,
      createEncryptionAad({
        vaultId,
        generationId,
        objectType: 'revision',
        objectId: '44444444-4444-4444-8444-444444444444',
      }),
    ),
  )
  await assert.rejects(
    unlockVaultEncryption('wrong password', vaultId, generationId, created.metadata),
  )
})

test('client encryption rejects excessive PBKDF2 work factors before deriving a key', async () => {
  await assert.rejects(
    deriveEncryptionKey('password', new Uint8Array(16), 2_000_001),
    /iteration count is unsafe/,
  )
})

test('local backup formats reuse the validated snapshot and keep image bytes outside JSON', async () => {
  const value = snapshot()
  const wallpaper = new Blob([new TextEncoder().encode('wallpaper-bytes')], {
    type: 'image/png',
  })
  const hash = await sha256Hex(await wallpaper.arrayBuffer())
  value.optional = {
    wallpapers: {
      light: {
        assetId: `sha256-${hash}`,
        mimeType: wallpaper.type,
        sha256: hash,
        size: wallpaper.size,
      },
    },
  }

  const json = serializeJsonBackup(value)
  assert.equal(json.includes('wallpaper-bytes'), false)
  assert.equal(parseJsonBackup(JSON.parse(json)).snapshot.optional, undefined)

  const archive = await createLocalBackupArchive(value, { light: wallpaper })
  const restored = await parseLocalBackupArchive(archive)
  assert.deepEqual(restored.snapshot, value)
  assert.deepEqual(
    new Uint8Array(await restored.wallpapers.light!.arrayBuffer()),
    new Uint8Array(await wallpaper.arrayBuffer()),
  )

  const tampered = new Uint8Array(await archive.arrayBuffer())
  tampered[tampered.length - 1] ^= 1
  await assert.rejects(parseLocalBackupArchive(new Blob([tampered])))
})

test('wallpaper compression inspection rejects animation before browser decoding', async () => {
  const png = new Uint8Array(45)
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  new DataView(png.buffer).setUint32(8, 13)
  png.set(new TextEncoder().encode('IHDR'), 12)
  new DataView(png.buffer).setUint32(16, 1920)
  new DataView(png.buffer).setUint32(20, 1080)
  new DataView(png.buffer).setUint32(33, 0)
  png.set(new TextEncoder().encode('IEND'), 37)
  assert.deepEqual(await inspectStaticWallpaper(new Blob([png])), {
    width: 1920,
    height: 1080,
    mimeType: 'image/png',
  })

  const animated = new Uint8Array(57)
  animated.set(png.subarray(0, 33))
  new DataView(animated.buffer).setUint32(33, 8)
  animated.set(new TextEncoder().encode('acTL'), 37)
  new DataView(animated.buffer).setUint32(53, 0)
  await assert.rejects(inspectStaticWallpaper(new Blob([animated])))
})
