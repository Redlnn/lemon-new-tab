import { preserveExcludedScope } from './apply.ts'
import { captureBrowserSyncSnapshot } from './browserData.ts'
import {
  cleanupHistory,
  openConfiguredVault,
  publishAndFinalize,
  readRevisions,
  type BrowserSyncDeviceEntry,
  type BrowserSyncHistoryEntry,
  type BrowserSyncHistoryPreview,
} from './browserEngine.ts'
import { hashCanonicalJson, jsonEquals, sha256Hex } from './canonical.ts'
import { createEncryptionAad, decryptSyncBytes } from './crypto.ts'
import { compareSyncSnapshots } from './differences.ts'
import { getBaseline, getOrCreateSyncState, patchSyncState } from './localState.ts'
import { findRevisionHeads } from './syncDecision.ts'
import type {
  AssetReferenceV1,
  LocalSyncStateV1,
  PendingSyncOperation,
  SyncDeviceRecordV1,
  SyncRevisionV1,
  SyncSnapshotV1,
  VaultMetadataV1,
} from './types.ts'
import { WebDavError } from './webdav.ts'

const textDecoder = new TextDecoder('utf-8', { fatal: true })

export async function listBrowserSyncHistory(): Promise<BrowserSyncHistoryEntry[]> {
  const opened = await openConfiguredVault()
  const availableAssets = new Set(
    opened.revisions.flatMap((revision) => revision.assets.map((asset) => asset.id)),
  )
  return [...opened.revisions]
    .sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        right.revisionId.localeCompare(left.revisionId),
    )
    .map((revision) => ({
      createdAt: revision.createdAt,
      deviceId: revision.device.id,
      deviceName: revision.device.name,
      integrity: 'verified' as const,
      reason: revision.reason,
      revisionId: revision.revisionId,
      wallpaperAvailable: Object.fromEntries(
        (['light', 'dark'] as const)
          .map((variant) => [
            variant,
            revision.snapshot.optional?.wallpapers?.[variant]
              ? availableAssets.has(revision.snapshot.optional.wallpapers[variant]!.assetId)
              : undefined,
          ])
          .filter(([, available]) => available !== undefined),
      ),
    }))
}

export interface BrowserCorruptionInspection {
  actualPayloadHash: string
  corruptedRevisionId: string
  encrypted: boolean
  localMatchesPrevious: boolean
  payloadSize: number
  previousRevisionId?: string
}

async function scanCorruptedRevisions(opened: Awaited<ReturnType<typeof openConfiguredVault>>) {
  const commits = await opened.repository.listCommits(opened.metadata)
  const valid: SyncRevisionV1[] = []
  const corrupted: typeof commits = []
  for (const commit of commits) {
    try {
      const [revision] = await readRevisions(
        opened.repository,
        opened.metadata,
        opened.encryptionKey,
        [commit],
      )
      if (revision) valid.push(revision)
    } catch (error) {
      if (error instanceof WebDavError && error.category === 'corrupted') {
        corrupted.push(commit)
        continue
      }
      throw error
    }
  }
  return { corrupted, valid }
}

export async function inspectBrowserSyncCorruption(): Promise<BrowserCorruptionInspection> {
  const opened = await openConfiguredVault(false)
  const scan = await scanCorruptedRevisions(opened)
  if (scan.corrupted.length === 0) {
    throw new WebDavError('precondition', 'No damaged revision is available for corruption repair')
  }
  if (scan.corrupted.length > 1) {
    throw new WebDavError('corrupted', 'Multiple damaged revisions require manual recovery')
  }
  const commit = scan.corrupted[0]!
  const raw = await opened.repository.readStoredPayloadUnchecked(commit)
  const validHeads = findRevisionHeads(scan.valid)
  const previous = validHeads.length === 1 ? validHeads[0] : undefined
  const local = await captureBrowserSyncSnapshot(opened.state.scope)
  const comparable = previous
    ? preserveExcludedScope(local, previous.snapshot, opened.state.scope)
    : local
  return {
    actualPayloadHash: await sha256Hex(raw),
    corruptedRevisionId: commit.revisionId,
    encrypted: commit.encrypted,
    localMatchesPrevious: Boolean(previous && jsonEquals(comparable, previous.snapshot)),
    payloadSize: raw.byteLength,
    previousRevisionId: previous?.revisionId,
  }
}

