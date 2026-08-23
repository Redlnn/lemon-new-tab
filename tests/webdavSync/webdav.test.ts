import assert from 'node:assert/strict'
import test from 'node:test'

import {
  WebDavClient,
  WebDavError,
  WebDavVaultRepository,
  canonicalJson,
  classifyWebDavAddress,
  createEncryptionAad,
  createVaultEncryption,
  decryptSyncBytes,
  deserializeWebDavError,
  encryptSyncBytes,
  hasConfirmedCorruptionRepair,
  findRevisionHeads,
  hashCanonicalJson,
  parseWebDavMultiStatus,
  probeWebDavAccess,
  requireConfiguredVaultInspection,
  serializeWebDavError,
  type SyncRevisionV1,
  type VaultMetadataV1,
  type WebDavEntry,
  type WebDavMultiStatusParser,
} from '../../shared/webdavSync/index.ts'

const encoder = new TextEncoder()

type FakeResource = {
  bytes: Uint8Array
  collection: boolean
  lastModified: string
}

class FakeWebDavServer {
  readonly resources = new Map<string, FakeResource>()
  readonly events: string[] = []
  conditionalHeadersSeen = false
  redirectTo: string | undefined
  corruptPath: string | undefined
  forcedStatus: number | undefined
  losePutResponsePath: string | undefined

  constructor() {
    this.resources.set('/dav', this.resource(new Uint8Array(), true))
  }

  readonly parseMultiStatus: WebDavMultiStatusParser = (text) => JSON.parse(text) as WebDavEntry[]

  readonly fetch: typeof fetch = async (input, init = {}) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input : input.url,
    )
    const method = init.method ?? 'GET'
    const path = decodeURIComponent(url.pathname).replace(/\/$/, '') || '/'
    const headers = new Headers(init.headers)
    this.events.push(`${method} ${path}`)
    if (headers.has('If-Match') || headers.has('If-None-Match')) {
      this.conditionalHeadersSeen = true
    }

    if (this.redirectTo) {
      return new Response(null, { status: 302, headers: { Location: this.redirectTo } })
    }
    if (this.forcedStatus) return new Response(null, { status: this.forcedStatus })
    if (!headers.get('Authorization')?.startsWith('Basic '))
      return new Response(null, { status: 401 })

    if (method === 'MKCOL') {
      if (this.resources.has(path)) return new Response(null, { status: 405 })
      if (!this.resources.get(this.parent(path))?.collection)
        return new Response(null, { status: 409 })
      this.resources.set(path, this.resource(new Uint8Array(), true))
      return new Response(null, { status: 201 })
    }
    if (method === 'PUT') {
      if (!this.resources.get(this.parent(path))?.collection)
        return new Response(null, { status: 409 })
      const existing = this.resources.get(path)
      const bytes = await this.readBody(init.body)
      const resource = this.resource(bytes, false)
      this.resources.set(path, resource)
      if (path === this.losePutResponsePath) {
        this.losePutResponsePath = undefined
        return new Response(null, { status: 500 })
      }
      return new Response(null, { status: existing ? 204 : 201 })
    }
    if (method === 'GET') {
      const resource = this.resources.get(path)
      if (!resource || resource.collection) return new Response(null, { status: 404 })
      const bytes = path === this.corruptPath ? encoder.encode('corrupted') : resource.bytes
      return new Response(bytes, {
        status: 200,
        headers: { 'Content-Length': String(bytes.byteLength) },
      })
    }
    if (method === 'DELETE') {
      if (!this.resources.has(path)) return new Response(null, { status: 404 })
      for (const key of this.resources.keys()) {
        if (key === path || key.startsWith(`${path}/`)) this.resources.delete(key)
      }
      return new Response(null, { status: 204 })
    }
    if (method === 'PROPFIND') {
      const resource = this.resources.get(path)
      if (!resource?.collection) return new Response(null, { status: 404 })
      const entries = [...this.resources.entries()]
        .filter(([key]) => key === path || (this.parent(key) === path && key !== path))
        .map(([key, value]) => ({
          url: `${url.origin}${key}${value.collection ? '/' : ''}`,
          name: key.slice(key.lastIndexOf('/') + 1),
          isCollection: value.collection,
          contentLength: value.bytes.byteLength,
          lastModified: value.lastModified,
        }))
      return new Response(JSON.stringify(entries), { status: 207 })
    }
    return new Response(null, { status: 405 })
  }

  private resource(bytes: Uint8Array, collection: boolean): FakeResource {
    return {
      bytes: bytes.slice(),
      collection,
      lastModified: new Date().toUTCString(),
    }
  }

  private parent(path: string): string {
    const index = path.lastIndexOf('/')
    return index <= 0 ? '/' : path.slice(0, index)
  }

  private async readBody(body: BodyInit | null | undefined): Promise<Uint8Array> {
    if (body === undefined || body === null) return new Uint8Array()
    if (typeof body === 'string') return encoder.encode(body)
    return new Uint8Array(await new Response(body).arrayBuffer())
  }
}

