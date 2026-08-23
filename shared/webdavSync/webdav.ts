import { DOMParser, type Element } from '@xmldom/xmldom'

import { canonicalJson, hashCanonicalJson, jsonEquals, sha256Hex } from './canonical.ts'
import { MAX_PBKDF2_ITERATIONS, MIN_PBKDF2_ITERATIONS } from './crypto.ts'
import {
  HISTORY_RETENTION_DAYS,
  MAX_HISTORY_VERSIONS,
  MIN_COMPLETE_HISTORY_VERSIONS,
  ORPHAN_RESOURCE_GRACE_MS,
} from './lifecycle.ts'
import type { AssetReferenceV1, CommitRecordV1, SyncRevisionV1, VaultMetadataV1 } from './types.ts'
import {
  MAX_METADATA_BYTES,
  MAX_REVISION_BYTES,
  validateCommitRecord,
  validateSyncRevision,
} from './validation.ts'

const MAX_PROPFIND_BYTES = 5 * 1024 * 1024
const MAX_PROPFIND_ENTRIES = 2048
const MAX_REDIRECTS = 3
const METADATA_TIMEOUT_MS = 30_000
const ASSET_TIMEOUT_MS = 120_000
const PRODUCT_ID = 'lemon-new-tab'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8', { fatal: true })

export type WebDavErrorCategory =
  | 'authentication'
  | 'conflict'
  | 'corrupted'
  | 'forbidden'
  | 'foreign-vault'
  | 'format-too-new'
  | 'generation-reset'
  | 'insecure-http'
  | 'insecure-redirect'
  | 'encryption-locked'
  | 'invalid-response'
  | 'locked'
  | 'network'
  | 'not-found'
  | 'precondition'
  | 'rate-limited'
  | 'redirect-cross-origin'
  | 'response-too-large'
  | 'server'
  | 'storage-full'
  | 'timeout'
  | 'unsupported'

export class WebDavError extends Error {
  readonly category: WebDavErrorCategory
  readonly status?: number
  readonly redirectOrigin?: string

  constructor(
    category: WebDavErrorCategory,
    message: string,
    status?: number,
    redirectOrigin?: string,
  ) {
    super(message)
    this.name = 'WebDavError'
    this.category = category
    this.status = status
    this.redirectOrigin = redirectOrigin
  }
}

export interface SerializedWebDavError {
  category: WebDavErrorCategory
  status?: number
}

/** 只跨扩展消息边界传递决策所需字段，避免带出地址或凭据。 */
export function serializeWebDavError(error: WebDavError): SerializedWebDavError {
  return {
    category: error.category,
    ...(error.status === undefined ? {} : { status: error.status }),
  }
}

export function deserializeWebDavError(error: SerializedWebDavError): WebDavError {
  return new WebDavError(error.category, 'WebDAV connection test failed', error.status)
}

export interface WebDavConnection {
  baseUrl: string
  username: string
  password: string
  insecureHttpApproval?: 'local-warning'
}

export interface WebDavEntry {
  url: string
  name: string
  isCollection: boolean
  contentLength?: number
  lastModified?: string
}

export interface WebDavPutOptions {
  contentType?: string
  timeoutMs?: number
}

export interface StoredDevicePayload {
  bytes: Uint8Array<ArrayBuffer>
  deviceId: string
}

export type WebDavMultiStatusParser = (xml: string, requestUrl: URL) => WebDavEntry[]

export type WebDavVaultInspection =
  | { state: 'missing' | 'empty' }
  | { state: 'foreign' }
  | { state: 'ready'; metadata: VaultMetadataV1 }

/** 将“库已删除”与“连接到了另一个库”保留为两个可恢复的状态。 */
export function requireConfiguredVaultInspection(
  inspection: WebDavVaultInspection,
  expected: Partial<Pick<VaultMetadataV1, 'generationId' | 'vaultId'>>,
): Extract<WebDavVaultInspection, { state: 'ready' }> {
  if (inspection.state === 'missing' || inspection.state === 'empty') {
    throw new WebDavError('not-found', 'Configured WebDAV vault was deleted')
  }
  if (
    inspection.state !== 'ready' ||
    (expected.vaultId && inspection.metadata.vaultId !== expected.vaultId) ||
    (expected.generationId && inspection.metadata.generationId !== expected.generationId)
  ) {
    throw new WebDavError('foreign-vault', 'Configured WebDAV vault identity changed')
  }
  return inspection
}

function isPrivateIpv4(hostname: string): boolean {
  const values = hostname.split('.').map(Number)
  if (
    values.length !== 4 ||
    values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return false
  }
  const [a, b] = values as [number, number, number, number]
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  )
}

