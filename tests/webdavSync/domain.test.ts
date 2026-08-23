import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createSyncConflictDisplayContext,
  presentSyncConflict,
} from '../../shared/webdavSync/conflictPresentation.ts'
import {
  canonicalJson,
  compareSyncSnapshots,
  captureSyncSnapshot,
  collectRemoteBranchConflicts,
  createSyncConflictDetails,
  createTombstone,
  createEncryptionAad,
  createVaultEncryption,
  decryptSyncBytes,
  deriveEncryptionKey,
  decideInitialization,
  deduplicateQuickLinkIcons,
  decideSynchronization,
  getSyncAvailability,
  encryptSyncBytes,
  materializeQuickLinks,
  MAX_SYNC_INLINE_IMAGE_BYTES,
  MAX_SYNC_INLINE_IMAGES_BYTES,
  mergeSyncSnapshots,
  mergeImportedSnapshot,
  mergeSyncSettings,
  parseJsonBackup,
  parseLocalSyncState,
  preserveExcludedScope,
  preserveBaselineWallpapers,
  mustReinitializeDevice,
  pruneExpiredTombstones,
  quickLinkIconHashesAreValid,
  resolveSyncConflicts,
  resolveRemoteBranchConflicts,
  sanitizeSettings,
  serializeJsonBackup,
  SyncCoordinator,
  validateCommitRecord,
  validateSyncRevision,
  unlockVaultEncryption,
} from '../../shared/webdavSync/index.ts'
import type {
  SyncConflict,
  SyncRevisionV1,
  SyncScopePreferences,
  SyncSnapshotV1,
} from '../../shared/webdavSync/types.ts'

function syncScope(overrides: Partial<SyncScopePreferences> = {}): SyncScopePreferences {
  return {
    settings: true,
    quickLinks: true,
    customSearchEngines: true,
    uiPreferences: true,
    blockedTopSites: false,
    wallpapers: false,
    onlineWallpaperUrl: false,
    userIcons: false,
    ...overrides,
  }
}

function snapshot(): SyncSnapshotV1 {
  return {
    scope: syncScope(),
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
  assert.equal(
    canonicalJson(JSON.parse('{"__proto__":{"polluted":true}}')),
    '{"__proto__":{"polluted":true}}',
  )
  assert.equal(Reflect.has(Object.prototype, 'polluted'), false)
})