export async function downloadBrowserCorruptedPayload(input: {
  actualPayloadHash: string
  revisionId: string
}): Promise<{ bytes: Uint8Array<ArrayBuffer>; filename: string }> {
  const opened = await openConfiguredVault(false)
  const commit = (await opened.repository.listCommits(opened.metadata)).find(
    (item) => item.revisionId === input.revisionId,
  )
  if (!commit) throw new WebDavError('not-found', 'Damaged revision no longer exists')
  const bytes = await opened.repository.readStoredPayloadUnchecked(commit)
  if ((await sha256Hex(bytes)) !== input.actualPayloadHash) {
    throw new WebDavError('precondition', 'Damaged revision changed before download')
  }
  return {
    bytes,
    filename: `lemon-corrupted-${commit.revisionId}.${commit.encrypted ? 'bin' : 'json'}`,
  }
}

export async function repairBrowserSyncCorruption(input: {
  actualPayloadHash: string
  choice?: 'local' | 'previous'
  downloaded: boolean
  revisionId: string
}): Promise<LocalSyncStateV1> {
  if (!input.downloaded) throw new WebDavError('forbidden', 'Download the damaged file first')
  const opened = await openConfiguredVault(false)
  const scan = await scanCorruptedRevisions(opened)
  if (scan.corrupted.length !== 1 || scan.corrupted[0]!.revisionId !== input.revisionId) {
    throw new WebDavError('precondition', 'Damaged revision changed before repair')
  }
  const commit = scan.corrupted[0]!
  const raw = await opened.repository.readStoredPayloadUnchecked(commit)
  if ((await sha256Hex(raw)) !== input.actualPayloadHash) {
    throw new WebDavError('precondition', 'Damaged revision changed before repair')
  }
  const validHeads = findRevisionHeads(scan.valid)
  if (validHeads.length !== 1) {
    throw new WebDavError('conflict', 'Valid revisions do not have one safe previous version')
  }
  const previous = validHeads[0]!
  if (previous.reason === 'repair' && opened.state.baseRevisionId === previous.revisionId) {
    return patchSyncState({ paused: true, pauseReason: 'corrupted-remote' })
  }
  const captured = await captureBrowserSyncSnapshot(opened.state.scope)
  const local = preserveExcludedScope(captured, previous.snapshot, opened.state.scope)
  const choice = jsonEquals(local, previous.snapshot) ? 'previous' : input.choice
  if (choice !== 'local' && choice !== 'previous') {
    throw new WebDavError('conflict', 'Choose local data or the previous cloud version')
  }
  const snapshot = choice === 'local' ? local : previous.snapshot
  const pending: PendingSyncOperation = {
    operationId: crypto.randomUUID(),
    phase: 'captured',
    startedAt: new Date().toISOString(),
  }
  await publishAndFinalize({
    repository: opened.repository,
    metadata: opened.metadata,
    state: opened.state,
    pending,
    parents: [previous.revisionId],
    reason: 'repair',
    snapshot,
    tombstones: previous.tombstones,
    knownAssets: scan.valid.flatMap((revision) => revision.assets),
    encryptionKey: opened.encryptionKey,
    corruptedRevisionToIgnore: commit.revisionId,
  })
  return patchSyncState({ paused: true, pauseReason: 'corrupted-remote' })
}

export async function deleteBrowserCorruptedRevision(input: {
  actualPayloadHash: string
  revisionId: string
}): Promise<LocalSyncStateV1> {
  const opened = await openConfiguredVault(false)
  const scan = await scanCorruptedRevisions(opened)
  const damaged = scan.corrupted.find((commit) => commit.revisionId === input.revisionId)
  const heads = findRevisionHeads(scan.valid)
  const current = heads.length === 1 ? heads[0] : undefined
  if (
    scan.corrupted.length !== 1 ||
    !damaged ||
    !current ||
    current.revisionId !== opened.state.baseRevisionId
  ) {
    throw new WebDavError('precondition', 'Repair state changed before damaged data was deleted')
  }
  const raw = await opened.repository.readStoredPayloadUnchecked(damaged)
  if ((await sha256Hex(raw)) !== input.actualPayloadHash) {
    throw new WebDavError('precondition', 'Damaged revision changed before deletion')
  }
  if (current.reason !== 'repair') {
    throw new WebDavError('precondition', 'The verified repair revision is no longer current')
  }
  await opened.repository.deleteRevision(opened.metadata, damaged.revisionId)
  await cleanupHistory(opened.repository, opened.metadata, opened.encryptionKey)
  return patchSyncState({
    paused: false,
    pauseReason: undefined,
    lastError: undefined,
  })
}

