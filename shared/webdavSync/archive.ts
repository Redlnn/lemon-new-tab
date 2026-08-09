import { canonicalJson, sha256Hex } from './canonical.ts'
import { MAX_SYNC_WALLPAPER_BYTES } from './catalog.ts'
import type { SyncSnapshotV1, SyncWallpaperV1 } from './types.ts'
import { MAX_REVISION_BYTES, validateSyncSnapshot } from './validation.ts'

const MAGIC = new TextEncoder().encode('LEMONBACKUP\0')
const HEADER_BYTES = MAGIC.byteLength + 8
const FORMAT_VERSION = 1
const MAX_ARCHIVE_BYTES = MAX_REVISION_BYTES + MAX_SYNC_WALLPAPER_BYTES * 2 + 1024 * 1024
const textDecoder = new TextDecoder('utf-8', { fatal: true })
const textEncoder = new TextEncoder()

type WallpaperVariant = 'dark' | 'light'

interface ArchiveResourceV1 {
  id: string
  mimeType: string
  offset: number
  sha256: string
  size: number
  variants: WallpaperVariant[]
}

interface ArchiveManifestV1 {
  product: 'lemon-new-tab'
  formatVersion: 1
  snapshot: SyncSnapshotV1
  resources: ArchiveResourceV1[]
}

export interface ParsedLocalBackup {
  snapshot: SyncSnapshotV1
  wallpapers: Partial<Record<WallpaperVariant, Blob>>
}

function cloneWithoutWallpapers(snapshot: SyncSnapshotV1): SyncSnapshotV1 {
  const result = structuredClone(snapshot)
  if (result.optional?.wallpapers) delete result.optional.wallpapers
  if (result.optional && Object.keys(result.optional).length === 0) delete result.optional
  return result
}

function validateSnapshot(snapshot: unknown): SyncSnapshotV1 {
  const validation = validateSyncSnapshot(snapshot)
  if (!validation.ok) throw new TypeError(validation.error)
  return validation.value
}

export function serializeJsonBackup(snapshot: SyncSnapshotV1): string {
  return canonicalJson({
    product: 'lemon-new-tab',
    formatVersion: FORMAT_VERSION,
    snapshot: validateSnapshot(cloneWithoutWallpapers(snapshot)),
  })
}

export function parseJsonBackup(value: unknown): ParsedLocalBackup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Backup must be an object')
  }
  const record = value as Record<string, unknown>
  if (record.product !== 'lemon-new-tab' || record.formatVersion !== FORMAT_VERSION) {
    throw new TypeError('Backup format is unsupported')
  }
  return { snapshot: validateSnapshot(record.snapshot), wallpapers: {} }
}

export async function createLocalBackupArchive(
  snapshot: SyncSnapshotV1,
  wallpapers: Partial<Record<WallpaperVariant, Blob>>,
): Promise<Blob> {
  const cleaned = structuredClone(snapshot)
  const resources = new Map<string, { blob: Blob; reference: SyncWallpaperV1; variants: WallpaperVariant[] }>()
  for (const variant of ['light', 'dark'] as const) {
    const reference = cleaned.optional?.wallpapers?.[variant]
    const blob = wallpapers[variant]
    if (!reference || !blob || !(await wallpaperMatches(blob, reference))) {
      if (cleaned.optional?.wallpapers) delete cleaned.optional.wallpapers[variant]
      continue
    }
    const existing = resources.get(reference.sha256)
    if (existing) existing.variants.push(variant)
    else resources.set(reference.sha256, { blob, reference, variants: [variant] })
  }
  if (cleaned.optional?.wallpapers && Object.keys(cleaned.optional.wallpapers).length === 0) {
    delete cleaned.optional.wallpapers
  }
  if (cleaned.optional && Object.keys(cleaned.optional).length === 0) delete cleaned.optional
  const validSnapshot = validateSnapshot(cleaned)

  let offset = 0
  const archiveResources: ArchiveResourceV1[] = []
  const bodies: Blob[] = []
  for (const { blob, reference, variants } of resources.values()) {
    archiveResources.push({
      id: reference.assetId,
      mimeType: reference.mimeType,
      offset,
      sha256: reference.sha256,
      size: reference.size,
      variants,
    })
    bodies.push(blob)
    offset += blob.size
  }
  const manifest: ArchiveManifestV1 = {
    product: 'lemon-new-tab',
    formatVersion: FORMAT_VERSION,
    snapshot: validSnapshot,
    resources: archiveResources,
  }
  const manifestBytes = textEncoder.encode(canonicalJson(manifest))
  if (manifestBytes.byteLength > MAX_REVISION_BYTES) throw new TypeError('Backup manifest is too large')
  const header = new Uint8Array(HEADER_BYTES)
  header.set(MAGIC)
  const view = new DataView(header.buffer)
  view.setUint32(MAGIC.byteLength, FORMAT_VERSION, true)
  view.setUint32(MAGIC.byteLength + 4, manifestBytes.byteLength, true)
  return new Blob([header, manifestBytes, ...bodies], {
    type: 'application/vnd.lemon-new-tab.backup',
  })
}