test('sync state bridge rejects an empty background response', () => {
  assert.throws(() => parseLocalSyncState(null), /invalid sync state/i)
  assert.deepEqual(
    parseLocalSyncState({
      configured: false,
      paused: false,
      deviceId: 'device-id',
      deviceName: 'Test device',
      resourceOmissions: [],
      scope: syncScope(),
      encrypted: false,
    }).deviceId,
    'device-id',
  )
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

test('conflict presentation hides entity IDs and reuses settings labels', () => {
  const local = snapshot()
  local.quickLinks!.items[0] = {
    id: 'internal-link-id',
    title: 'Lemon Docs',
    url: 'https://docs.example.com/start?token=secret',
    faviconHash: 'internal-icon-hash',
  }
  const context = createSyncConflictDisplayContext([local])
  const translated: string[] = []
  const t = (key: string, options?: Record<string, unknown>) => {
    translated.push(key)
    return options?.name ? `${key}:${options.name}` : key
  }
  const quickLinkConflict: SyncConflict = {
    id: 'quick-link-conflict',
    category: 'quick-links',
    kind: 'simultaneous-create',
    path: 'quickLinks.items.internal-link-id',
    local: local.quickLinks!.items[0]!,
    remote: {
      id: 'internal-link-id',
      title: 'Remote Docs',
      url: 'https://remote.example.com/',
      faviconHash: 'another-internal-icon-hash',
    },
    canKeepBoth: true,
  }

  const quickLink = presentSyncConflict(quickLinkConflict, context, t)
  assert.match(quickLink.title, /Lemon Docs/)
  assert.match(quickLink.local, /Lemon Docs.*docs\.example\.com\/start/)
  assert.doesNotMatch(quickLink.local, /internal-link-id|internal-icon-hash|token/)

  const linkUrl = presentSyncConflict(
    {
      ...quickLinkConflict,
      path: 'quickLinks.items.internal-link-id.url',
      local: 'https://docs.example.com/start?token=secret',
      remote: 'https://remote.example.com/start?token=other',
    },
    context,
    t,
  )
  assert.doesNotMatch(linkUrl.local, /token|secret/)

  presentSyncConflict(
    {
      id: 'setting-conflict',
      category: 'settings',
      kind: 'field',
      path: 'settings.theme.primaryColor',
      base: '#f5b800',
      local: '#1677ff',
      remote: '#722ed1',
      canKeepBoth: false,
    },
    context,
    t,
  )
  assert.ok(translated.includes('theme.primaryColor'))
})

test('conflict presentation keeps newly added settings granular and labels their missing baseline', () => {
  const base = snapshot()
  const local = structuredClone(base)
  const remote = structuredClone(base)
  local.settings.theme = { primaryColor: '#1677ff' }
  remote.settings.theme = { primaryColor: '#722ed1' }

  const conflict = mergeSyncSnapshots(base, local, remote).conflicts.find(
    (item) => item.path === 'settings.theme.primaryColor',
  )
  assert.ok(conflict)

  const display = presentSyncConflict(conflict, createSyncConflictDisplayContext([]), (key) => key)
  assert.equal(display.section, 'theme.title')
  assert.equal(display.title, 'theme.primaryColor')
  assert.equal(display.base, 'webdavSync.conflicts.values.noBaseline')
  assert.equal(display.local, '#1677ff')
  assert.equal(display.remote, '#722ed1')
})

test('conflict details refresh legacy parent conflicts and automatically merge empty wallpapers', () => {
  const base = snapshot()
  const local = structuredClone(base)
  const remote = structuredClone(base)
  local.settings.theme = { primaryColor: '#1677ff' }
  remote.settings.theme = { primaryColor: '#722ed1' }
  local.optional = { wallpapers: {} }
  remote.optional = { wallpapers: {} }

  const details = createSyncConflictDetails({
    base,
    local,
    remote,
    conflicts: [
      {
        id: 'settings:settings.theme:field',
        category: 'settings',
        kind: 'field',
        path: 'settings.theme',
        local: local.settings.theme,
        remote: remote.settings.theme,
        canKeepBoth: false,
      },
      {
        id: 'wallpaper:optional.wallpapers:field',
        category: 'wallpaper',
        kind: 'field',
        path: 'optional.wallpapers',
        local: {},
        remote: {},
        canKeepBoth: false,
      },
    ],
    remoteRevisionIds: ['remote-revision'],
  })

  assert.deepEqual(
    details.conflicts.map((conflict) => conflict.path),
    ['settings.theme.primaryColor'],
  )
})

test('conflict details identify an initial connection without shared data', () => {
  const local = snapshot()
  const remote = structuredClone(local)
  const details = createSyncConflictDetails({
    base: { scope: syncScope() },
    local,
    remote,
    conflicts: [],
    remoteRevisionIds: ['remote-revision'],
  })

  assert.equal(details.hasEmptyBase, true)
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
    scope: syncScope({ blockedTopSites: true, onlineWallpaperUrl: true, userIcons: true }),
    blockedTopSites: ['https://example.com/#section', 'javascript:alert(1)'],
  })

  assert.deepEqual(result.quickLinks?.rootOrder, ['link-a'])
  assert.deepEqual(result.customSearchEngines?.order, ['engine-a'])
  assert.deepEqual(result.optional?.blockedTopSites?.urls, ['https://example.com/'])
})