export async function listBrowserSyncDevices(): Promise<BrowserSyncDeviceEntry[]> {
  const opened = await openConfiguredVault()
  const records = new Map<string, SyncDeviceRecordV1>()
  for (const stored of await opened.repository.listDevicePayloads(opened.metadata)) {
    let bytes = stored.bytes
    if (opened.metadata.encrypted) {
      if (!opened.encryptionKey) {
        throw new WebDavError('encryption-locked', 'Encrypted WebDAV vault is locked')
      }
      try {
        bytes = await decryptSyncBytes(
          opened.encryptionKey,
          bytes,
          createEncryptionAad({
            vaultId: opened.metadata.vaultId,
            generationId: opened.metadata.generationId,
            objectType: 'device',
            objectId: stored.deviceId,
          }),
        )
      } catch {
        throw new WebDavError('corrupted', 'Encrypted device record could not be authenticated')
      }
    }
    let value: unknown
    try {
      value = JSON.parse(textDecoder.decode(bytes)) as unknown
    } catch {
      throw new WebDavError('corrupted', 'Device record is invalid')
    }
    const record = validateDeviceRecord(value, opened.metadata, stored.deviceId)
    records.set(record.deviceId, record)
  }
  for (const revision of opened.revisions) {
    const existing = records.get(revision.device.id)
    if (!existing) {
      records.set(revision.device.id, {
        deviceId: revision.device.id,
        firstSeenAt: revision.createdAt,
        formatVersion: 1,
        generationId: revision.generationId,
        lastRevisionId: revision.revisionId,
        lastSeenAt: revision.createdAt,
        name: revision.device.name,
        vaultId: revision.vaultId,
      })
    } else {
      if (Date.parse(revision.createdAt) < Date.parse(existing.firstSeenAt)) {
        existing.firstSeenAt = revision.createdAt
      }
      if (Date.parse(revision.createdAt) > Date.parse(existing.lastSeenAt)) {
        existing.lastSeenAt = revision.createdAt
        existing.lastRevisionId = revision.revisionId
        existing.name = revision.device.name
      }
    }
  }
  const staleBefore = Date.now() - 180 * 86_400_000
  return [...records.values()]
    .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt))
    .map((record) => ({
      deviceId: record.deviceId,
      firstSeenAt: record.firstSeenAt,
      lastRevisionId: record.lastRevisionId,
      lastSeenAt: record.lastSeenAt,
      name: record.name,
      stale: Date.parse(record.lastSeenAt) < staleBefore,
    }))
}

function validateDeviceRecord(
  value: unknown,
  metadata: VaultMetadataV1,
  expectedDeviceId: string,
): SyncDeviceRecordV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WebDavError('corrupted', 'Device record must be an object')
  }
  const record = value as Record<string, unknown>
  const valid =
    record.formatVersion === 1 &&
    record.vaultId === metadata.vaultId &&
    record.generationId === metadata.generationId &&
    record.deviceId === expectedDeviceId &&
    typeof record.name === 'string' &&
    record.name.length > 0 &&
    record.name.length <= 80 &&
    typeof record.firstSeenAt === 'string' &&
    Number.isFinite(Date.parse(record.firstSeenAt)) &&
    typeof record.lastSeenAt === 'string' &&
    Number.isFinite(Date.parse(record.lastSeenAt)) &&
    typeof record.lastRevisionId === 'string'
  if (!valid) throw new WebDavError('corrupted', 'Device record fields are invalid')
  return value as SyncDeviceRecordV1
}