export async function parseLocalBackupArchive(file: Blob): Promise<ParsedLocalBackup> {
  if (file.size < HEADER_BYTES || file.size > MAX_ARCHIVE_BYTES) {
    throw new TypeError('Backup archive size is invalid')
  }
  const header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer())
  if (!MAGIC.every((value, index) => header[index] === value)) {
    throw new TypeError('Backup archive header is invalid')
  }
  const view = new DataView(header.buffer)
  if (view.getUint32(MAGIC.byteLength, true) !== FORMAT_VERSION) {
    throw new TypeError('Backup archive format is unsupported')
  }
  const manifestSize = view.getUint32(MAGIC.byteLength + 4, true)
  if (manifestSize === 0 || manifestSize > MAX_REVISION_BYTES || HEADER_BYTES + manifestSize > file.size) {
    throw new TypeError('Backup archive manifest size is invalid')
  }
  let parsed: unknown
  try {
    const bytes = await file.slice(HEADER_BYTES, HEADER_BYTES + manifestSize).arrayBuffer()
    parsed = JSON.parse(textDecoder.decode(bytes)) as unknown
  } catch {
    throw new TypeError('Backup archive manifest is invalid')
  }
  const manifest = validateManifest(parsed)
  const bodyOffset = HEADER_BYTES + manifestSize
  const wallpapers: ParsedLocalBackup['wallpapers'] = {}
  let expectedEnd = 0
  const seenVariants = new Set<WallpaperVariant>()
  for (const resource of [...manifest.resources].sort((left, right) => left.offset - right.offset)) {
    if (resource.offset !== expectedEnd || resource.offset + resource.size > file.size - bodyOffset) {
      throw new TypeError('Backup archive resource offsets are invalid')
    }
    const blob = file.slice(
      bodyOffset + resource.offset,
      bodyOffset + resource.offset + resource.size,
      resource.mimeType,
    )
    if ((await sha256Hex(await blob.arrayBuffer())) !== resource.sha256) {
      throw new TypeError('Backup archive resource hash is invalid')
    }
    for (const variant of resource.variants) {
      if (seenVariants.has(variant)) throw new TypeError('Backup archive repeats a wallpaper role')
      const reference = manifest.snapshot.optional?.wallpapers?.[variant]
      if (!reference || !resourceMatchesReference(resource, reference)) {
        throw new TypeError('Backup archive wallpaper reference is invalid')
      }
      seenVariants.add(variant)
      wallpapers[variant] = blob
    }
    expectedEnd += resource.size
  }
  if (bodyOffset + expectedEnd !== file.size) throw new TypeError('Backup archive has trailing data')
  for (const variant of ['light', 'dark'] as const) {
    if (manifest.snapshot.optional?.wallpapers?.[variant] && !seenVariants.has(variant)) {
      throw new TypeError('Backup archive wallpaper resource is missing')
    }
  }
  return { snapshot: manifest.snapshot, wallpapers }
}

async function wallpaperMatches(blob: Blob, reference: SyncWallpaperV1): Promise<boolean> {
  return (
    blob.size <= MAX_SYNC_WALLPAPER_BYTES &&
    blob.size === reference.size &&
    blob.type === reference.mimeType &&
    blob.type.toLowerCase().startsWith('image/') &&
    (await sha256Hex(await blob.arrayBuffer())) === reference.sha256
  )
}

function validateManifest(value: unknown): ArchiveManifestV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Backup archive manifest must be an object')
  }
  const record = value as Record<string, unknown>
  if (
    record.product !== 'lemon-new-tab' ||
    record.formatVersion !== FORMAT_VERSION ||
    !Array.isArray(record.resources)
  ) {
    throw new TypeError('Backup archive manifest format is invalid')
  }
  const resources = record.resources as unknown[]
  if (resources.length > 2 || !resources.every(isArchiveResource)) {
    throw new TypeError('Backup archive resource list is invalid')
  }
  const ids = resources.map((resource) => (resource as ArchiveResourceV1).id)
  if (new Set(ids).size !== ids.length) throw new TypeError('Backup archive repeats a resource')
  return {
    product: 'lemon-new-tab',
    formatVersion: FORMAT_VERSION,
    snapshot: validateSnapshot(record.snapshot),
    resources: resources as ArchiveResourceV1[],
  }
}

function isArchiveResource(value: unknown): value is ArchiveResourceV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const resource = value as Record<string, unknown>
  return (
    typeof resource.id === 'string' &&
    /^sha256-[0-9a-f]{64}$/i.test(resource.id) &&
    typeof resource.mimeType === 'string' &&
    resource.mimeType.startsWith('image/') &&
    typeof resource.offset === 'number' &&
    Number.isSafeInteger(resource.offset) &&
    resource.offset >= 0 &&
    typeof resource.size === 'number' &&
    Number.isSafeInteger(resource.size) &&
    resource.size >= 0 &&
    resource.size <= MAX_SYNC_WALLPAPER_BYTES &&
    typeof resource.sha256 === 'string' &&
    /^[0-9a-f]{64}$/i.test(resource.sha256) &&
    Array.isArray(resource.variants) &&
    resource.variants.length > 0 &&
    resource.variants.every((variant) => variant === 'dark' || variant === 'light') &&
    new Set(resource.variants).size === resource.variants.length
  )
}

function resourceMatchesReference(
  resource: ArchiveResourceV1,
  reference: SyncWallpaperV1,
): boolean {
  return (
    resource.id === reference.assetId &&
    resource.mimeType === reference.mimeType &&
    resource.sha256 === reference.sha256 &&
    resource.size === reference.size
  )
}