function client(server: FakeWebDavServer) {
  return new WebDavClient(
    { baseUrl: 'https://dav.example/dav/', username: 'lemon', password: 'secret' },
    server.fetch,
    server.parseMultiStatus,
  )
}

function metadata(): VaultMetadataV1 {
  return {
    product: 'lemon-new-tab',
    formatVersion: 1,
    vaultId: '11111111-1111-4111-8111-111111111111',
    generationId: '22222222-2222-4222-8222-222222222222',
    encrypted: false,
  }
}

async function revision(
  meta: VaultMetadataV1,
  revisionId = '33333333-3333-4333-8333-333333333333',
  parentRevisionIds: string[] = [],
  createdAt = '2026-08-09T00:00:00.000Z',
): Promise<SyncRevisionV1> {
  const snapshot = {
    scope: {
      settings: true,
      quickLinks: true,
      customSearchEngines: true,
      uiPreferences: true,
      blockedTopSites: false,
      wallpapers: false,
      onlineWallpaperUrl: false,
      userIcons: false,
    },
    settings: { version: 11 },
    quickLinks: { items: [], rootOrder: [], groups: [], groupOrder: [] },
    customSearchEngines: { items: [], order: [] },
    ui: { language: 'zh-CN', colorMode: 'auto' as const },
  }
  return {
    formatVersion: 1,
    settingsSchemaVersion: 11,
    vaultId: meta.vaultId,
    generationId: meta.generationId,
    revisionId,
    parentRevisionIds,
    operationId: '44444444-4444-4444-8444-444444444444',
    device: { id: '55555555-5555-4555-8555-555555555555', name: 'Chrome · Windows · A7K3' },
    createdAt,
    reason: 'initial',
    snapshot,
    tombstones: [],
    assets: [],
    snapshotHash: await hashCanonicalJson(snapshot),
  }
}

test('address classification produces an exact origin permission and requires explicit HTTP approval', () => {
  assert.deepEqual(classifyWebDavAddress('https://dav.example:8443/root/'), {
    origin: 'https://dav.example:8443',
    permissionOrigin: 'https://dav.example:8443/*',
    transport: 'https',
  })
  assert.equal(classifyWebDavAddress('http://192.168.1.2/dav').transport, 'local-http')
  assert.throws(
    () => classifyWebDavAddress('http://dav.example/dav'),
    (error: unknown) => error instanceof WebDavError && error.category === 'insecure-http',
  )
  assert.throws(
    () => new WebDavClient({ baseUrl: 'http://192.168.1.2/dav', username: 'a', password: 'b' }),
    (error: unknown) => error instanceof WebDavError && error.category === 'insecure-http',
  )
  assert.doesNotThrow(
    () =>
      new WebDavClient({
        baseUrl: 'http://[::1]/dav',
        username: 'a',
        password: 'b',
        insecureHttpApproval: 'local-warning',
      }),
  )
  assert.throws(
    () =>
      new WebDavClient({
        baseUrl: 'http://dav.example/dav',
        username: 'a',
        password: 'b',
        insecureHttpApproval: 'local-warning',
      }),
    (error: unknown) => error instanceof WebDavError && error.category === 'insecure-http',
  )
  assert.throws(() => classifyWebDavAddress('https://user:secret@dav.example/dav'))
})