test('snapshot only includes explicitly user-selected Quick Link icons', () => {
  const makeSnapshot = (userIcons: boolean) =>
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
      scope: syncScope({ onlineWallpaperUrl: true, userIcons }),
    })

  assert.equal(makeSnapshot(true).quickLinks?.items[0]?.favicon, 'data:image/png;base64,user')
  assert.equal(makeSnapshot(true).quickLinks?.items[1]?.favicon, undefined)
  assert.equal(makeSnapshot(true).quickLinks?.items[2]?.favicon, undefined)
  assert.equal(makeSnapshot(false).quickLinks?.items[0]?.favicon, undefined)
})

test('snapshot stores duplicate user-selected Quick Link icons once by SHA-256', async () => {
  const value = snapshot()
  value.quickLinks!.items.push({
    id: 'link-b',
    title: 'B',
    url: 'https://b.example/',
  })
  value.quickLinks!.rootOrder.push('link-b')
  for (const item of value.quickLinks!.items) item.favicon = 'data:image/png;base64,same'

  await deduplicateQuickLinkIcons(value)

  const hashes = value.quickLinks!.items.map((item) => item.faviconHash)
  assert.equal(new Set(hashes).size, 1)
  assert.equal(Object.keys(value.inlineImages ?? {}).length, 1)
  assert.ok(value.quickLinks!.items.every((item) => item.favicon === undefined))
  assert.equal(await quickLinkIconHashesAreValid(value), true)
  value.inlineImages![hashes[0]!] = 'tampered'
  assert.equal(await quickLinkIconHashesAreValid(value), false)
})

test('oversized user icons are omitted without removing an existing baseline icon', async () => {
  const base = snapshot()
  base.quickLinks!.items[0]!.favicon = 'data:image/png;base64,previous'
  await deduplicateQuickLinkIcons(base)
  const previousHash = base.quickLinks!.items[0]!.faviconHash!
  const next = structuredClone(base)
  next.quickLinks!.items[0]!.favicon = `data:image/png;base64,${'x'.repeat(MAX_SYNC_INLINE_IMAGE_BYTES)}`
  delete next.quickLinks!.items[0]!.faviconHash
  delete next.inlineImages

  const omissions = await deduplicateQuickLinkIcons(next, base)

  assert.deepEqual(omissions, [{ kind: 'quick-link-icon', id: 'link-a', reason: 'item-too-large' }])
  assert.equal(next.quickLinks!.items[0]!.faviconHash, previousHash)
  assert.equal(next.inlineImages?.[previousHash], base.inlineImages?.[previousHash])
})

test('aggregate user icon limit skips whole icons before the snapshot exceeds 8 MB', async () => {
  const value = snapshot()
  value.quickLinks = {
    items: Array.from({ length: 5 }, (_, index) => ({
      id: `link-${index}`,
      title: String(index),
      url: `https://${index}.example/`,
      favicon: `${index}${'x'.repeat(1_800_000)}`,
    })),
    rootOrder: Array.from({ length: 5 }, (_, index) => `link-${index}`),
    groups: [],
    groupOrder: [],
  }

  const omissions = await deduplicateQuickLinkIcons(value)
  const total = Object.values(value.inlineImages ?? {}).reduce(
    (sum, item) => sum + new TextEncoder().encode(item).byteLength,
    0,
  )

  assert.ok(omissions.some((item) => item.reason === 'aggregate-too-large'))
  assert.ok(total <= MAX_SYNC_INLINE_IMAGES_BYTES)
})

