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
  encryptSyncBytes,
  probeWebDavCapabilities,
  hashCanonicalJson,
  type SyncRevisionV1,
  type VaultMetadataV1,
  type WebDavEntry,
  type WebDavMultiStatusParser,
} from '../../shared/webdavSync/index.ts'

const encoder = new TextEncoder()

type FakeResource = {
  bytes: Uint8Array
  collection: boolean
  etag: string
}

class FakeWebDavServer {
  readonly resources = new Map<string, FakeResource>()
  readonly events: string[] = []
  honorConditionalCreate = true
  honorConditionalUpdate = true
  redirectTo: string | undefined
  corruptPath: string | undefined
  forcedStatus: number | undefined
  private etagVersion = 0

  constructor() {
    this.resources.set('/dav', this.resource(new Uint8Array(), true))
  }

  readonly parseMultiStatus: WebDavMultiStatusParser = (text) => JSON.parse(text) as WebDavEntry[]

  readonly fetch: typeof fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)
    const method = init.method ?? 'GET'
    const path = decodeURIComponent(url.pathname).replace(/\/$/, '') || '/'
    const headers = new Headers(init.headers)
    this.events.push(`${method} ${path}`)

    if (this.redirectTo) {
      return new Response(null, { status: 302, headers: { Location: this.redirectTo } })
    }
    if (this.forcedStatus) return new Response(null, { status: this.forcedStatus })
    if (!headers.get('Authorization')?.startsWith('Basic ')) return new Response(null, { status: 401 })

    if (method === 'MKCOL') {
      if (this.resources.has(path)) return new Response(null, { status: 405 })
      if (!this.resources.get(this.parent(path))?.collection) return new Response(null, { status: 409 })
      this.resources.set(path, this.resource(new Uint8Array(), true))
      return new Response(null, { status: 201 })
    }
    if (method === 'PUT') {
      if (!this.resources.get(this.parent(path))?.collection) return new Response(null, { status: 409 })
      const existing = this.resources.get(path)
      if (this.honorConditionalCreate && headers.get('If-None-Match') === '*' && existing) {
        return new Response(null, { status: 412 })
      }
      if (
        this.honorConditionalUpdate &&
        headers.has('If-Match') &&
        (!existing || headers.get('If-Match') !== existing.etag)
      ) {
        return new Response(null, { status: 412 })
      }
      const bytes = await this.readBody(init.body)
      const resource = this.resource(bytes, false)
      this.resources.set(path, resource)
      return new Response(null, { status: existing ? 204 : 201, headers: { ETag: resource.etag } })
    }
    if (method === 'GET') {
      const resource = this.resources.get(path)
      if (!resource || resource.collection) return new Response(null, { status: 404 })
      const bytes = path === this.corruptPath ? encoder.encode('corrupted') : resource.bytes
      return new Response(bytes, {
        status: 200,
        headers: { ETag: resource.etag, 'Content-Length': String(bytes.byteLength) },
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
          etag: value.etag,
          contentLength: value.bytes.byteLength,
        }))
      return new Response(JSON.stringify(entries), { status: 207 })
    }
    return new Response(null, { status: 405 })
  }

  private resource(bytes: Uint8Array, collection: boolean): FakeResource {
    return { bytes: bytes.slice(), collection, etag: `"etag-${++this.etagVersion}"` }
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

function metadata(capabilities: VaultMetadataV1['capabilities']): VaultMetadataV1 {
  return {
    product: 'lemon-new-tab',
    formatVersion: 1,
    vaultId: '11111111-1111-4111-8111-111111111111',
    generationId: '22222222-2222-4222-8222-222222222222',
    encrypted: false,
    capabilities,
  }
}

async function revision(
  meta: VaultMetadataV1,
  revisionId = '33333333-3333-4333-8333-333333333333',
  parentRevisionIds: string[] = [],
  createdAt = '2026-08-09T00:00:00.000Z',
): Promise<SyncRevisionV1> {
  const snapshot = {
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
  assert.equal(classifyWebDavAddress('http://dav.example/dav').transport, 'external-http')
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

test('capability probe selects conditional mode and removes all test files', async () => {
  const server = new FakeWebDavServer()
  const result = await probeWebDavCapabilities(client(server))
  assert.deepEqual(result, {
    conditionalCreate: true,
    conditionalUpdate: true,
    mode: 'conditional',
  })
  assert.deepEqual([...server.resources.keys()], ['/dav'])
})

test('capability probe enters safe degraded mode when conditions are ignored', async () => {
  const server = new FakeWebDavServer()
  server.honorConditionalCreate = false
  server.honorConditionalUpdate = false
  const result = await probeWebDavCapabilities(client(server))
  assert.equal(result.mode, 'safe-degraded')
  assert.equal(result.conditionalCreate, false)
  assert.equal(result.conditionalUpdate, false)
})

test('vault publication makes a revision visible only after payload verification and commit', async () => {
  const server = new FakeWebDavServer()
  const capabilities = await probeWebDavCapabilities(client(server))
  server.events.length = 0
  const vault = metadata(capabilities)
  const repository = new WebDavVaultRepository(client(server))
  const initialized = await repository.initialize(vault)
  const value = await revision(vault)
  const commit = await repository.publishRevision(vault, value)
  const commits = await repository.listCommits(vault)
  assert.deepEqual(commits, [commit])
  assert.deepEqual(await repository.readRevision(commit), value)

  const revisionPut = server.events.findIndex((event) => event.includes('PUT /dav/LemonNewTab/generations/') && event.includes('/revisions/'))
  const revisionGet = server.events.findIndex((event) => event.includes('GET /dav/LemonNewTab/generations/') && event.includes('/revisions/'))
  const commitPut = server.events.findIndex((event) => event.includes('PUT /dav/LemonNewTab/generations/') && event.includes('/commits/'))
  assert.ok(revisionPut >= 0 && revisionGet > revisionPut && commitPut > revisionGet)

  const updated = await repository.updateCurrentRevision(vault, initialized.etag, value.revisionId)
  assert.equal(updated.metadata.currentRevisionId, value.revisionId)
})

test('stale vault ETag cannot overwrite a newer current pointer', async () => {
  const server = new FakeWebDavServer()
  const capabilities = await probeWebDavCapabilities(client(server))
  const vault = metadata(capabilities)
  const repository = new WebDavVaultRepository(client(server))
  const initialized = await repository.initialize(vault)
  await repository.updateCurrentRevision(vault, initialized.etag, 'revision-a')
  await assert.rejects(
    repository.updateCurrentRevision(vault, initialized.etag, 'revision-b'),
    (error: unknown) => error instanceof WebDavError && error.category === 'precondition',
  )
})

test('orphan revision bodies stay invisible and corrupted committed payloads stop reading', async () => {
  const server = new FakeWebDavServer()
  const capabilities = await probeWebDavCapabilities(client(server))
  const vault = metadata(capabilities)
  const repository = new WebDavVaultRepository(client(server))
  await repository.initialize(vault)
  await client(server).put(
    `/LemonNewTab/generations/${vault.generationId}/revisions/orphan.json`,
    canonicalJson(await revision(vault)),
    { ifNoneMatch: '*' },
  )
  assert.deepEqual(await repository.listCommits(vault), [])

  const commit = await repository.publishRevision(vault, await revision(vault))
  server.corruptPath = `/dav/LemonNewTab/${commit.payloadPath}`
  await assert.rejects(
    repository.readCommittedPayload(commit),
    (error: unknown) => error instanceof WebDavError && error.category === 'corrupted',
  )
})

test('wallpaper assets use SHA-256 names and are verified after upload and download', async () => {
  const server = new FakeWebDavServer()
  const capabilities = await probeWebDavCapabilities(client(server))
  const vault = metadata(capabilities)
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
  const capabilities = await probeWebDavCapabilities(client(server))
  const base = metadata(capabilities)
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
  const initialized = await repository.initialize(encryptedMetadata)
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

  const nextGenerationId = '77777777-7777-4777-8777-777777777777'
  const nextEncryption = await createVaultEncryption(
    'new independent password',
    base.vaultId,
    nextGenerationId,
  )
  const next: VaultMetadataV1 = {
    ...encryptedMetadata,
    generationId: nextGenerationId,
    encryption: nextEncryption.metadata,
  }
  await repository.prepareGeneration(next)
  await repository.activateGeneration(encryptedMetadata, initialized.etag, next)
  await repository.deleteObsoleteGeneration(next, encryptedMetadata.generationId)
  assert.equal(
    [...server.resources.keys()].some((path) => path.includes(encryptedMetadata.generationId)),
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

test('history cleanup keeps the newest versions and refuses unresolved branches', async () => {
  const server = new FakeWebDavServer()
  const capabilities = await probeWebDavCapabilities(client(server))
  const vault = metadata(capabilities)
  const repository = new WebDavVaultRepository(client(server))
  await repository.initialize(vault)
  const ids = [
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000004',
  ]
  const revisions: SyncRevisionV1[] = []
  for (let index = 0; index < ids.length; index += 1) {
    const value = await revision(
      vault,
      ids[index],
      index === 0 ? [] : [ids[index - 1]!],
      `2026-08-0${index + 1}T00:00:00.000Z`,
    )
    revisions.push(value)
    await repository.publishRevision(vault, value)
  }
  const result = await repository.pruneHistory(vault, revisions, 2)
  assert.deepEqual(result, { deletedAssets: 0, deletedRevisions: 2, skipped: false })
  assert.deepEqual(
    (await repository.listCommits(vault)).map((commit) => commit.revisionId).sort(),
    ids.slice(2),
  )

  const branch = await revision(
    vault,
    '20000000-0000-4000-8000-000000000001',
    [ids[2]!],
    '2026-08-05T00:00:00.000Z',
  )
  await repository.publishRevision(vault, branch)
  const retained = [revisions[2]!, revisions[3]!, branch]
  assert.equal((await repository.pruneHistory(vault, retained, 2)).skipped, true)
})