test('a deleted configured vault stays a not-found condition instead of an identity mismatch', () => {
  assert.throws(
    () => requireConfiguredVaultInspection({ state: 'missing' }, metadata()),
    (error: unknown) => error instanceof WebDavError && error.category === 'not-found',
  )
  assert.throws(
    () => requireConfiguredVaultInspection({ state: 'empty' }, metadata()),
    (error: unknown) => error instanceof WebDavError && error.category === 'not-found',
  )
  assert.throws(
    () => requireConfiguredVaultInspection({ state: 'foreign' }, metadata()),
    (error: unknown) => error instanceof WebDavError && error.category === 'foreign-vault',
  )
  assert.equal(
    requireConfiguredVaultInspection({ state: 'ready', metadata: metadata() }, metadata()).metadata
      .vaultId,
    metadata().vaultId,
  )
})

test('vault inspection reads the ownership marker before listing a ready directory', async () => {
  const server = new FakeWebDavServer()
  const vault = metadata()
  const repository = new WebDavVaultRepository(client(server))
  await repository.initialize(vault)
  server.events.length = 0

  assert.deepEqual(await repository.inspect(), { state: 'ready', metadata: vault })
  assert.deepEqual(server.events, ['GET /dav/LemonNewTab/vault.json'])
})

test('a repair remains confirmed after a later revision extends its head', async () => {
  const vault = metadata()
  const previous = await revision(vault, '66666666-6666-4666-8666-666666666661')
  const damagedRevisionId = '66666666-6666-4666-8666-666666666662'
  const repair = {
    ...(await revision(vault, '66666666-6666-4666-8666-666666666663', [previous.revisionId])),
    reason: 'repair' as const,
    repairedRevisionId: damagedRevisionId,
  }
  const later = await revision(vault, '66666666-6666-4666-8666-666666666664', [repair.revisionId])

  assert.equal(hasConfirmedCorruptionRepair([previous, repair, later], damagedRevisionId), true)
})

test('WebDAV client preserves the global fetch receiver in a service worker', async () => {
  const fetchWithRequiredReceiver: typeof fetch = async function (input, init) {
    assert.equal(this, globalThis)
    assert.equal(init?.method, 'GET')
    assert.equal(String(input), 'https://dav.example/dav/file.json')
    return new Response('{}', { status: 200 })
  }
  const webDav = new WebDavClient(
    { baseUrl: 'https://dav.example/dav/', username: 'lemon', password: 'secret' },
    fetchWithRequiredReceiver,
  )

  await webDav.get('file.json')
})

test('WebDAV multi-status parser works without DOMParser in a service worker', () => {
  const entries = parseWebDavMultiStatus(
    '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>/dav/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response><D:response><D:href>/dav/hello%20world.json</D:href><D:propstat><D:prop><D:resourcetype/><D:getcontentlength>5</D:getcontentlength><D:getlastmodified>Sat, 22 Aug 2026 13:28:24 GMT</D:getlastmodified></D:prop></D:propstat></D:response></D:multistatus>',
    new URL('http://127.0.0.1:6065/dav/'),
  )

  assert.deepEqual(entries, [
    {
      url: 'http://127.0.0.1:6065/dav/',
      name: 'dav',
      isCollection: true,
      lastModified: undefined,
    },
    {
      url: 'http://127.0.0.1:6065/dav/hello%20world.json',
      name: 'hello world.json',
      isCollection: false,
      contentLength: 5,
      lastModified: 'Sat, 22 Aug 2026 13:28:24 GMT',
    },
  ])
})

test('WebDAV multi-status parser rejects malformed XML', () => {
  assert.throws(
    () =>
      parseWebDavMultiStatus(
        '<D:multistatus xmlns:D="DAV:"><D:response><D:href>/dav/</D:response>',
        new URL('https://dav.example/dav/'),
      ),
    (error: unknown) => error instanceof WebDavError && error.category === 'invalid-response',
  )
})

test('access probe verifies basic WebDAV operations without conditional headers and cleans up', async () => {
  const server = new FakeWebDavServer()
  await probeWebDavAccess(client(server))
  assert.equal(server.conditionalHeadersSeen, false)
  assert.deepEqual([...server.resources.keys()], ['/dav'])
})