function prepareHistoricalSnapshot(
  target: SyncRevisionV1,
  current: SyncRevisionV1,
  knownAssets: ReadonlyMap<string, AssetReferenceV1>,
): { snapshot: SyncSnapshotV1; wallpaperUnavailable: Array<'dark' | 'light'> } {
  const snapshot = structuredClone(target.snapshot)
  const wallpaperUnavailable: Array<'dark' | 'light'> = []
  for (const variant of ['light', 'dark'] as const) {
    const historical = snapshot.optional?.wallpapers?.[variant]
    if (!historical || knownAssets.has(historical.assetId)) continue
    wallpaperUnavailable.push(variant)
    const replacement = current.snapshot.optional?.wallpapers?.[variant]
    if (replacement && knownAssets.has(replacement.assetId)) {
      snapshot.optional!.wallpapers![variant] = structuredClone(replacement)
    } else if (snapshot.optional?.wallpapers) {
      delete snapshot.optional.wallpapers[variant]
    }
  }
  if (snapshot.optional?.wallpapers && Object.keys(snapshot.optional.wallpapers).length === 0) {
    delete snapshot.optional.wallpapers
  }
  if (snapshot.optional && Object.keys(snapshot.optional).length === 0) delete snapshot.optional
  return { snapshot, wallpaperUnavailable }
}

export async function previewBrowserSyncHistory(
  revisionId: string,
): Promise<BrowserSyncHistoryPreview> {
  const opened = await openConfiguredVault()
  if (opened.state.paused)
    throw new WebDavError('conflict', 'Resolve sync status before restoring history')
  const heads = findRevisionHeads(opened.revisions)
  if (heads.length !== 1) throw new WebDavError('conflict', 'Resolve remote branches first')
  const target = opened.revisions.find((revision) => revision.revisionId === revisionId)
  if (!target) throw new WebDavError('not-found', 'History revision no longer exists')
  const knownAssets = new Map<string, AssetReferenceV1>()
  for (const asset of opened.revisions.flatMap((revision) => revision.assets)) {
    knownAssets.set(asset.id, asset)
  }
  const prepared = prepareHistoricalSnapshot(target, heads[0]!, knownAssets)
  const baseline = await getBaseline()
  const local = preserveExcludedScope(
    await captureBrowserSyncSnapshot(opened.state.scope),
    baseline ?? heads[0]!.snapshot,
    opened.state.scope,
  )
  const comparison = compareSyncSnapshots(local, prepared.snapshot)
  return {
    currentSnapshotHash: await hashCanonicalJson(local),
    differences: comparison.differences,
    headRevisionId: heads[0]!.revisionId,
    revisionId,
    truncated: comparison.truncated,
    wallpaperUnavailable: prepared.wallpaperUnavailable,
  }
}

export async function restoreBrowserSyncHistory(
  revisionId: string,
  expected?: { currentSnapshotHash: string; headRevisionId: string },
): Promise<LocalSyncStateV1> {
  const opened = await openConfiguredVault()
  if (opened.state.paused)
    throw new WebDavError('conflict', 'Resolve sync status before restoring history')
  const heads = findRevisionHeads(opened.revisions)
  if (heads.length !== 1) throw new WebDavError('conflict', 'Resolve remote branches first')
  const target = opened.revisions.find((revision) => revision.revisionId === revisionId)
  if (!target) throw new WebDavError('not-found', 'History revision no longer exists')
  const knownAssets = new Map<string, AssetReferenceV1>()
  for (const asset of opened.revisions.flatMap((revision) => revision.assets)) {
    knownAssets.set(asset.id, asset)
  }
  const { snapshot } = prepareHistoricalSnapshot(target, heads[0]!, knownAssets)
  if (expected) {
    const baseline = await getBaseline()
    const local = preserveExcludedScope(
      await captureBrowserSyncSnapshot(opened.state.scope),
      baseline ?? heads[0]!.snapshot,
      opened.state.scope,
    )
    if (
      heads[0]!.revisionId !== expected.headRevisionId ||
      (await hashCanonicalJson(local)) !== expected.currentSnapshotHash
    ) {
      throw new WebDavError('precondition', 'Local or remote data changed after history preview')
    }
  }
  const pending: PendingSyncOperation = {
    operationId: crypto.randomUUID(),
    phase: 'captured',
    startedAt: new Date().toISOString(),
  }
  await publishAndFinalize({
    repository: opened.repository,
    metadata: opened.metadata,
    state: opened.state,
    pending,
    parents: [heads[0]!.revisionId],
    reason: 'restore',
    snapshot,
    tombstones: heads[0]!.tombstones,
    knownAssets: [...knownAssets.values()],
    encryptionKey: opened.encryptionKey,
  })
  return getOrCreateSyncState()
}
