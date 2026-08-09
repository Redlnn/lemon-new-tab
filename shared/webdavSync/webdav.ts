import { canonicalJson, hashCanonicalJson, sha256Hex } from './canonical.ts'
import type {
  AssetReferenceV1,
  CommitRecordV1,
  SyncRevisionV1,
  VaultMetadataV1,
  WebDavCapabilitiesV1,
} from './types.ts'
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
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
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

export interface WebDavConnection {
  baseUrl: string
  username: string
  password: string
  insecureHttpApproval?: 'external-confirmation' | 'local-warning'
}

export interface WebDavEntry {
  url: string
  name: string
  isCollection: boolean
  etag?: string
  contentLength?: number
}

export interface WebDavPutOptions {
  contentType?: string
  ifMatch?: string
  ifNoneMatch?: '*'
  timeoutMs?: number
}

export interface WebDavResponseMetadata {
  etag?: string
  status: number
}

export interface StoredDevicePayload {
  bytes: Uint8Array<ArrayBuffer>
  deviceId: string
}

export type WebDavMultiStatusParser = (xml: string, requestUrl: URL) => WebDavEntry[]

export type WebDavVaultInspection =
  | { state: 'missing' | 'empty' }
  | { state: 'foreign' }
  | { state: 'ready'; metadata: VaultMetadataV1; etag?: string }