test('vault publication makes a revision visible only after payload verification and commit', async () => {
  const server = new FakeWebDavServer()
  server.events.length = 0
  const vault = metadata()
  const repository = new WebDavVaultRepository(client(server))
  await repository.initialize(vault)
  const value = await revision(vault)
  const commit = await repository.publishRevision(vault, value)
  const commits = await repository.listCommits(vault)
  assert.deepEqual(commits, [commit])
  assert.deepEqual(await repository.readRevision(commit), value)

  const revisionPut = server.events.findIndex(
    (event) => event.includes('PUT /dav/LemonNewTab/generations/') && event.includes('/revisions/'),
  )
  const revisionGet = server.events.findIndex(
    (event) => event.includes('GET /dav/LemonNewTab/generations/') && event.includes('/revisions/'),
  )
  const commitPut = server.events.findIndex(
    (event) => event.includes('PUT /dav/LemonNewTab/generations/') && event.includes('/commits/'),
  )
  assert.ok(revisionPut >= 0 && revisionGet > revisionPut && commitPut > revisionGet)
  assert.equal(
    server.events.filter((event) => event === 'PUT /dav/LemonNewTab/vault.json').length,
    1,
  )
  assert.equal(server.conditionalHeadersSeen, false)
})

test('concurrent revisions remain visible and a multi-parent revision converges the DAG', async () => {
  const server = new FakeWebDavServer()
  const vault = metadata()
  const repository = new WebDavVaultRepository(client(server))
  await repository.initialize(vault)
  const root = await revision(vault)
  await repository.publishRevision(vault, root)
  const left = await revision(vault, '66666666-6666-4666-8666-666666666661', [root.revisionId])
  const right = await revision(vault, '66666666-6666-4666-8666-666666666662', [root.revisionId])
  await Promise.all([
    repository.publishRevision(vault, left),
    repository.publishRevision(vault, right),
  ])
  const branched = await Promise.all(
    (await repository.listCommits(vault)).map((commit) => repository.readRevision(commit)),
  )
  assert.deepEqual(
    findRevisionHeads(branched)
      .map((value) => value.revisionId)
      .sort(),
    [left.revisionId, right.revisionId].sort(),
  )

  const merged = await revision(vault, '66666666-6666-4666-8666-666666666663', [
    left.revisionId,
    right.revisionId,
  ])
  await repository.publishRevision(vault, merged)
  const converged = await Promise.all(
    (await repository.listCommits(vault)).map((commit) => repository.readRevision(commit)),
  )
  assert.deepEqual(
    findRevisionHeads(converged).map((value) => value.revisionId),
    [merged.revisionId],
  )
})

test('a lost commit response is recognized without rewriting the published revision', async () => {
  const server = new FakeWebDavServer()
  const vault = metadata()
  const repository = new WebDavVaultRepository(client(server))
  await repository.initialize(vault)
  const value = await revision(vault)
  const commitPath = `/dav/LemonNewTab/generations/${vault.generationId}/commits/${value.revisionId}.json`
  server.losePutResponsePath = commitPath
  await assert.rejects(
    repository.publishRevision(vault, value),
    (error: unknown) => error instanceof WebDavError && error.category === 'server',
  )
  const writesBeforeRecovery = server.events.filter((event) => event === `PUT ${commitPath}`).length
  assert.equal(await repository.hasPublishedRevision(vault, value), true)
  assert.equal(
    server.events.filter((event) => event === `PUT ${commitPath}`).length,
    writesBeforeRecovery,
  )
})

test('a pending revision ID occupied by different content is not reusable', async () => {
  const server = new FakeWebDavServer()
  const vault = metadata()
  const repository = new WebDavVaultRepository(client(server))
  await repository.initialize(vault)
  const existing = await revision(vault)
  await repository.publishRevision(vault, existing)
  const snapshot = structuredClone(existing.snapshot)
  snapshot.settings = { version: 12 }
  const pending: SyncRevisionV1 = {
    ...existing,
    operationId: '77777777-7777-4777-8777-777777777777',
    snapshot,
    snapshotHash: await hashCanonicalJson(snapshot),
  }
  assert.equal(await repository.hasPublishedRevision(vault, pending), false)
})