test('online wallpaper URL is excluded from the settings whitelist', () => {
  const settings = {
    background: {
      online: { url: 'https://images.example/api?token=secret', cache: { enabled: true } },
    },
  }

  assert.deepEqual(sanitizeSettings(settings), {
    background: { online: { cache: { enabled: true } } },
  })
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

test('missing and unknown remote settings do not reset local whitelisted values', () => {
  const base = snapshot()
  base.settings = {
    clock: { size: 50 },
    future: { opaque: 'base' },
  }
  const local = structuredClone(base)
  local.settings!.clock = { size: 64 }
  const remote = structuredClone(base)
  remote.settings = {
    search: { placeholder: 'Remote' },
    future: { opaque: 'remote', added: true },
  }

  const result = mergeSyncSnapshots(base, local, remote)
  assert.equal(result.conflicts.length, 0)
  assert.deepEqual(result.snapshot.settings, {
    clock: { size: 64 },
    search: { placeholder: 'Remote' },
    future: { opaque: 'remote', added: true },
  })
  assert.deepEqual(mergeSyncSettings({ clock: { size: 50 } }, remote.settings), {
    clock: { size: 50 },
    search: { placeholder: 'Remote' },
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
        faviconHash: 'a'.repeat(64),
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
  const result = materializeQuickLinks(incoming, current, true, {
    ['a'.repeat(64)]: 'data:image/png;base64,remote',
  })
  assert.equal(result.items[0]?.faviconSource, 'automatic')
  assert.equal(result.items[1]?.favicon, undefined)
  assert.equal(result.items[2]?.faviconSource, 'user-selected')

  const excluded = materializeQuickLinks(incoming, current, false)
  assert.equal(excluded.items[1]?.favicon, 'data:image/png;base64,local-user')
  assert.equal(excluded.items[2]?.favicon, undefined)
})

test('disabled optional ranges preserve the confirmed baseline instead of creating deletions', () => {
  const base = snapshot()
  base.quickLinks!.items[0]!.faviconHash = 'a'.repeat(64)
  base.inlineImages = { ['a'.repeat(64)]: 'data:image/png;base64,remote' }
  base.optional = {
    blockedTopSites: { urls: ['https://hidden.example/'] },
    wallpapers: {
      light: {
        assetId: `sha256-${'a'.repeat(64)}`,
        size: 10,
        mimeType: 'image/png',
        sha256: 'a'.repeat(64),
      },
    },
    onlineWallpaperUrl: 'https://remote.example/api',
  }
  const captured = snapshot()
  const result = preserveExcludedScope(captured, base, syncScope())
  assert.equal(result.quickLinks?.items[0]?.faviconHash, 'a'.repeat(64))
  assert.equal(result.optional?.onlineWallpaperUrl, 'https://remote.example/api')
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
  assert.deepEqual(fallback.settings?.clock, { size: 60 })
  assert.equal(preserveBaselineWallpapers(changed).optional, undefined)
})

test('wallpaper conflicts are resolved once per color variant', () => {
  const base = snapshot()
  const local = snapshot()
  const remote = snapshot()
  base.optional = {
    wallpapers: {
      light: {
        assetId: `sha256-${'a'.repeat(64)}`,
        size: 1,
        mimeType: 'image/png',
        sha256: 'a'.repeat(64),
      },
    },
  }
  local.optional = {
    wallpapers: {
      light: {
        assetId: `sha256-${'b'.repeat(64)}`,
        size: 2,
        mimeType: 'image/webp',
        sha256: 'b'.repeat(64),
      },
    },
  }
  remote.optional = {
    wallpapers: {
      light: {
        assetId: `sha256-${'c'.repeat(64)}`,
        size: 3,
        mimeType: 'image/jpeg',
        sha256: 'c'.repeat(64),
      },
    },
  }

  const merged = mergeSyncSnapshots(base, local, remote)
  assert.deepEqual(merged.conflicts.map((conflict) => conflict.path), ['optional.wallpapers.light'])
  assert.equal(
    presentSyncConflict(merged.conflicts[0]!, createSyncConflictDisplayContext([]), (key) => key)
      .title,
    'webdavSync.conflicts.fields.wallpaperLight',
  )
  const resolved = resolveSyncConflicts({
    base,
    local,
    remote,
    resolutions: [{ choice: 'remote', conflictId: merged.conflicts[0]!.id }],
  })
  assert.equal(resolved.optional?.wallpapers?.light?.assetId, `sha256-${'c'.repeat(64)}`)
})

test('merge import preserves current entities that are absent from the backup', () => {
  const current = snapshot()
  current.quickLinks!.items.push({
    id: 'current-only',
    title: 'Current',
    url: 'https://current.example/',
  })
  current.quickLinks!.rootOrder.push('current-only')
  current.customSearchEngines = {
    items: [{ id: 'current-engine', name: 'Current', url: 'https://current.example/?q=%s' }],
    order: ['current-engine'],
  }
  const imported = snapshot()
  imported.quickLinks!.items[0]!.title = 'Imported A'
  imported.quickLinks!.items.push({
    id: 'imported-only',
    title: 'Imported',
    url: 'https://imported.example/',
  })
  imported.quickLinks!.rootOrder.push('imported-only')
  imported.customSearchEngines = {
    items: [{ id: 'imported-engine', name: 'Imported', url: 'https://imported.example/?q=%s' }],
    order: ['imported-engine'],
  }

  const merged = mergeImportedSnapshot(current, imported)

  assert.deepEqual(merged.quickLinks?.rootOrder, ['link-a', 'imported-only', 'current-only'])
  assert.equal(merged.quickLinks?.items.find((item) => item.id === 'link-a')?.title, 'Imported A')
  assert.deepEqual(merged.customSearchEngines?.order, ['imported-engine', 'current-engine'])
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
        scope: syncScope({ onlineWallpaperUrl: true, userIcons: true }),
      }),
    /Duplicate Quick Link ID/,
  )
})

test('catalog explains user exclusions, unsupported video, size and pending permission', () => {
  const scope = {
    ...syncScope(),
    wallpapers: true,
    onlineWallpaperUrl: true,
    userIcons: true,
  }
  assert.equal(getSyncAvailability('blockedTopSites', { scope }).state, 'excluded-by-user')
  assert.equal(getSyncAvailability('onlineWallpaperUrl', { scope }).state, 'included')
  assert.equal(getSyncAvailability('userIcons', { scope }).state, 'included')
  assert.equal(getSyncAvailability('searchHistory', { scope }).state, 'excluded-by-design')
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

test('a vault-wide remote scope change is adopted when this device did not change it', () => {
  const base = snapshot()
  const local = structuredClone(base)
  const remote = structuredClone(base)
  remote.scope.quickLinks = false

  const result = mergeSyncSnapshots(base, local, remote)

  assert.equal(result.conflicts.length, 0)
  assert.equal(result.snapshot.scope.quickLinks, false)
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
  assert.deepEqual(
    result.snapshot.quickLinks.groups.map((group) => group.itemIds),
    [['link-a'], ['link-b']],
  )
})

test('conflict choices apply only after every unresolved value has a decision', () => {
  const base = snapshot()
  const local = structuredClone(base)
  const remote = structuredClone(base)
  local.settings.clock = { size: 60 }
  remote.settings.clock = { size: 70 }
  const conflict = mergeSyncSnapshots(base, local, remote).conflicts[0]!
  assert.throws(() => resolveSyncConflicts({ base, local, remote, resolutions: [] }))
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

test('sync decision applies another device\'s resolved conflict without asking again', () => {
  const baseRevisionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const firstBranchId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const secondBranchId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const mergeRevisionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  const base = snapshot()
  const first = structuredClone(base)
  const second = structuredClone(base)
  const resolved = structuredClone(base)
  ;(first.settings.clock as { size: number }).size = 60
  ;(second.settings.clock as { size: number }).size = 70
  ;(resolved.settings.clock as { size: number }).size = 60

  const decision = decideSynchronization({
    baseRevisionId,
    baseline: base,
    local: base,
    revisions: [
      branchRevision(firstBranchId, [baseRevisionId], first),
      branchRevision(secondBranchId, [baseRevisionId], second),
      branchRevision(mergeRevisionId, [firstBranchId, secondBranchId], resolved),
    ],
  })

  assert.equal(decision.action, 'apply-remote')
  if (decision.action !== 'apply-remote') return
  assert.equal(decision.revisionId, mergeRevisionId)
  assert.deepEqual(decision.remote.snapshot, resolved)
})

test('multi-device conflicts let users choose local or a device value in one resolution', () => {
  const baseRevisionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const base = snapshot()
  const local = structuredClone(base)
  const first = structuredClone(base)
  const second = structuredClone(base)
  const third = structuredClone(base)
  ;(local.settings.clock as { size: number }).size = 55
  ;(first.settings.clock as { size: number }).size = 60
  ;(second.settings.clock as { size: number }).size = 70
  ;(third.settings.clock as { size: number }).size = 80
  const revisions = [
    branchRevision('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', [baseRevisionId], first),
    branchRevision('cccccccc-cccc-4ccc-8ccc-cccccccccccc', [baseRevisionId], second),
    branchRevision('dddddddd-dddd-4ddd-8ddd-dddddddddddd', [baseRevisionId], third),
  ]
  revisions.forEach((revision, index) => (revision.device.name = `Device ${index + 1}`))

  const localConflict = mergeSyncSnapshots(base, local, first).conflicts
  assert.equal(localConflict.length, 1)
  const directLocal = resolveSyncConflicts({
    base,
    local,
    remote: first,
    resolutions: [{ choice: 'local', conflictId: localConflict[0]!.id }],
  })
  assert.equal((directLocal.settings.clock as { size: number }).size, 55)

  const conflicts = collectRemoteBranchConflicts(base, revisions, {
    deviceName: 'Local',
    snapshot: local,
  })
  assert.equal(conflicts.length, 1)
  assert.deepEqual(
    conflicts[0]!.candidates?.map((candidate) => candidate.deviceName),
    ['Device 1', 'Device 2', 'Device 3', 'Local'],
  )
  const remoteResolved = resolveRemoteBranchConflicts({
    baseline: base,
    revisions,
    local: { deviceName: 'Local', snapshot: local },
    resolutions: [
      {
        choice: 'candidate',
        candidateId: revisions[1]!.revisionId,
        conflictId: conflicts[0]!.id,
      },
    ],
  })
  assert.equal((remoteResolved.settings.clock as { size: number }).size, 70)
  assert.equal((local.settings.clock as { size: number }).size, 55)
  const localResolved = resolveRemoteBranchConflicts({
    baseline: base,
    revisions,
    local: { deviceName: 'Local', snapshot: local },
    resolutions: [
      {
        choice: 'candidate',
        candidateId: 'local',
        conflictId: conflicts[0]!.id,
      },
    ],
  })
  assert.equal((localResolved.settings.clock as { size: number }).size, 55)
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
    revisions: [branchRevision('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', [], remote)],
  })
  assert.equal(decision.action, 'publish')
  if (decision.action === 'publish') {
    assert.equal((decision.snapshot.settings.clock as { size: number }).size, 60)
    assert.equal(
      (decision.snapshot.settings.search as { placeholder: string }).placeholder,
      'Remote',
    )
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
    scope: syncScope(),
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
  const encrypted = await encryptSyncBytes(
    created.key,
    new TextEncoder().encode('private data'),
    aad,
  )
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

test('JSON backup uses the validated portable snapshot and omits wallpaper files', () => {
  const value = snapshot()
  const hash = 'b'.repeat(64)
  value.scope.wallpapers = true
  value.optional = {
    wallpapers: {
      light: {
        assetId: `sha256-${hash}`,
        mimeType: 'image/png',
        sha256: hash,
        size: 42,
      },
    },
  }

  const json = serializeJsonBackup(value)
  const restored = parseJsonBackup(JSON.parse(json)).snapshot
  assert.equal(restored.scope.wallpapers, false)
  assert.equal(restored.optional, undefined)
})