function isPrivateIpv4(hostname: string): boolean {
  const values = hostname.split('.').map(Number)
  if (values.length !== 4 || values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
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
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')
}

export function classifyWebDavAddress(value: string): {
  origin: string
  permissionOrigin: string
  transport: 'https' | 'local-http' | 'external-http'
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
  return {
    origin: url.origin,
    permissionOrigin: `${url.origin}/*`,
    transport: url.protocol === 'https:' ? 'https' : localHttp ? 'local-http' : 'external-http',
  }
}

function normalizeBaseUrl(connection: WebDavConnection): URL {
  const assessment = classifyWebDavAddress(connection.baseUrl)
  const approved =
    assessment.transport === 'https' ||
    (assessment.transport === 'local-http' &&
      (connection.insecureHttpApproval === 'local-warning' ||
        connection.insecureHttpApproval === 'external-confirmation')) ||
    (assessment.transport === 'external-http' &&
      connection.insecureHttpApproval === 'external-confirmation')
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
  if (status === 401) return new WebDavError('authentication', 'WebDAV authentication failed', status)
  if (status === 403) return new WebDavError('forbidden', 'WebDAV access was denied', status)
  if (status === 404) return new WebDavError('not-found', 'WebDAV resource was not found', status)
  if (status === 409) return new WebDavError('conflict', 'WebDAV directory state changed', status)
  if (status === 412) return new WebDavError('precondition', 'WebDAV conditional write failed', status)
  if (status === 423) return new WebDavError('locked', 'WebDAV resource is temporarily locked', status)
  if (status === 429) return new WebDavError('rate-limited', 'WebDAV rate limit was reached', status)
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
  const document = new DOMParser().parseFromString(xml, 'application/xml')
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
      etag: directText(firstDavElement(element, 'getetag')),
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
    this.fetchImpl = fetchImpl
    this.parseMultiStatus = parseMultiStatus
  }

  resolve(path: string): URL {
    return new URL(toRelativePath(path), this.baseUrl)
  }

  async get(path: string, maximum = MAX_METADATA_BYTES, timeoutMs = METADATA_TIMEOUT_MS) {
    const response = await this.request('GET', path, { timeoutMs })
    if (!response.ok) throw statusError(response.status)
    return {
      bytes: await readBoundedBytes(response, maximum),
      etag: response.headers.get('etag') ?? undefined,
    }
  }

  async put(
    path: string,
    body: string | Uint8Array,
    options: WebDavPutOptions = {},
  ): Promise<WebDavResponseMetadata> {
    const headers = new Headers({ 'Content-Type': options.contentType ?? 'application/octet-stream' })
    if (options.ifMatch) headers.set('If-Match', options.ifMatch)
    if (options.ifNoneMatch) headers.set('If-None-Match', options.ifNoneMatch)
    const response = await this.request('PUT', path, {
      body,
      headers,
      timeoutMs: options.timeoutMs ?? METADATA_TIMEOUT_MS,
    })
    if (!response.ok) throw statusError(response.status)
    return { status: response.status, etag: response.headers.get('etag') ?? undefined }
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
    const body = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/><d:getcontentlength/></d:prop></d:propfind>'
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

function strongEtag(value: string | undefined): value is string {
  return Boolean(value && !value.startsWith('W/'))
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
}

export async function probeWebDavCapabilities(client: WebDavClient): Promise<WebDavCapabilitiesV1> {
  const directory = `.lemon-new-tab-probe-${crypto.randomUUID()}`
  const filename = `probe-${crypto.randomUUID()}.bin`
  const path = `${directory}/${filename}`
  const first = textEncoder.encode('first')
  const second = textEncoder.encode('second')
  let conditionalCreate = false
  let conditionalUpdate = false

  await client.ensureCollection(directory)
  try {
    let current = await client.put(path, first, { ifNoneMatch: '*' })
    try {
      current = await client.put(path, second, { ifNoneMatch: '*' })
    } catch (error) {
      if (!(error instanceof WebDavError) || error.category !== 'precondition') throw error
      conditionalCreate = true
    }

    const currentRead = await client.get(path, 64)
    const expectedCurrent = conditionalCreate ? first : second
    if (!sameBytes(currentRead.bytes, expectedCurrent)) {
      throw new WebDavError('unsupported', 'WebDAV cannot reliably read a unique test file')
    }
    const listed = await client.list(directory)
    if (!listed.some((entry) => entry.name === filename)) {
      throw new WebDavError('unsupported', 'WebDAV cannot reliably enumerate unique files')
    }

    const etag = currentRead.etag ?? current.etag
    if (strongEtag(etag)) {
      const updated = await client.put(path, first, { ifMatch: etag })
      try {
        await client.put(path, second, { ifMatch: etag })
      } catch (error) {
        if (!(error instanceof WebDavError) || error.category !== 'precondition') throw error
        conditionalUpdate = true
      }
      if (conditionalUpdate) {
        const verified = await client.get(path, 64)
        if (!sameBytes(verified.bytes, first) || (updated.etag && verified.etag !== updated.etag)) {
          throw new WebDavError('unsupported', 'WebDAV conditional update verification failed')
        }
      }
    }

    return {
      conditionalCreate,
      conditionalUpdate,
      mode: conditionalCreate && conditionalUpdate ? 'conditional' : 'safe-degraded',
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
  const capabilities = record.capabilities as Record<string, unknown> | undefined
  const encryption = record.encryption as Record<string, unknown> | undefined
  const validEncryption =
    record.encrypted === false
      ? encryption === undefined
      : encryption?.algorithm === 'AES-256-GCM' &&
        encryption.kdf === 'PBKDF2-HMAC-SHA-256' &&
        typeof encryption.iterations === 'number' &&
        Number.isSafeInteger(encryption.iterations) &&
        encryption.iterations >= 600_000 &&
        typeof encryption.salt === 'string' &&
        encryption.salt.length >= 20 &&
        encryption.salt.length <= 64 &&
        typeof encryption.keyCheck === 'string' &&
        encryption.keyCheck.length >= 40 &&
        encryption.keyCheck.length <= 256
  const modeMatchesCapabilities =
    capabilities?.mode === 'safe-degraded' ||
    (capabilities?.mode === 'conditional' &&
      capabilities.conditionalCreate === true &&
      capabilities.conditionalUpdate === true)
  const reset = record.reset as Record<string, unknown> | undefined
  const validReset =
    reset === undefined ||
    (typeof reset.previousGenerationId === 'string' &&
      UUID_PATTERN.test(reset.previousGenerationId) &&
      typeof reset.resetRevisionId === 'string' &&
      UUID_PATTERN.test(reset.resetRevisionId))
  const valid =
    record.formatVersion === 1 &&
    typeof record.vaultId === 'string' &&
    UUID_PATTERN.test(record.vaultId) &&
    typeof record.generationId === 'string' &&
    UUID_PATTERN.test(record.generationId) &&
    typeof record.encrypted === 'boolean' &&
    validEncryption &&
    validReset &&
    capabilities &&
    typeof capabilities.conditionalCreate === 'boolean' &&
    typeof capabilities.conditionalUpdate === 'boolean' &&
    modeMatchesCapabilities &&
    (record.currentRevisionId === undefined ||
      (typeof record.currentRevisionId === 'string' && UUID_PATTERN.test(record.currentRevisionId)))
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
    let entries: WebDavEntry[]
    try {
      entries = await this.client.list(this.directory)
    } catch (error) {
      if (error instanceof WebDavError && error.category === 'not-found') return { state: 'missing' }
      throw error
    }

    try {
      const { bytes, etag } = await this.client.get(`${this.directory}/vault.json`)
      return { state: 'ready', metadata: validateVaultMetadata(parseJson(bytes, 'Vault marker')), etag }
    } catch (error) {
      if (!(error instanceof WebDavError) || error.category !== 'not-found') throw error
      const collectionUrl = this.client.resolve(this.directory).toString().replace(/\/$/, '')
      const hasChildren = entries.some((entry) => entry.url.replace(/\/$/, '') !== collectionUrl)
      return { state: hasChildren ? 'foreign' : 'empty' }
    }
  }

  async initialize(metadata: VaultMetadataV1): Promise<{ etag?: string }> {
    if (validateVaultMetadata(metadata).product !== PRODUCT_ID) {
      throw new WebDavError('foreign-vault', 'WebDAV ownership marker is invalid')
    }
    const inspection = await this.inspect()
    if (inspection.state === 'ready') {
      if (inspection.metadata.vaultId !== metadata.vaultId) {
        throw new WebDavError('foreign-vault', 'WebDAV directory already contains another vault')
      }
      return { etag: inspection.etag }
    }
    if (inspection.state === 'foreign') {
      throw new WebDavError('foreign-vault', 'WebDAV directory is not empty')
    }

    await this.prepareGeneration(metadata)
    await this.client.ensureCollection(`${this.directory}/control`)
    const result = await this.client.put(`${this.directory}/vault.json`, canonicalJson(metadata), {
      contentType: 'application/json',
      ifNoneMatch: '*',
    })
    const verified = await this.inspect()
    if (verified.state !== 'ready' || verified.metadata.vaultId !== metadata.vaultId) {
      throw new WebDavError('corrupted', 'WebDAV ownership marker could not be verified')
    }
    return { etag: verified.etag ?? result.etag }
  }

  async prepareGeneration(metadata: VaultMetadataV1): Promise<void> {
    validateVaultMetadata(metadata)
    const generationRoot = `${this.directory}/generations/${metadata.generationId}`
    await this.client.ensureCollection(`${generationRoot}/commits`)
    await this.client.ensureCollection(`${generationRoot}/revisions`)
    await this.client.ensureCollection(`${generationRoot}/assets`)
    await this.client.ensureCollection(`${generationRoot}/devices`)
  }

  async activateGeneration(
    current: VaultMetadataV1,
    vaultEtag: string | undefined,
    next: VaultMetadataV1,
  ): Promise<{ metadata: VaultMetadataV1; etag?: string }> {
    validateVaultMetadata(next)
    if (
      current.vaultId !== next.vaultId ||
      current.generationId === next.generationId ||
      current.capabilities.mode !== 'conditional' ||
      next.capabilities.mode !== 'conditional'
    ) {
      throw new WebDavError('unsupported', 'WebDAV generation migration is not safe')
    }
    if (!strongEtag(vaultEtag)) {
      throw new WebDavError('unsupported', 'WebDAV vault marker has no strong ETag')
    }
    const result = await this.client.put(`${this.directory}/vault.json`, canonicalJson(next), {
      contentType: 'application/json',
      ifMatch: vaultEtag,
    })
    const verified = await this.inspect()
    if (
      verified.state !== 'ready' ||
      verified.metadata.vaultId !== next.vaultId ||
      verified.metadata.generationId !== next.generationId
    ) {
      throw new WebDavError('corrupted', 'New WebDAV generation could not be verified')
    }
    return { metadata: verified.metadata, etag: verified.etag ?? result.etag }
  }

  async deleteObsoleteGeneration(
    active: VaultMetadataV1,
    obsoleteGenerationId: string,
  ): Promise<void> {
    if (!UUID_PATTERN.test(obsoleteGenerationId) || obsoleteGenerationId === active.generationId) {
      throw new WebDavError('invalid-response', 'Obsolete generation target is invalid')
    }
    const inspection = await this.inspect()
    if (
      inspection.state !== 'ready' ||
      inspection.metadata.vaultId !== active.vaultId ||
      inspection.metadata.generationId !== active.generationId
    ) {
      throw new WebDavError('precondition', 'Active WebDAV generation changed during cleanup')
    }
    await this.client.delete(
      `${this.directory}/generations/${obsoleteGenerationId}`,
      true,
    )
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
    if (
      revision.vaultId !== metadata.vaultId ||
      revision.generationId !== metadata.generationId
    ) {
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
      complete: true,
    }
    const commitText = canonicalJson(commit)
    await this.putImmutable(commitPath, textEncoder.encode(commitText), await sha256Hex(commitText))
    return commit
  }

  async publishAsset(
    metadata: VaultMetadataV1,
    role: AssetReferenceV1['role'],
    blob: Blob,
  ): Promise<AssetReferenceV1> {
    if (
      blob.size > 20 * 1024 * 1024 ||
      !blob.type.toLowerCase().startsWith('image/')
    ) {
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
    const bytes = await this.readStoredPayloadUnchecked(commit)
    if (bytes.byteLength !== commit.payloadSize || (await sha256Hex(bytes)) !== commit.payloadHash) {
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

  async updateCurrentRevision(
    metadata: VaultMetadataV1,
    vaultEtag: string | undefined,
    revisionId: string,
  ): Promise<{ metadata: VaultMetadataV1; etag?: string }> {
    if (metadata.capabilities.mode === 'safe-degraded') return { metadata, etag: vaultEtag }
    if (!strongEtag(vaultEtag)) {
      throw new WebDavError('unsupported', 'WebDAV vault marker has no strong ETag')
    }
    const next = { ...metadata, currentRevisionId: revisionId }
    const result = await this.client.put(`${this.directory}/vault.json`, canonicalJson(next), {
      contentType: 'application/json',
      ifMatch: vaultEtag,
    })
    return { metadata: next, etag: result.etag }
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
    requestedLimit: number,
  ): Promise<{ deletedAssets: number; deletedRevisions: number; skipped: boolean }> {
    if (metadata.capabilities.mode === 'safe-degraded') {
      return { deletedAssets: 0, deletedRevisions: 0, skipped: true }
    }
    const heads = new Set(revisions.flatMap((revision) => revision.parentRevisionIds))
    const headRevisions = revisions.filter((revision) => !heads.has(revision.revisionId))
    if (headRevisions.length !== 1) {
      return { deletedAssets: 0, deletedRevisions: 0, skipped: true }
    }

    const limit = Math.min(20, Math.max(2, Math.trunc(requestedLimit)))
    const ordered = [...revisions].sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        right.revisionId.localeCompare(left.revisionId),
    )
    const keep = new Set(ordered.slice(0, limit).map((revision) => revision.revisionId))
    keep.add(headRevisions[0]!.revisionId)
    const removing = revisions.filter((revision) => !keep.has(revision.revisionId))
    if (removing.length === 0) {
      return { deletedAssets: 0, deletedRevisions: 0, skipped: false }
    }

    const before = await this.listCommits(metadata)
    const expectedIds = new Set(revisions.map((revision) => revision.revisionId))
    if (before.length !== expectedIds.size || before.some((commit) => !expectedIds.has(commit.revisionId))) {
      return { deletedAssets: 0, deletedRevisions: 0, skipped: true }
    }
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
    const deletedAssets = new Map<string, AssetReferenceV1>()
    for (const revision of removing) {
      for (const asset of revision.assets) {
        if (!retainedAssets.has(asset.path)) deletedAssets.set(asset.path, asset)
      }
    }
    for (const asset of deletedAssets.values()) await this.deleteAsset(asset)
    return {
      deletedAssets: deletedAssets.size,
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
    try {
      await this.client.put(path, bytes, { ifNoneMatch: '*', timeoutMs })
    } catch (error) {
      if (!(error instanceof WebDavError) || error.category !== 'precondition') throw error
    }
    const stored = await this.client.get(path, bytes.byteLength, ASSET_TIMEOUT_MS)
    if (stored.bytes.byteLength !== bytes.byteLength || (await sha256Hex(stored.bytes)) !== expectedHash) {
      throw new WebDavError('corrupted', 'Immutable WebDAV object does not match the pending upload')
    }
  }
}