test('orphan revision bodies stay invisible and corrupted committed payloads stop reading', async () => {
  const server = new FakeWebDavServer()
  const vault = metadata()
  const repository = new WebDavVaultRepository(client(server))
  await repository.initialize(vault)
  await client(server).put(
    `/LemonNewTab/generations/${vault.generationId}/revisions/orphan.json`,
    canonicalJson(await revision(vault)),
  )
  assert.deepEqual(await repository.listCommits(vault), [])

  const commit = await repository.publishRevision(vault, await revision(vault))
  server.corruptPath = `/dav/LemonNewTab/${commit.payloadPath}`
  await assert.rejects(
    repository.readCommittedPayload(commit),
    (error: unknown) => error instanceof WebDavError && error.category === 'corrupted',
  )
})

test('a commit that references a missing revision is treated as remote corruption', async () => {
  const server = new FakeWebDavServer()
  const vault = metadata()
  const repository = new WebDavVaultRepository(client(server))
  await repository.initialize(vault)
  const commit = await repository.publishRevision(vault, await revision(vault))
  server.resources.delete(`/dav/LemonNewTab/${commit.payloadPath}`)
  await assert.rejects(
    repository.readCommittedPayload(commit),
    (error: unknown) => error instanceof WebDavError && error.category === 'corrupted',
  )
})

test('wallpaper assets use SHA-256 names and are verified after upload and download', async () => {
  const server = new FakeWebDavServer()
  const vault = metadata()
  const repository = new WebDavVaultRepository(client(server))
  await repository.initialize(vault)
  const blob = new Blob([encoder.encode('image bytes')], { type: 'image/png' })
  const asset = await repository.publishAsset(vault, 'wallpaper-light', blob)
  assert.match(asset.id, /^sha256-[0-9a-f]{64}$/)
  assert.equal(asset.path, `generations/${vault.generationId}/assets/${asset.id}.blob`)
  assert.deepEqual(
    new Uint8Array(await (await repository.readAsset(asset)).arrayBuffer()),
    encoder.encode('image bytes'),
  )
})

test('encrypted generations keep revision and wallpaper plaintext out of WebDAV', async () => {
  const server = new FakeWebDavServer()
  const repository = new WebDavVaultRepository(client(server), 'LemonNewTab')
  const base = metadata()
  const created = await createVaultEncryption(
    'independent encryption password',
    base.vaultId,
    base.generationId,
  )
  const encryptedMetadata: VaultMetadataV1 = {
    ...base,
    encrypted: true,
    encryption: created.metadata,
  }
  await repository.initialize(encryptedMetadata)
  const value = await revision(encryptedMetadata)
  const storedRevision = await encryptSyncBytes(
    created.key,
    encoder.encode(canonicalJson(value)),
    createEncryptionAad({
      vaultId: base.vaultId,
      generationId: base.generationId,
      objectType: 'revision',
      objectId: value.revisionId,
    }),
  )
  const commit = await repository.publishRevision(encryptedMetadata, value, storedRevision)
  assert.equal(
    new TextDecoder().decode(await repository.readCommittedPayload(commit)).includes('Chrome'),
    false,
  )
  await assert.rejects(
    repository.readRevision(commit),
    (error: unknown) => error instanceof WebDavError && error.category === 'unsupported',
  )
  const decryptedRevision = await decryptSyncBytes(
    created.key,
    await repository.readCommittedPayload(commit),
    createEncryptionAad({
      vaultId: base.vaultId,
      generationId: base.generationId,
      objectType: 'revision',
      objectId: value.revisionId,
    }),
  )
  assert.deepEqual(JSON.parse(new TextDecoder().decode(decryptedRevision)), value)

  const wallpaper = new Blob([encoder.encode('private wallpaper')], { type: 'image/png' })
  const storageId = '66666666-6666-4666-8666-666666666666'
  const encryptedWallpaper = await encryptSyncBytes(
    created.key,
    await wallpaper.arrayBuffer(),
    createEncryptionAad({
      vaultId: base.vaultId,
      generationId: base.generationId,
      objectType: 'asset',
      objectId: storageId,
    }),
  )
  const asset = await repository.publishEncryptedAsset(
    encryptedMetadata,
    'wallpaper-light',
    wallpaper,
    storageId,
    encryptedWallpaper,
  )
  assert.equal(asset.path.includes(asset.sha256), false)
  assert.equal(
    new TextDecoder().decode(await repository.readEncryptedAsset(asset)).includes('wallpaper'),
    false,
  )
})