export function classifyWebDavAddress(value: string): {
  origin: string
  permissionOrigin: string
  transport: 'https' | 'local-http'
} {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new WebDavError('invalid-response', 'WebDAV address is invalid')
  }
  if (url.username || url.password || url.hash || url.search) {
    throw new WebDavError('invalid-response', 'WebDAV address contains unsupported URL parts')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new WebDavError('invalid-response', 'WebDAV address must use HTTP or HTTPS')
  }
  const localHttp =
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' ||
      url.hostname.endsWith('.local') ||
      isPrivateIpv4(url.hostname) ||
      isPrivateIpv6(url.hostname))
  if (url.protocol === 'http:' && !localHttp) {
    throw new WebDavError('insecure-http', 'Public HTTP WebDAV addresses are not supported')
  }
  return {
    origin: url.origin,
    permissionOrigin: `${url.origin}/*`,
    transport: url.protocol === 'https:' ? 'https' : 'local-http',
  }
}

function normalizeBaseUrl(connection: WebDavConnection): URL {
  const assessment = classifyWebDavAddress(connection.baseUrl)
  const approved =
    assessment.transport === 'https' ||
    (assessment.transport === 'local-http' && connection.insecureHttpApproval === 'local-warning')
  if (!approved) {
    throw new WebDavError('insecure-http', 'HTTP WebDAV requires explicit risk confirmation')
  }
  if (connection.username.includes(':')) {
    throw new WebDavError('invalid-response', 'WebDAV username cannot contain a colon')
  }
  const url = new URL(connection.baseUrl)
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

function encodeBasicCredentials(username: string, password: string): string {
  const bytes = textEncoder.encode(`${username}:${password}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

function toRelativePath(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean)
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new WebDavError('invalid-response', 'WebDAV path is invalid')
  }
  return segments.map((segment) => encodeURIComponent(segment)).join('/')
}

function statusError(status: number): WebDavError {
  if (status === 401)
    return new WebDavError('authentication', 'WebDAV authentication failed', status)
  if (status === 403) return new WebDavError('forbidden', 'WebDAV access was denied', status)
  if (status === 404) return new WebDavError('not-found', 'WebDAV resource was not found', status)
  if (status === 409) return new WebDavError('conflict', 'WebDAV directory state changed', status)
  if (status === 412)
    return new WebDavError('precondition', 'WebDAV request precondition failed', status)
  if (status === 423)
    return new WebDavError('locked', 'WebDAV resource is temporarily locked', status)
  if (status === 429)
    return new WebDavError('rate-limited', 'WebDAV rate limit was reached', status)
  if (status === 507) return new WebDavError('storage-full', 'WebDAV storage is full', status)
  if (status >= 500) return new WebDavError('server', 'WebDAV server failed', status)
  return new WebDavError('invalid-response', 'WebDAV returned an unexpected status', status)
}

async function readBoundedBytes(response: Response, maximum: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maximum) {
    throw new WebDavError('response-too-large', 'WebDAV response exceeds its size limit')
  }
  if (!response.body) return new Uint8Array()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > maximum) {
      await reader.cancel()
      throw new WebDavError('response-too-large', 'WebDAV response exceeds its size limit')
    }
    chunks.push(value)
  }
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function directText(element: Element | undefined): string | undefined {
  const value = element?.textContent?.trim()
  return value || undefined
}

function firstDavElement(parent: Element, localName: string): Element | undefined {
  const namespaced = parent.getElementsByTagNameNS('DAV:', localName)[0]
  if (namespaced) return namespaced
  return [...parent.getElementsByTagNameNS('*', localName)][0]
}

export function parseWebDavMultiStatus(xml: string, requestUrl: URL): WebDavEntry[] {
  let document: ReturnType<DOMParser['parseFromString']>
  try {
    document = new DOMParser({
      onError(level, message) {
        if (level !== 'warning') throw new Error(message)
      },
    }).parseFromString(xml, 'application/xml')
  } catch {
    throw new WebDavError('invalid-response', 'WebDAV returned malformed XML')
  }
  if (document.getElementsByTagName('parsererror').length > 0) {
    throw new WebDavError('invalid-response', 'WebDAV returned malformed XML')
  }
  const responseElements = [
    ...document.getElementsByTagNameNS('DAV:', 'response'),
    ...document.getElementsByTagNameNS('*', 'response'),
  ]
  const uniqueElements = [...new Set(responseElements)]
  if (uniqueElements.length > MAX_PROPFIND_ENTRIES) {
    throw new WebDavError('response-too-large', 'WebDAV directory contains too many entries')
  }

  return uniqueElements.map((element) => {
    const href = directText(firstDavElement(element, 'href'))
    if (!href) throw new WebDavError('invalid-response', 'WebDAV entry is missing its path')
    const entryUrl = new URL(href, requestUrl)
    if (entryUrl.origin !== requestUrl.origin) {
      throw new WebDavError('invalid-response', 'WebDAV entry points outside the server origin')
    }
    const pathname = entryUrl.pathname.replace(/\/$/, '')
    let name = pathname.slice(pathname.lastIndexOf('/') + 1)
    try {
      name = decodeURIComponent(name)
    } catch {
      throw new WebDavError('invalid-response', 'WebDAV entry path is malformed')
    }
    const resourceType = firstDavElement(element, 'resourcetype')
    const collection = resourceType && firstDavElement(resourceType, 'collection')
    const lengthText = directText(firstDavElement(element, 'getcontentlength'))
    const contentLength = lengthText === undefined ? undefined : Number(lengthText)
    return {
      url: entryUrl.toString(),
      name,
      isCollection: Boolean(collection),
      lastModified: directText(firstDavElement(element, 'getlastmodified')),
      ...(Number.isFinite(contentLength) ? { contentLength } : {}),
    }
  })
}

export class WebDavClient {
  private readonly baseUrl: URL
  private readonly authorization: string
  private readonly fetchImpl: typeof fetch
  private readonly parseMultiStatus: WebDavMultiStatusParser

  constructor(
    connection: WebDavConnection,
    fetchImpl: typeof fetch = fetch,
    parseMultiStatus: WebDavMultiStatusParser = parseWebDavMultiStatus,
  ) {
    this.baseUrl = normalizeBaseUrl(connection)
    this.authorization = encodeBasicCredentials(connection.username, connection.password)
    this.fetchImpl = fetchImpl.bind(globalThis)
    this.parseMultiStatus = parseMultiStatus
  }

  resolve(path: string): URL {
    return new URL(toRelativePath(path), this.baseUrl)
  }

  async get(path: string, maximum = MAX_METADATA_BYTES, timeoutMs = METADATA_TIMEOUT_MS) {
    const response = await this.request('GET', path, { timeoutMs })
    if (!response.ok) throw statusError(response.status)
    return { bytes: await readBoundedBytes(response, maximum) }
  }

  async put(
    path: string,
    body: string | Uint8Array,
    options: WebDavPutOptions = {},
  ): Promise<void> {
    const headers = new Headers({
      'Content-Type': options.contentType ?? 'application/octet-stream',
    })
    const response = await this.request('PUT', path, {
      body,
      headers,
      timeoutMs: options.timeoutMs ?? METADATA_TIMEOUT_MS,
    })
    if (!response.ok) throw statusError(response.status)
  }

  async delete(path: string, ignoreMissing = false): Promise<void> {
    const response = await this.request('DELETE', path, { timeoutMs: METADATA_TIMEOUT_MS })
    if (ignoreMissing && response.status === 404) return
    if (!response.ok) throw statusError(response.status)
  }

  async makeCollection(path: string): Promise<void> {
    const response = await this.request('MKCOL', path, { timeoutMs: METADATA_TIMEOUT_MS })
    if (response.status === 405) return
    if (!response.ok) throw statusError(response.status)
  }

  async ensureCollection(path: string): Promise<void> {
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
    for (let index = 1; index <= parts.length; index += 1) {
      await this.makeCollection(parts.slice(0, index).join('/'))
    }
  }

  async list(path: string): Promise<WebDavEntry[]> {
    const headers = new Headers({ Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' })
    const body =
      '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>'
    const response = await this.request('PROPFIND', path, {
      body,
      headers,
      timeoutMs: METADATA_TIMEOUT_MS,
    })
    if (response.status !== 207) throw statusError(response.status)
    const xml = textDecoder.decode(await readBoundedBytes(response, MAX_PROPFIND_BYTES))
    const entries = this.parseMultiStatus(xml, this.resolve(path))
    if (entries.length > MAX_PROPFIND_ENTRIES) {
      throw new WebDavError('response-too-large', 'WebDAV directory contains too many entries')
    }
    return entries
  }

  private async request(
    method: string,
    path: string,
    options: { body?: string | Uint8Array; headers?: Headers; timeoutMs: number },
  ): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs)
    const headers = new Headers(options.headers)
    headers.set('Authorization', this.authorization)
    let url = this.resolve(path)

    try {
      for (let redirects = 0; ; redirects += 1) {
        let body: string | ArrayBuffer | undefined
        if (typeof options.body === 'string') body = options.body
        else if (options.body) {
          const copy = new Uint8Array(options.body.byteLength)
          copy.set(options.body)
          body = copy.buffer
        }
        const response = await this.fetchImpl(url, {
          method,
          headers,
          body,
          redirect: 'manual',
          signal: controller.signal,
        })
        if (!REDIRECT_STATUSES.has(response.status)) return response
        if (redirects >= MAX_REDIRECTS) {
          throw new WebDavError('invalid-response', 'WebDAV redirected too many times')
        }
        const location = response.headers.get('location')
        if (!location) throw new WebDavError('invalid-response', 'WebDAV redirect has no target')
        const target = new URL(location, url)
        if (target.username || target.password) {
          throw new WebDavError('invalid-response', 'WebDAV redirect contains embedded credentials')
        }
        if (url.protocol === 'https:' && target.protocol === 'http:') {
          throw new WebDavError('insecure-redirect', 'WebDAV attempted to downgrade HTTPS')
        }
        if (target.origin !== this.baseUrl.origin) {
          throw new WebDavError(
            'redirect-cross-origin',
            'WebDAV redirected to another server origin',
            response.status,
            target.origin,
          )
        }
        url = target
      }
    } catch (error) {
      if (error instanceof WebDavError) throw error
      if (controller.signal.aborted) throw new WebDavError('timeout', 'WebDAV request timed out')
      throw new WebDavError('network', 'WebDAV network request failed')
    } finally {
      clearTimeout(timeout)
    }
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
  )
}

export async function probeWebDavAccess(client: WebDavClient): Promise<void> {
  const directory = `.lemon-new-tab-probe-${crypto.randomUUID()}`
  const filename = `probe-${crypto.randomUUID()}.bin`
  const path = `${directory}/${filename}`
  const expected = crypto.getRandomValues(new Uint8Array(32))

  await client.ensureCollection(directory)
  try {
    await client.put(path, expected)
    const stored = await client.get(path, expected.byteLength)
    if (!sameBytes(stored.bytes, expected)) {
      throw new WebDavError('unsupported', 'WebDAV cannot reliably read a unique test file')
    }
    const listed = await client.list(directory)
    if (!listed.some((entry) => entry.name === filename)) {
      throw new WebDavError('unsupported', 'WebDAV cannot reliably enumerate unique files')
    }
  } finally {
    await client.delete(path, true).catch(() => undefined)
    await client.delete(directory, true).catch(() => undefined)
  }
}

function normalizeVaultDirectory(directory: string): string {
  const normalized = directory.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!normalized || normalized.split('/').some((part) => part === '.' || part === '..')) {
    throw new WebDavError('invalid-response', 'WebDAV vault directory is invalid')
  }
  return normalized
}

function parseJson(bytes: Uint8Array, kind: string): unknown {
  try {
    return JSON.parse(textDecoder.decode(bytes))
  } catch {
    throw new WebDavError('corrupted', `${kind} is not valid JSON`)
  }
}

function validateVaultMetadata(value: unknown): VaultMetadataV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WebDavError('foreign-vault', 'WebDAV directory has no valid ownership marker')
  }
  const record = value as Record<string, unknown>
  if (record.product !== PRODUCT_ID) {
    throw new WebDavError('foreign-vault', 'WebDAV directory belongs to another application')
  }
  if (typeof record.formatVersion === 'number' && record.formatVersion > 1) {
    throw new WebDavError('format-too-new', 'WebDAV vault format is newer than this extension')
  }
  const encryption = record.encryption as Record<string, unknown> | undefined
  const validEncryption =
    record.encrypted === false
      ? encryption === undefined
      : encryption?.algorithm === 'AES-256-GCM' &&
        encryption.kdf === 'PBKDF2-HMAC-SHA-256' &&
        typeof encryption.iterations === 'number' &&
        Number.isSafeInteger(encryption.iterations) &&
        encryption.iterations >= MIN_PBKDF2_ITERATIONS &&
        encryption.iterations <= MAX_PBKDF2_ITERATIONS &&
        typeof encryption.salt === 'string' &&
        encryption.salt.length >= 20 &&
        encryption.salt.length <= 64 &&
        typeof encryption.keyCheck === 'string' &&
        encryption.keyCheck.length >= 40 &&
        encryption.keyCheck.length <= 256
  const valid =
    record.formatVersion === 1 &&
    typeof record.vaultId === 'string' &&
    UUID_PATTERN.test(record.vaultId) &&
    typeof record.generationId === 'string' &&
    UUID_PATTERN.test(record.generationId) &&
    typeof record.encrypted === 'boolean' &&
    validEncryption
  if (!valid) throw new WebDavError('corrupted', 'WebDAV ownership marker is invalid')
  return value as VaultMetadataV1
}

export class WebDavVaultRepository {
  readonly directory: string
  private readonly client: WebDavClient

  constructor(client: WebDavClient, directory = 'LemonNewTab') {
    this.client = client
    this.directory = normalizeVaultDirectory(directory)
  }

  async inspect(): Promise<WebDavVaultInspection> {
    try {
      const { bytes } = await this.client.get(`${this.directory}/vault.json`)
      return { state: 'ready', metadata: validateVaultMetadata(parseJson(bytes, 'Vault marker')) }
    } catch (error) {
      if (!(error instanceof WebDavError) || error.category !== 'not-found') throw error
    }

    let entries: WebDavEntry[]
    try {
      entries = await this.client.list(this.directory)
    } catch (error) {
      if (error instanceof WebDavError && error.category === 'not-found') return { state: 'missing' }
      throw error
    }
    const collectionUrl = this.client.resolve(this.directory).toString().replace(/\/$/, '')
    const hasChildren = entries.some((entry) => entry.url.replace(/\/$/, '') !== collectionUrl)
    return { state: hasChildren ? 'foreign' : 'empty' }
  }

  async initialize(metadata: VaultMetadataV1): Promise<void> {
    if (validateVaultMetadata(metadata).product !== PRODUCT_ID) {
      throw new WebDavError('foreign-vault', 'WebDAV ownership marker is invalid')
    }
    const inspection = await this.inspect()
    if (inspection.state === 'ready') {
      if (inspection.metadata.vaultId !== metadata.vaultId) {
        throw new WebDavError('foreign-vault', 'WebDAV directory already contains another vault')
      }
      return
    }
    if (inspection.state === 'foreign') {
      throw new WebDavError('foreign-vault', 'WebDAV directory is not empty')
    }

    await this.prepareGeneration(metadata)
    await this.client.ensureCollection(`${this.directory}/control`)
    await this.client.put(`${this.directory}/vault.json`, canonicalJson(metadata), {
      contentType: 'application/json',
    })
    const verified = await this.inspect()
    if (verified.state !== 'ready' || verified.metadata.vaultId !== metadata.vaultId) {
      throw new WebDavError('corrupted', 'WebDAV ownership marker could not be verified')
    }
  }

  async prepareGeneration(metadata: VaultMetadataV1): Promise<void> {
    validateVaultMetadata(metadata)
    const generationRoot = `${this.directory}/generations/${metadata.generationId}`
    await this.client.ensureCollection(`${generationRoot}/commits`)
    await this.client.ensureCollection(`${generationRoot}/revisions`)
    await this.client.ensureCollection(`${generationRoot}/assets`)
    await this.client.ensureCollection(`${generationRoot}/devices`)
  }

  async publishRevision(
    metadata: VaultMetadataV1,
    revision: SyncRevisionV1,
    storedPayload = textEncoder.encode(canonicalJson(revision)),
  ): Promise<CommitRecordV1> {
    const validation = validateSyncRevision(revision)
    if (!validation.ok) throw new WebDavError('corrupted', validation.error)
    if ((await hashCanonicalJson(revision.snapshot)) !== revision.snapshotHash) {
      throw new WebDavError('corrupted', 'Revision snapshot hash is invalid')
    }
    if (revision.vaultId !== metadata.vaultId || revision.generationId !== metadata.generationId) {
      throw new WebDavError('corrupted', 'Revision does not belong to the active vault generation')
    }
    if (storedPayload.byteLength > MAX_REVISION_BYTES + 64 * 1024) {
      throw new WebDavError('response-too-large', 'Revision payload exceeds its size limit')
    }

    const revisionPath = `${this.directory}/generations/${metadata.generationId}/revisions/${revision.revisionId}.${metadata.encrypted ? 'bin' : 'json'}`
    const commitPath = `${this.directory}/generations/${metadata.generationId}/commits/${revision.revisionId}.json`
    const payloadHash = await sha256Hex(storedPayload)
    await this.putImmutable(revisionPath, storedPayload, payloadHash)

    const commit: CommitRecordV1 = {
      formatVersion: 1,
      vaultId: metadata.vaultId,
      generationId: metadata.generationId,
      revisionId: revision.revisionId,
      payloadPath: revisionPath.slice(this.directory.length + 1),
      payloadHash,
      payloadSize: storedPayload.byteLength,
      encrypted: metadata.encrypted,
      scope: { ...revision.snapshot.scope },
      complete: true,
    }
    const commitText = canonicalJson(commit)
    await this.putImmutable(commitPath, textEncoder.encode(commitText), await sha256Hex(commitText))
    return commit
  }

  async hasPublishedRevision(
    metadata: VaultMetadataV1,
    revision: SyncRevisionV1,
    storedPayload = textEncoder.encode(canonicalJson(revision)),
  ): Promise<boolean> {
    const commit = (await this.listCommits(metadata)).find(
      (item) => item.revisionId === revision.revisionId,
    )
    if (!commit) return false
    const revisionPath = `generations/${metadata.generationId}/revisions/${revision.revisionId}.${metadata.encrypted ? 'bin' : 'json'}`
    const expected: CommitRecordV1 = {
      formatVersion: 1,
      vaultId: metadata.vaultId,
      generationId: metadata.generationId,
      revisionId: revision.revisionId,
      payloadPath: revisionPath,
      payloadHash: await sha256Hex(storedPayload),
      payloadSize: storedPayload.byteLength,
      encrypted: metadata.encrypted,
      scope: { ...revision.snapshot.scope },
      complete: true,
    }
    if (!jsonEquals(commit, expected)) return false
    await this.readCommittedPayload(commit)
    return true
  }

  async publishAsset(
    metadata: VaultMetadataV1,
    role: AssetReferenceV1['role'],
    blob: Blob,
  ): Promise<AssetReferenceV1> {
    if (blob.size > 20 * 1024 * 1024 || !blob.type.toLowerCase().startsWith('image/')) {
      throw new WebDavError('response-too-large', 'Wallpaper asset is unsupported or too large')
    }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const sha256 = await sha256Hex(bytes)
    const id = `sha256-${sha256}`
    const path = `generations/${metadata.generationId}/assets/${id}.blob`
    await this.putImmutable(`${this.directory}/${path}`, bytes, sha256, ASSET_TIMEOUT_MS)
    return { id, path, role, size: bytes.byteLength, mimeType: blob.type, sha256 }
  }

  async publishEncryptedAsset(
    metadata: VaultMetadataV1,
    role: AssetReferenceV1['role'],
    blob: Blob,
    storageId: string,
    storedPayload: Uint8Array<ArrayBuffer>,
  ): Promise<AssetReferenceV1> {
    if (!metadata.encrypted || !UUID_PATTERN.test(storageId)) {
      throw new WebDavError('invalid-response', 'Encrypted wallpaper target is invalid')
    }
    if (blob.size > 20 * 1024 * 1024 || !blob.type.toLowerCase().startsWith('image/')) {
      throw new WebDavError('response-too-large', 'Wallpaper asset is unsupported or too large')
    }
    if (storedPayload.byteLength > blob.size + 64 * 1024) {
      throw new WebDavError('response-too-large', 'Encrypted wallpaper exceeds its size limit')
    }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const sha256 = await sha256Hex(bytes)
    const id = `sha256-${sha256}`
    const path = `generations/${metadata.generationId}/assets/${storageId}.bin`
    await this.putImmutable(
      `${this.directory}/${path}`,
      storedPayload,
      await sha256Hex(storedPayload),
      ASSET_TIMEOUT_MS,
    )
    return { id, path, role, size: bytes.byteLength, mimeType: blob.type, sha256 }
  }

  async readAsset(asset: AssetReferenceV1): Promise<Blob> {
    const { bytes } = await this.client.get(
      `${this.directory}/${asset.path}`,
      asset.size,
      ASSET_TIMEOUT_MS,
    )
    if (bytes.byteLength !== asset.size || (await sha256Hex(bytes)) !== asset.sha256) {
      throw new WebDavError('corrupted', 'Wallpaper asset failed integrity validation')
    }
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return new Blob([copy.buffer], { type: asset.mimeType })
  }

  async readEncryptedAsset(asset: AssetReferenceV1): Promise<Uint8Array<ArrayBuffer>> {
    const { bytes } = await this.client.get(
      `${this.directory}/${asset.path}`,
      asset.size + 64 * 1024,
      ASSET_TIMEOUT_MS,
    )
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return copy
  }

  async readCommittedPayload(commit: CommitRecordV1): Promise<Uint8Array<ArrayBuffer>> {
    const validation = validateCommitRecord(commit)
    if (!validation.ok) throw new WebDavError('corrupted', validation.error)
    let bytes: Uint8Array<ArrayBuffer>
    try {
      bytes = await this.readStoredPayloadUnchecked(commit)
    } catch (error) {
      if (error instanceof WebDavError && error.category === 'not-found') {
        throw new WebDavError('corrupted', 'Committed revision payload is missing')
      }
      throw error
    }
    if (
      bytes.byteLength !== commit.payloadSize ||
      (await sha256Hex(bytes)) !== commit.payloadHash
    ) {
      throw new WebDavError('corrupted', 'Committed revision payload failed integrity validation')
    }
    return bytes
  }

  async readStoredPayloadUnchecked(commit: CommitRecordV1): Promise<Uint8Array<ArrayBuffer>> {
    const validation = validateCommitRecord(commit)
    if (!validation.ok) throw new WebDavError('corrupted', validation.error)
    const path = `${this.directory}/${commit.payloadPath}`
    const result = await this.client.get(path, commit.payloadSize + 1)
    const copy = new Uint8Array(result.bytes.byteLength)
    copy.set(result.bytes)
    return copy
  }

  async writeDevicePayload(
    metadata: VaultMetadataV1,
    deviceId: string,
    bytes: Uint8Array<ArrayBuffer>,
  ): Promise<void> {
    if (!UUID_PATTERN.test(deviceId) || bytes.byteLength > MAX_METADATA_BYTES) {
      throw new WebDavError('invalid-response', 'Device record is invalid')
    }
    const extension = metadata.encrypted ? 'bin' : 'json'
    const path = `${this.directory}/generations/${metadata.generationId}/devices/${deviceId}.${extension}`
    await this.client.put(path, bytes, { timeoutMs: METADATA_TIMEOUT_MS })
    const stored = await this.client.get(path, bytes.byteLength, METADATA_TIMEOUT_MS)
    if (
      stored.bytes.byteLength !== bytes.byteLength ||
      (await sha256Hex(stored.bytes)) !== (await sha256Hex(bytes))
    ) {
      throw new WebDavError('corrupted', 'Device record could not be verified')
    }
  }

  async listDevicePayloads(metadata: VaultMetadataV1): Promise<StoredDevicePayload[]> {
    const root = `${this.directory}/generations/${metadata.generationId}/devices`
    const extension = metadata.encrypted ? 'bin' : 'json'
    const entries = (await this.client.list(root)).filter(
      (entry) => !entry.isCollection && entry.name.endsWith(`.${extension}`),
    )
    if (entries.length > 256) throw new WebDavError('response-too-large', 'Too many device records')
    const result: StoredDevicePayload[] = []
    for (const entry of entries) {
      const deviceId = entry.name.slice(0, -(extension.length + 1))
      if (!UUID_PATTERN.test(deviceId)) {
        throw new WebDavError('corrupted', 'Device record name is invalid')
      }
      const stored = await this.client.get(`${root}/${entry.name}`, MAX_METADATA_BYTES)
      const bytes = new Uint8Array(stored.bytes.byteLength)
      bytes.set(stored.bytes)
      result.push({ bytes, deviceId })
    }
    return result
  }

  async readRevision(commit: CommitRecordV1): Promise<SyncRevisionV1> {
    if (commit.encrypted) {
      throw new WebDavError('unsupported', 'Encrypted revision must be unlocked before parsing')
    }
    const payload = await this.readCommittedPayload(commit)
    const validation = validateSyncRevision(parseJson(payload, 'Revision payload'))
    if (!validation.ok) throw new WebDavError('corrupted', validation.error)
    if ((await hashCanonicalJson(validation.value.snapshot)) !== validation.value.snapshotHash) {
      throw new WebDavError('corrupted', 'Revision snapshot hash is invalid')
    }
    return validation.value
  }

  async listCommits(metadata: VaultMetadataV1): Promise<CommitRecordV1[]> {
    const path = `${this.directory}/generations/${metadata.generationId}/commits`
    const entries = await this.client.list(path)
    const files = entries.filter((entry) => !entry.isCollection && /\.json$/i.test(entry.name))
    const commits: CommitRecordV1[] = []
    for (const entry of files) {
      const { bytes } = await this.client.get(`${path}/${entry.name}`)
      const validation = validateCommitRecord(parseJson(bytes, 'Commit record'))
      if (!validation.ok) throw new WebDavError('corrupted', validation.error)
      if (
        validation.value.vaultId !== metadata.vaultId ||
        validation.value.generationId !== metadata.generationId
      ) {
        throw new WebDavError('corrupted', 'Commit record belongs to another vault generation')
      }
      commits.push(validation.value)
    }
    return commits
  }

  async deleteOwnedVault(expectedVaultId: string): Promise<void> {
    const inspection = await this.inspect()
    if (inspection.state !== 'ready' || inspection.metadata.vaultId !== expectedVaultId) {
      throw new WebDavError('foreign-vault', 'WebDAV vault ownership could not be verified')
    }
    await this.client.delete(this.directory)
  }

  async deleteRevision(metadata: VaultMetadataV1, revisionId: string): Promise<void> {
    const root = `${this.directory}/generations/${metadata.generationId}`
    await this.client.delete(`${root}/commits/${revisionId}.json`, true)
    await this.client.delete(
      `${root}/revisions/${revisionId}.${metadata.encrypted ? 'bin' : 'json'}`,
      true,
    )
  }

  async deleteAsset(asset: AssetReferenceV1): Promise<void> {
    if (!asset.path.includes('/assets/')) {
      throw new WebDavError('invalid-response', 'Asset path is outside the asset directory')
    }
    await this.client.delete(`${this.directory}/${asset.path}`, true)
  }

  async pruneHistory(
    metadata: VaultMetadataV1,
    revisions: readonly SyncRevisionV1[],
  ): Promise<{ deletedAssets: number; deletedRevisions: number; skipped: boolean }> {
    const parentIds = new Set(revisions.flatMap((revision) => revision.parentRevisionIds))
    const headRevisions = revisions.filter((revision) => !parentIds.has(revision.revisionId))
    if (headRevisions.length !== 1) {
      return { deletedAssets: 0, deletedRevisions: 0, skipped: true }
    }

    const root = `${this.directory}/generations/${metadata.generationId}`
    const commitEntries = (await this.client.list(`${root}/commits`)).filter(
      (entry) => !entry.isCollection && entry.name.endsWith('.json'),
    )
    const commitEntryById = new Map(commitEntries.map((entry) => [entry.name.slice(0, -5), entry]))
    const before = await this.listCommits(metadata)
    const expectedIds = new Set(revisions.map((revision) => revision.revisionId))
    if (
      before.length !== expectedIds.size ||
      before.some((commit) => !expectedIds.has(commit.revisionId)) ||
      commitEntryById.size !== expectedIds.size
    ) {
      return { deletedAssets: 0, deletedRevisions: 0, skipped: true }
    }

    const byId = new Map(revisions.map((revision) => [revision.revisionId, revision]))
    const distances = new Map<string, number>([[headRevisions[0]!.revisionId, 0]])
    const queue = [headRevisions[0]!.revisionId]
    while (queue.length) {
      const id = queue.shift()!
      const distance = distances.get(id)!
      for (const parent of byId.get(id)?.parentRevisionIds ?? []) {
        const previous = distances.get(parent)
        if (previous === undefined || previous > distance + 1) {
          distances.set(parent, distance + 1)
          queue.push(parent)
        }
      }
    }
    const ordered = [...revisions].sort(
      (left, right) =>
        (distances.get(left.revisionId) ?? Number.MAX_SAFE_INTEGER) -
          (distances.get(right.revisionId) ?? Number.MAX_SAFE_INTEGER) ||
        left.revisionId.localeCompare(right.revisionId),
    )
    const protectedIds = new Set(
      ordered.slice(0, MIN_COMPLETE_HISTORY_VERSIONS).map((revision) => revision.revisionId),
    )
    const countKeep = new Set(
      ordered.slice(0, MAX_HISTORY_VERSIONS).map((revision) => revision.revisionId),
    )
    const cutoff = Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000
    const removing = revisions.filter((revision) => {
      if (protectedIds.has(revision.revisionId)) return false
      if (!countKeep.has(revision.revisionId)) return true
      const modified = Date.parse(commitEntryById.get(revision.revisionId)?.lastModified ?? '')
      return Number.isFinite(modified) && modified < cutoff
    })
    const keep = new Set(
      revisions
        .filter((revision) => !removing.includes(revision))
        .map((revision) => revision.revisionId),
    )
    for (const revision of removing) await this.deleteRevision(metadata, revision.revisionId)

    const remainingCommits = await this.listCommits(metadata)
    if (
      remainingCommits.length !== keep.size ||
      remainingCommits.some((commit) => !keep.has(commit.revisionId))
    ) {
      return { deletedAssets: 0, deletedRevisions: removing.length, skipped: true }
    }
    const retainedAssets = new Set(
      revisions
        .filter((revision) => keep.has(revision.revisionId))
        .flatMap((revision) => revision.assets.map((asset) => asset.path)),
    )
    const graceCutoff = Date.now() - ORPHAN_RESOURCE_GRACE_MS
    let deletedAssets = 0
    const assetRoot = `${root}/assets`
    for (const entry of await this.client.list(assetRoot)) {
      if (entry.isCollection) continue
      const path = `generations/${metadata.generationId}/assets/${entry.name}`
      const modified = Date.parse(entry.lastModified ?? '')
      if (!retainedAssets.has(path) && Number.isFinite(modified) && modified < graceCutoff) {
        await this.client.delete(`${assetRoot}/${entry.name}`, true)
        deletedAssets += 1
      }
    }
    const revisionRoot = `${root}/revisions`
    for (const entry of await this.client.list(revisionRoot)) {
      if (entry.isCollection) continue
      const id = entry.name.replace(/\.(?:bin|json)$/i, '')
      const modified = Date.parse(entry.lastModified ?? '')
      if (!keep.has(id) && Number.isFinite(modified) && modified < graceCutoff) {
        await this.client.delete(`${revisionRoot}/${entry.name}`, true)
      }
    }
    const deviceCutoff = Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000
    const deviceRoot = `${root}/devices`
    for (const entry of await this.client.list(deviceRoot)) {
      const modified = Date.parse(entry.lastModified ?? '')
      if (!entry.isCollection && Number.isFinite(modified) && modified < deviceCutoff) {
        await this.client.delete(`${deviceRoot}/${entry.name}`, true)
      }
    }
    return {
      deletedAssets,
      deletedRevisions: removing.length,
      skipped: false,
    }
  }

  private async putImmutable(
    path: string,
    bytes: Uint8Array,
    expectedHash: string,
    timeoutMs = METADATA_TIMEOUT_MS,
  ): Promise<void> {
    await this.client.put(path, bytes, { timeoutMs })
    const stored = await this.client.get(path, bytes.byteLength, ASSET_TIMEOUT_MS)
    if (
      stored.bytes.byteLength !== bytes.byteLength ||
      (await sha256Hex(stored.bytes)) !== expectedHash
    ) {
      throw new WebDavError(
        'corrupted',
        'Immutable WebDAV object does not match the pending upload',
      )
    }
  }
}