test('cross-origin redirects stop before credentials can be forwarded', async () => {
  const server = new FakeWebDavServer()
  server.redirectTo = 'https://other.example/dav/'
  await assert.rejects(
    client(server).get('file.json'),
    (error: unknown) =>
      error instanceof WebDavError &&
      error.category === 'redirect-cross-origin' &&
      error.redirectOrigin === 'https://other.example',
  )
  assert.equal(server.events.length, 1)
})

test('HTTP error categories preserve safe coordinator decisions', async () => {
  const server = new FakeWebDavServer()
  server.forcedStatus = 507
  await assert.rejects(
    client(server).put('file.json', '{}'),
    (error: unknown) => error instanceof WebDavError && error.category === 'storage-full',
  )
})

test('WebDAV errors cross the runtime boundary without leaking request details', () => {
  const serialized = serializeWebDavError(
    new WebDavError('authentication', 'failed for https://user:secret@dav.example', 401),
  )
  assert.deepEqual(serialized, { category: 'authentication', status: 401 })
  assert.equal(JSON.stringify(serialized).includes('secret'), false)

  const restored = deserializeWebDavError(serialized)
  assert.equal(restored.category, 'authentication')
  assert.equal(restored.status, 401)
})

test('history cleanup keeps the newest versions and refuses unresolved branches', async () => {
  const server = new FakeWebDavServer()
  const vault = metadata()
  const repository = new WebDavVaultRepository(client(server))
  await repository.initialize(vault)
  const ids = Array.from(
    { length: 12 },
    (_, index) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  )
  const revisions: SyncRevisionV1[] = []
  for (let index = 0; index < ids.length; index += 1) {
    const value = await revision(
      vault,
      ids[index],
      index === 0 ? [] : [ids[index - 1]!],
      new Date(Date.UTC(2026, 7, index + 1)).toISOString(),
    )
    revisions.push(value)
    await repository.publishRevision(vault, value)
  }
  const result = await repository.pruneHistory(vault, revisions)
  assert.deepEqual(result, { deletedAssets: 0, deletedRevisions: 2, skipped: false })
  assert.deepEqual(
    (await repository.listCommits(vault)).map((commit) => commit.revisionId).sort(),
    ids.slice(-10),
  )

  const branch = await revision(
    vault,
    '20000000-0000-4000-8000-000000000001',
    [ids[10]!],
    '2026-08-20T00:00:00.000Z',
  )
  await repository.publishRevision(vault, branch)
  const retained = [...revisions.slice(2), branch]
  assert.equal((await repository.pruneHistory(vault, retained)).skipped, true)
})

test('history cleanup expires old commits but always protects current and previous', async () => {
  const server = new FakeWebDavServer()
  const vault = metadata()
  const repository = new WebDavVaultRepository(client(server))
  await repository.initialize(vault)
  const ids = Array.from(
    { length: 5 },
    (_, index) => `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  )
  const revisions: SyncRevisionV1[] = []
  for (let index = 0; index < ids.length; index += 1) {
    const value = await revision(vault, ids[index], index ? [ids[index - 1]!] : [])
    revisions.push(value)
    await repository.publishRevision(vault, value)
  }
  const old = new Date('2025-01-01T00:00:00.000Z').toUTCString()
  for (const [path, resource] of server.resources) {
    if (path.includes('/commits/')) resource.lastModified = old
  }

  const result = await repository.pruneHistory(vault, revisions)
  assert.equal(result.deletedRevisions, 3)
  assert.deepEqual(
    (await repository.listCommits(vault)).map((commit) => commit.revisionId).sort(),
    ids.slice(-2),
  )
})
