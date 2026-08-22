import { CURRENT_CONFIG_VERSION } from '@/shared/settings'
import { browser } from 'wxt/browser'

import {
  captureBrowserSyncSnapshot,
  captureBrowserSyncSnapshotResult,
  clearAllStagedWallpaperSyncCandidates,
  getStagedWallpaperSyncCandidate,
  getUnavailableSelectedWallpaperVariants,
  getLocalWallpaperBlob,
  prepareAndApplyBrowserSnapshot,
  resumePendingBrowserApply,
  type IncomingWallpaperResources,
} from './browserData.ts'
import { preserveBaselineWallpapers, preserveExcludedScope } from './apply.ts'
import { quickLinkIconHashesAreValid } from './capture.ts'
import { canonicalJson, hashCanonicalJson, jsonEquals, sha256Hex } from './canonical.ts'
import {
  createEncryptionAad,
  createVaultEncryption,
  decryptSyncBytes,
  encryptSyncBytes,
  unlockVaultEncryption,
} from './crypto.ts'
import { resolveSyncConflicts } from './conflicts.ts'
import type { SyncDifference } from './differences.ts'
import {
  deriveSnapshotTombstones,
  mustReinitializeDevice,
  pruneExpiredTombstones,
} from './lifecycle.ts'
import { mergeSyncSnapshots } from './merge.ts'
import {
  DEFAULT_SYNC_SCOPE,
  clearStoredEncryptionKey,
  clearStoredConflict,
  getBaseline,
  getOrCreateSyncState,
  getStoredEncryptionKey,
  getStoredConflict,
  getWebDavPassword,
  patchSyncState,
  saveWebDavPassword,
  setBaseline,
  setStoredEncryptionKey,
  setStoredConflict,
  webDavSyncConfigStorage,
} from './localState.ts'
import {
  decideSynchronization,
  decideInitialization,
  findRevisionHeads,
  mergeRemoteRevisionHeads,
} from './syncDecision.ts'
import type {
  LocalSyncStateV1,
  AssetReferenceV1,
  PendingSyncOperation,
  SanitizedSyncError,
  SyncConflictResolution,
  SyncDeviceRecordV1,
  SyncPauseReason,
  SyncRevisionReason,
  SyncRevisionV1,
  SyncSnapshotV1,
  TombstoneV1,
  VaultMetadataV1,
} from './types.ts'
import { validateSyncRevision } from './validation.ts'
import {
  probeWebDavCapabilities,
  WebDavClient,
  WebDavError,
  type WebDavConnection,
  WebDavVaultRepository,
} from './webdav.ts'

const MAX_CONCURRENCY_RESCANS = 3
const textDecoder = new TextDecoder('utf-8', { fatal: true })
const textEncoder = new TextEncoder()

export function createClient(
  config: NonNullable<Awaited<ReturnType<typeof webDavSyncConfigStorage.getValue>>>,
  password: string,
): WebDavClient {
  return new WebDavClient({
    ...config.connection,
    username: config.username,
    password,
  })
}

export async function readRevisions(
  repository: WebDavVaultRepository,
  metadata: VaultMetadataV1,
  encryptionKey?: CryptoKey,
  providedCommits?: Awaited<ReturnType<WebDavVaultRepository['listCommits']>>,
): Promise<SyncRevisionV1[]> {
  const commits = providedCommits ?? (await repository.listCommits(metadata))
  const revisions: SyncRevisionV1[] = []
  for (const commit of commits) {
    if (commit.encrypted !== metadata.encrypted) {
      throw new WebDavError('corrupted', 'Commit encryption mode does not match its vault')
    }
    let revision: SyncRevisionV1
    if (metadata.encrypted) {
      if (!encryptionKey) {
        throw new WebDavError('encryption-locked', 'Encrypted WebDAV vault is locked')
      }
      const payload = await repository.readCommittedPayload(commit)
      let value: unknown
      try {
        const plaintext = await decryptSyncBytes(
          encryptionKey,
          payload,
          createEncryptionAad({
            vaultId: metadata.vaultId,
            generationId: metadata.generationId,
            objectType: 'revision',
            objectId: commit.revisionId,
          }),
        )
        value = JSON.parse(textDecoder.decode(plaintext)) as unknown
      } catch {
        throw new WebDavError('corrupted', 'Encrypted revision could not be authenticated')
      }
      const validation = validateSyncRevision(value)
      if (!validation.ok) throw new WebDavError('corrupted', validation.error)
      revision = validation.value
      if ((await hashCanonicalJson(revision.snapshot)) !== revision.snapshotHash) {
        throw new WebDavError('corrupted', 'Revision snapshot hash is invalid')
      }
    } else {
      revision = await repository.readRevision(commit)
    }
    if (revision.revisionId !== commit.revisionId) {
      throw new WebDavError('corrupted', 'Commit and revision identifiers do not match')
    }
    if (revision.settingsSchemaVersion > CURRENT_CONFIG_VERSION) {
      throw new WebDavError('format-too-new', 'Remote settings format is newer than this extension')
    }
    if (!(await quickLinkIconHashesAreValid(revision.snapshot))) {
      throw new WebDavError('corrupted', 'Quick Link icon hash does not match its content')
    }
    revisions.push(revision)
  }
  return revisions
}

export function mergeTombstones(
  existing: readonly TombstoneV1[],
  derived: readonly TombstoneV1[],
): TombstoneV1[] {
  const values = new Map<string, TombstoneV1>()
  for (const item of [...existing, ...derived]) values.set(`${item.entityType}\0${item.entityId}`, item)
  return pruneExpiredTombstones([...values.values()])
}

export async function createRevision(input: {
  metadata: VaultMetadataV1
  state: LocalSyncStateV1
  operationId: string
  revisionId: string
  parents: string[]
  reason: SyncRevisionReason
  snapshot: SyncSnapshotV1
  tombstones: TombstoneV1[]
  assets: AssetReferenceV1[]
}): Promise<SyncRevisionV1> {
  return {
    formatVersion: 1,
    settingsSchemaVersion: CURRENT_CONFIG_VERSION,
    vaultId: input.metadata.vaultId,
    generationId: input.metadata.generationId,
    revisionId: input.revisionId,
    parentRevisionIds: input.parents,
    operationId: input.operationId,
    device: {
      id: input.state.deviceId,
      name:
        input.state.deviceName ||
        `Browser · Device · ${input.state.deviceId.slice(0, 4).toUpperCase()}`,
    },
    createdAt: new Date().toISOString(),
    reason: input.reason,
    snapshot: input.snapshot,
    tombstones: input.tombstones,
    assets: input.assets,
    snapshotHash: await hashCanonicalJson(input.snapshot),
  }
}

async function setPendingPhase(
  current: PendingSyncOperation,
  phase: PendingSyncOperation['phase'],
  revisionId = current.revisionId,
): Promise<PendingSyncOperation> {
  const pending = { ...current, phase, revisionId }
  await patchSyncState({ pending })
  return pending
}

export async function finalizeSnapshot(input: {
  operationId: string
  revisionId: string
  snapshot: SyncSnapshotV1
  state: LocalSyncStateV1
  apply: boolean
  wallpapers?: IncomingWallpaperResources
  preserveLocalWallpapers?: boolean
}): Promise<void> {
  if (input.apply) {
    await patchSyncState({
      pending: {
        operationId: input.operationId,
        phase: 'applying-local',
        revisionId: input.revisionId,
        startedAt: new Date().toISOString(),
      },
    })
    await prepareAndApplyBrowserSnapshot(
      input.operationId,
      input.revisionId,
      input.snapshot,
      input.state.scope,
      input.wallpapers,
    )
    const captured = await captureBrowserSyncSnapshot(input.state.scope)
    const applied = preserveExcludedScope(
      captured,
      input.snapshot,
      input.preserveLocalWallpapers
        ? { ...input.state.scope, wallpapers: false }
        : input.state.scope,
    )
    if (!jsonEquals(applied, input.snapshot)) {
      throw new WebDavError('corrupted', 'Applied local snapshot did not pass verification')
    }
  }

  await setBaseline(input.snapshot)
  await clearStoredConflict()
  await patchSyncState({
    baseRevisionId: input.revisionId,
    lastSuccessAt: new Date().toISOString(),
    lastError: undefined,
    paused: false,
    pauseReason: undefined,
    pending: undefined,
  })
}

export async function publishAndFinalize(input: {
  repository: WebDavVaultRepository
  metadata: VaultMetadataV1
  vaultEtag?: string
  state: LocalSyncStateV1
  pending: PendingSyncOperation
  parents: string[]
  reason: SyncRevisionReason
  snapshot: SyncSnapshotV1
  tombstones: TombstoneV1[]
  knownAssets: AssetReferenceV1[]
  encryptionKey?: CryptoKey
  corruptedRevisionToIgnore?: string
}): Promise<void> {
  let revisionId = input.pending.revisionId ?? crypto.randomUUID()
  let pending = await setPendingPhase(input.pending, 'captured', revisionId)
  let snapshot = input.snapshot
  let assets: AssetReferenceV1[]
  let preservingLocalWallpapers = false
  try {
    assets = await resolveRevisionAssets(
      input.repository,
      input.metadata,
      snapshot,
      input.knownAssets,
      input.encryptionKey,
    )
  } catch (error) {
    if (
      !(error instanceof WebDavError) ||
      error.category !== 'storage-full' ||
      !snapshot.optional?.wallpapers
    ) {
      throw error
    }
    snapshot = preserveBaselineWallpapers(snapshot, await getBaseline())
    assets = await resolveRevisionAssets(
      input.repository,
      input.metadata,
      snapshot,
      input.knownAssets,
      input.encryptionKey,
    )
    preservingLocalWallpapers = true
    await patchSyncState({ wallpaperStatus: 'storage-full' })
  }
  pending = await setPendingPhase(pending, 'assets-uploaded', revisionId)
  let revision = await createRevision({
    metadata: input.metadata,
    state: input.state,
    operationId: pending.operationId,
    revisionId,
    parents: input.parents,
    reason: input.reason,
    snapshot,
    tombstones: input.tombstones,
    assets,
  })
  let storedRevision = input.metadata.encrypted
    ? await encryptRevision(input.metadata, revision, input.encryptionKey)
    : undefined
  try {
    await input.repository.publishRevision(input.metadata, revision, storedRevision)
  } catch (error) {
    if (
      !(error instanceof WebDavError) ||
      error.category !== 'storage-full' ||
      preservingLocalWallpapers ||
      !snapshot.optional?.wallpapers
    ) {
      throw error
    }
    const published = await publishedRevisionMatches(
      input.repository,
      input.metadata,
      revision,
      input.encryptionKey,
    )
    if (published) {
      // The server may return an error after persisting the immutable commit.
    } else {
      const knownPaths = new Set(input.knownAssets.map((asset) => asset.path))
      const orphanAssets = assets.filter((asset) => !knownPaths.has(asset.path))
      await input.repository.deleteRevision(input.metadata, revisionId).catch(() => undefined)
      revisionId = crypto.randomUUID()
      pending = await setPendingPhase(pending, 'assets-uploaded', revisionId)
      snapshot = preserveBaselineWallpapers(snapshot, await getBaseline())
      assets = await resolveRevisionAssets(
        input.repository,
        input.metadata,
        snapshot,
        input.knownAssets,
        input.encryptionKey,
      )
      preservingLocalWallpapers = true
      revision = await createRevision({
        metadata: input.metadata,
        state: input.state,
        operationId: pending.operationId,
        revisionId,
        parents: input.parents,
        reason: input.reason,
        snapshot,
        tombstones: input.tombstones,
        assets,
      })
      storedRevision = input.metadata.encrypted
        ? await encryptRevision(input.metadata, revision, input.encryptionKey)
        : undefined
      await input.repository.publishRevision(input.metadata, revision, storedRevision)
      for (const asset of orphanAssets) {
        await input.repository.deleteAsset(asset).catch(() => undefined)
      }
    }
    await patchSyncState({ wallpaperStatus: 'storage-full' })
  }
  pending = await setPendingPhase(pending, 'committed', revisionId)

  const commitsAfterPublish = await input.repository.listCommits(input.metadata)
  const revisionsAfterPublish = await readRevisions(
    input.repository,
    input.metadata,
    input.encryptionKey,
    input.corruptedRevisionToIgnore
      ? commitsAfterPublish.filter(
          (commit) => commit.revisionId !== input.corruptedRevisionToIgnore,
        )
      : commitsAfterPublish,
  )
  const heads = findRevisionHeads(revisionsAfterPublish)
  if (heads.length !== 1 || heads[0]?.revisionId !== revisionId) {
    throw new WebDavError('precondition', 'A concurrent remote branch must be merged')
  }
  const wallpapers = preservingLocalWallpapers
    ? undefined
    : await prepareIncomingWallpapers(
        input.repository,
        input.metadata,
        input.state,
        snapshot,
        assets,
        input.encryptionKey,
      )
  await input.repository.updateCurrentRevision(input.metadata, input.vaultEtag, revisionId)
  await setPendingPhase(pending, 'head-updated', revisionId)
  await finalizeSnapshot({
    operationId: pending.operationId,
    revisionId,
    snapshot,
    state: input.state,
    apply: true,
    wallpapers,
    preserveLocalWallpapers: preservingLocalWallpapers,
  })
  await clearAllStagedWallpaperSyncCandidates()
  await writeDevicePresence(
    input.repository,
    input.metadata,
    input.state,
    revisionId,
    input.encryptionKey,
    true,
  )
  if (!input.corruptedRevisionToIgnore) {
    await cleanupHistory(
      input.repository,
      input.metadata,
      input.state.historyLimit,
      input.encryptionKey,
    )
  }
}

async function publishedRevisionMatches(
  repository: WebDavVaultRepository,
  metadata: VaultMetadataV1,
  revision: SyncRevisionV1,
  encryptionKey?: CryptoKey,
): Promise<boolean> {
  const commit = (await repository.listCommits(metadata)).find(
    (item) => item.revisionId === revision.revisionId,
  )
  if (!commit) return false
  const stored = await readRevisions(repository, metadata, encryptionKey, [commit])
  return stored[0]?.operationId === revision.operationId &&
    stored[0].snapshotHash === revision.snapshotHash
}

export function withoutWallpapers(snapshot: SyncSnapshotV1): SyncSnapshotV1 {
  const result = structuredClone(snapshot)
  if (result.optional?.wallpapers) delete result.optional.wallpapers
  if (result.optional && Object.keys(result.optional).length === 0) delete result.optional
  return result
}

export async function encryptRevision(
  metadata: VaultMetadataV1,
  revision: SyncRevisionV1,
  key?: CryptoKey,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!key) throw new WebDavError('encryption-locked', 'Encrypted WebDAV vault is locked')
  return encryptSyncBytes(
    key,
    textEncoder.encode(canonicalJson(revision)),
    createEncryptionAad({
      vaultId: metadata.vaultId,
      generationId: metadata.generationId,
      objectType: 'revision',
      objectId: revision.revisionId,
    }),
  )
}

export async function cleanupHistory(
  repository: WebDavVaultRepository,
  metadata: VaultMetadataV1,
  limit: number,
  encryptionKey?: CryptoKey,
): Promise<void> {
  try {
    const revisions = await readRevisions(repository, metadata, encryptionKey)
    await repository.pruneHistory(metadata, revisions, limit)
  } catch {
    // 清理失败不改变已验证的同步结果；下一次自然触发会重新尝试。
  }
}

function wallpaperRole(variant: 'dark' | 'light'): AssetReferenceV1['role'] {
  return variant === 'light' ? 'wallpaper-light' : 'wallpaper-dark'
}

export async function resolveRevisionAssets(
  repository: WebDavVaultRepository,
  metadata: VaultMetadataV1,
  snapshot: SyncSnapshotV1,
  knownAssets: readonly AssetReferenceV1[],
  encryptionKey?: CryptoKey,
  providedWallpapers: Partial<Record<'dark' | 'light', Blob>> = {},
): Promise<AssetReferenceV1[]> {
  const result: AssetReferenceV1[] = []
  for (const variant of ['light', 'dark'] as const) {
    const reference = snapshot.optional?.wallpapers?.[variant]
    if (!reference) continue
    const role = wallpaperRole(variant)
    const resolved = result.find(
      (asset) => asset.id === reference.assetId && asset.sha256 === reference.sha256,
    )
    if (resolved) continue
    const known = knownAssets.find(
      (asset) =>
        asset.id === reference.assetId &&
        asset.sha256 === reference.sha256,
    )
    if (known) {
      await readWallpaperAsset(repository, metadata, known, encryptionKey)
      result.push(known)
      continue
    }
    const blob =
      providedWallpapers[variant] ??
      (await getLocalWallpaperBlob(variant, reference.sha256)) ??
      (await getStagedWallpaperSyncCandidate(variant, reference.sha256))
    if (!blob) throw new WebDavError('corrupted', 'Selected local wallpaper is unavailable')
    let uploaded: AssetReferenceV1
    if (metadata.encrypted) {
      if (!encryptionKey) {
        throw new WebDavError('encryption-locked', 'Encrypted WebDAV vault is locked')
      }
      const storageId = crypto.randomUUID()
      const encrypted = await encryptSyncBytes(
        encryptionKey,
        await blob.arrayBuffer(),
        createEncryptionAad({
          vaultId: metadata.vaultId,
          generationId: metadata.generationId,
          objectType: 'asset',
          objectId: storageId,
        }),
      )
      uploaded = await repository.publishEncryptedAsset(
        metadata,
        role,
        blob,
        storageId,
        encrypted,
      )
    } else {
      uploaded = await repository.publishAsset(metadata, role, blob)
    }
    if (
      uploaded.id !== reference.assetId ||
      uploaded.size !== reference.size ||
      uploaded.mimeType !== reference.mimeType
    ) {
      throw new WebDavError('corrupted', 'Uploaded wallpaper does not match its snapshot')
    }
    result.push(uploaded)
  }
  return result
}

export async function prepareIncomingWallpapers(
  repository: WebDavVaultRepository,
  metadata: VaultMetadataV1,
  state: LocalSyncStateV1,
  snapshot: SyncSnapshotV1,
  assets: readonly AssetReferenceV1[],
  encryptionKey?: CryptoKey,
): Promise<IncomingWallpaperResources | undefined> {
  if (!state.scope.wallpapers) return undefined
  const unavailable = await getUnavailableSelectedWallpaperVariants()
  const result: IncomingWallpaperResources = {}
  for (const variant of ['light', 'dark'] as const) {
    if (unavailable.has(variant)) continue
    const reference = snapshot.optional?.wallpapers?.[variant]
    if (!reference || (await getLocalWallpaperBlob(variant, reference.sha256))) continue
    const asset = assets.find((item) => item.id === reference.assetId)
    if (!asset) throw new WebDavError('corrupted', 'Revision wallpaper reference is missing')
    result[variant] = {
      assetId: reference.assetId,
      blob: await readWallpaperAsset(repository, metadata, asset, encryptionKey),
      sha256: reference.sha256,
    }
  }
  return Object.keys(result).length ? result : undefined
}

function encryptedAssetStorageId(metadata: VaultMetadataV1, asset: AssetReferenceV1): string {
  const prefix = `generations/${metadata.generationId}/assets/`
  const match = asset.path.startsWith(prefix)
    ? asset.path.slice(prefix.length).match(/^([0-9a-f-]{36})\.bin$/i)
    : null
  if (!match || !match[1]) {
    throw new WebDavError('corrupted', 'Encrypted wallpaper path is outside its generation')
  }
  return match[1]
}

export async function readWallpaperAsset(
  repository: WebDavVaultRepository,
  metadata: VaultMetadataV1,
  asset: AssetReferenceV1,
  encryptionKey?: CryptoKey,
): Promise<Blob> {
  if (!metadata.encrypted) return repository.readAsset(asset)
  if (!encryptionKey) {
    throw new WebDavError('encryption-locked', 'Encrypted WebDAV vault is locked')
  }
  let plaintext: Uint8Array<ArrayBuffer>
  try {
    plaintext = await decryptSyncBytes(
      encryptionKey,
      await repository.readEncryptedAsset(asset),
      createEncryptionAad({
        vaultId: metadata.vaultId,
        generationId: metadata.generationId,
        objectType: 'asset',
        objectId: encryptedAssetStorageId(metadata, asset),
      }),
    )
  } catch (error) {
    if (error instanceof WebDavError) throw error
    throw new WebDavError('corrupted', 'Encrypted wallpaper could not be authenticated')
  }
  if (plaintext.byteLength !== asset.size || (await sha256Hex(plaintext)) !== asset.sha256) {
    throw new WebDavError('corrupted', 'Encrypted wallpaper failed integrity validation')
  }
  return new Blob([plaintext], { type: asset.mimeType })
}

async function runSynchronizationOnce(): Promise<void> {
  const [config, initialState, password] = await Promise.all([
    webDavSyncConfigStorage.getValue(),
    getOrCreateSyncState(),
    getWebDavPassword(),
  ])
  if (!config || !initialState.configured) return
  if (initialState.paused) return
  if (!password) {
    await patchSyncState({ paused: true, pauseReason: 'authentication' })
    return
  }

  await resumePendingBrowserApply(initialState.scope)
  const baselineAtStart = await getBaseline()
  const lastDeviceRecord = initialState.deviceRecordAt ?? initialState.lastSuccessAt
  const reinitialize = Boolean(lastDeviceRecord && mustReinitializeDevice(lastDeviceRecord))
  const capture = await captureBrowserSyncSnapshotResult(
    initialState.scope,
    reinitialize ? undefined : baselineAtStart,
  )
  const capturedLocal = capture.snapshot
  if (initialState.scope.wallpapers) {
    await patchSyncState({ wallpaperStatus: capture.wallpaperStatus })
  }
  const local = baselineAtStart && !reinitialize
    ? preserveExcludedScope(capturedLocal, baselineAtStart, initialState.scope)
    : capturedLocal
  const pending: PendingSyncOperation = initialState.pending ?? {
    operationId: crypto.randomUUID(),
    phase: 'captured',
    startedAt: new Date().toISOString(),
  }
  await patchSyncState({ pending })

  const repository = new WebDavVaultRepository(createClient(config, password), config.directory)
  const inspection = await repository.inspect()
  if (inspection.state !== 'ready') {
    if (inspection.state === 'foreign') {
      throw new WebDavError(
        'foreign-vault',
        'Configured WebDAV directory lost its ownership marker',
      )
    }
    throw new WebDavError('not-found', 'Configured WebDAV vault was deleted')
  }
  const metadata = inspection.metadata
  if (metadata.vaultId !== initialState.vaultId) {
    throw new WebDavError('foreign-vault', 'Configured WebDAV vault identity changed')
  }
  if (metadata.generationId !== initialState.generationId) {
    if (metadata.reset?.previousGenerationId === initialState.generationId) {
      throw new WebDavError('generation-reset', 'Another device reset the WebDAV vault')
    }
    if (metadata.encrypted) {
      throw new WebDavError('encryption-locked', 'WebDAV vault uses a new encrypted generation')
    }
    throw new WebDavError('format-too-new', 'WebDAV vault generation changed')
  }
  if (metadata.encrypted !== initialState.encrypted) {
    throw new WebDavError(
      metadata.encrypted ? 'encryption-locked' : 'format-too-new',
      'WebDAV vault encryption mode changed',
    )
  }
  const encryptionKey = metadata.encrypted
    ? await getStoredEncryptionKey(metadata.vaultId, metadata.generationId)
    : undefined
  if (metadata.encrypted && !encryptionKey) {
    throw new WebDavError('encryption-locked', 'Encrypted WebDAV vault is locked')
  }

  const revisions = await readRevisions(repository, metadata, encryptionKey)
  if (revisions.length === 0) {
    if (initialState.baseRevisionId || (await getBaseline())) {
      throw new WebDavError('corrupted', 'WebDAV vault has no committed revision')
    }
    await publishAndFinalize({
      repository,
      metadata,
      vaultEtag: inspection.etag,
      state: initialState,
      pending,
      parents: [],
      reason: 'initial',
      snapshot: local,
      tombstones: [],
      knownAssets: [],
      encryptionKey,
    })
    return
  }

  const baseline = baselineAtStart
  if ((!baseline || !initialState.baseRevisionId) && !reinitialize) {
    await patchSyncState({ paused: true, pauseReason: 'conflict' })
    return
  }
  const decision = reinitialize
    ? decideInitialization({ base: firstConnectionBase(), local, revisions })
    : decideSynchronization({
        baseRevisionId: initialState.baseRevisionId!,
        baseline: baseline!,
        local,
        revisions,
      })

  if (decision.action === 'unknown-ancestor') {
    await patchSyncState({ paused: true, pauseReason: 'conflict' })
    return
  }
  if (decision.action === 'conflict') {
    if (reinitialize) await setBaseline(decision.base)
    await setStoredConflict({
      version: 1,
      base: decision.base,
      conflicts: decision.conflicts,
      deviceLocal: decision.deviceLocal,
      local: decision.local,
      remote: decision.remote,
      remoteRevisionIds: decision.remoteRevisionIds,
      remainingRemoteRevisionIds: decision.remainingRemoteRevisionIds,
      remoteVersions: describeConflictRevisions(revisions, decision.remoteRevisionIds),
      stage: decision.stage,
    })
    await patchSyncState({ paused: true, pauseReason: 'conflict' })
    return
  }
  if (decision.action === 'up-to-date') {
    await finalizeSnapshot({
      operationId: pending.operationId,
      revisionId: decision.revisionId,
      snapshot: decision.snapshot,
      state: initialState,
      apply: !jsonEquals(local, decision.snapshot),
    })
    await writeDevicePresence(
      repository,
      metadata,
      initialState,
      decision.revisionId,
      encryptionKey,
      false,
    )
    await cleanupHistory(repository, metadata, initialState.historyLimit, encryptionKey)
    return
  }
  if (decision.action === 'apply-remote') {
    const wallpapers = await prepareIncomingWallpapers(
      repository,
      metadata,
      initialState,
      decision.remote.snapshot,
      decision.remote.assets,
      encryptionKey,
    )
    await finalizeSnapshot({
      operationId: pending.operationId,
      revisionId: decision.revisionId,
      snapshot: decision.remote.snapshot,
      state: initialState,
      apply: true,
      wallpapers,
    })
    await writeDevicePresence(
      repository,
      metadata,
      initialState,
      decision.revisionId,
      encryptionKey,
      false,
    )
    await cleanupHistory(repository, metadata, initialState.historyLimit, encryptionKey)
    return
  }

  const revisionId = pending.revisionId ?? crypto.randomUUID()
  const tombstones = mergeTombstones(
    decision.tombstones,
    deriveSnapshotTombstones(
      reinitialize ? firstConnectionBase() : baseline!,
      decision.snapshot,
      revisionId,
    ),
  )
  await publishAndFinalize({
    repository,
    metadata,
    vaultEtag: inspection.etag,
    state: initialState,
    pending: { ...pending, revisionId },
    parents: decision.parents,
    reason: decision.reason,
    snapshot: decision.snapshot,
    tombstones,
    knownAssets: decision.assets,
    encryptionKey,
  })
}

function pauseReasonFor(error: WebDavError): SyncPauseReason | undefined {
  if (error.category === 'authentication' || error.category === 'forbidden') return 'authentication'
  if (error.category === 'corrupted' || error.category === 'foreign-vault') return 'corrupted-remote'
  if (error.category === 'format-too-new') return 'format-too-new'
  if (error.category === 'encryption-locked') return 'encryption-password'
  if (error.category === 'not-found') return 'remote-deleted'
  if (error.category === 'generation-reset') return 'remote-reset'
  if (error.category === 'storage-full') return 'storage-full'
  return undefined
}

async function recordFailure(error: unknown): Promise<void> {
  const state = await getOrCreateSyncState()
  const webDavError =
    error instanceof WebDavError
      ? error
      : new WebDavError('invalid-response', 'Unexpected synchronization failure')
  const lastError: SanitizedSyncError = {
    category: webDavError.category,
    operationId: state.pending?.operationId ?? crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    phase: state.pending?.phase ?? 'unknown',
    status: webDavError.status,
  }
  const pauseReason = pauseReasonFor(webDavError)
  await patchSyncState({
    lastError,
    ...(pauseReason ? { paused: true, pauseReason } : {}),
  })
}

export async function synchronizeBrowser(): Promise<void> {
  for (let attempt = 0; attempt < MAX_CONCURRENCY_RESCANS; attempt += 1) {
    try {
      await runSynchronizationOnce()
      return
    } catch (error) {
      if (
        error instanceof WebDavError &&
        error.category === 'precondition' &&
        attempt + 1 < MAX_CONCURRENCY_RESCANS
      ) {
        const state = await getOrCreateSyncState()
        if (state.pending) {
          await patchSyncState({
            pending: { ...state.pending, phase: 'captured', revisionId: undefined },
          })
        }
        continue
      }
      await recordFailure(error)
      return
    }
  }
}

export async function unlockBrowserEncryption(password: string): Promise<LocalSyncStateV1> {
  const [config, state, webDavPassword] = await Promise.all([
    webDavSyncConfigStorage.getValue(),
    getOrCreateSyncState(),
    getWebDavPassword(),
  ])
  if (!config || !state.configured || !webDavPassword) {
    throw new WebDavError('authentication', 'WebDAV connection is not configured')
  }
  const repository = new WebDavVaultRepository(createClient(config, webDavPassword), config.directory)
  const inspection = await repository.inspect()
  if (inspection.state !== 'ready' || inspection.metadata.vaultId !== state.vaultId) {
    throw new WebDavError('foreign-vault', 'Configured WebDAV vault identity changed')
  }
  const metadata = inspection.metadata
  if (!metadata.encrypted || !metadata.encryption) {
    throw new WebDavError('invalid-response', 'WebDAV vault is not encrypted')
  }
  let key: CryptoKey
  try {
    key = await unlockVaultEncryption(
      password,
      metadata.vaultId,
      metadata.generationId,
      metadata.encryption,
    )
  } catch {
    throw new WebDavError('encryption-locked', 'Encryption password is incorrect')
  }
  await setStoredEncryptionKey(metadata.vaultId, metadata.generationId, key)
  return patchSyncState({
    encrypted: true,
    generationId: metadata.generationId,
    lastError: undefined,
    paused: false,
    pauseReason: undefined,
  })
}

export async function migrateBrowserVaultEncryption(input: {
  newPassword: string
  oldPassword?: string
}): Promise<LocalSyncStateV1> {
  const [config, state, webDavPassword] = await Promise.all([
    webDavSyncConfigStorage.getValue(),
    getOrCreateSyncState(),
    getWebDavPassword(),
  ])
  if (!config || !state.configured || !webDavPassword) {
    throw new WebDavError('authentication', 'WebDAV connection is not configured')
  }
  const repository = new WebDavVaultRepository(createClient(config, webDavPassword), config.directory)
  const inspection = await repository.inspect()
  if (
    inspection.state !== 'ready' ||
    inspection.metadata.vaultId !== state.vaultId ||
    inspection.metadata.generationId !== state.generationId
  ) {
    throw new WebDavError('foreign-vault', 'Configured WebDAV vault identity changed')
  }
  const current = inspection.metadata
  if (current.capabilities.mode !== 'conditional') {
    throw new WebDavError('unsupported', 'Encryption migration requires reliable conditional writes')
  }

  let oldKey: CryptoKey | undefined
  if (current.encrypted) {
    if (!current.encryption || !input.oldPassword) {
      throw new WebDavError('encryption-locked', 'Current encryption password is required')
    }
    try {
      oldKey = await unlockVaultEncryption(
        input.oldPassword,
        current.vaultId,
        current.generationId,
        current.encryption,
      )
    } catch {
      throw new WebDavError('encryption-locked', 'Current encryption password is incorrect')
    }
  }

  const sourceRevisions = await readRevisions(repository, current, oldKey)
  const heads = findRevisionHeads(sourceRevisions)
  if (heads.length !== 1) {
    throw new WebDavError('conflict', 'Resolve all synchronization conflicts before encryption')
  }
  const historyLimit = Math.min(20, Math.max(2, state.historyLimit))
  const retained = [...sourceRevisions]
    .sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        right.revisionId.localeCompare(left.revisionId),
    )
    .slice(0, historyLimit)
  if (!retained.some((revision) => revision.revisionId === heads[0]!.revisionId)) {
    retained.push(heads[0]!)
  }

  const generationId = crypto.randomUUID()
  const encrypted = await createVaultEncryption(
    input.newPassword,
    current.vaultId,
    generationId,
  )
  const next: VaultMetadataV1 = {
    ...current,
    generationId,
    encrypted: true,
    encryption: encrypted.metadata,
    currentRevisionId: heads[0]!.revisionId,
    reset: undefined,
  }
  await repository.prepareGeneration(next)
  const migratedAssets = await migrateCurrentWallpaperAssets(
    repository,
    current,
    next,
    heads[0]!,
    oldKey,
    encrypted.key,
  )

  const published: SyncRevisionV1[] = []
  for (const source of retained) {
    const assets = source.assets
      .map((asset) => migratedAssets.get(asset.sha256))
      .filter((asset): asset is AssetReferenceV1 => Boolean(asset))
    const revision: SyncRevisionV1 = {
      ...source,
      generationId,
      assets: [...new Map(assets.map((asset) => [asset.id, asset])).values()],
    }
    await repository.publishRevision(
      next,
      revision,
      await encryptRevision(next, revision, encrypted.key),
    )
    published.push(revision)
  }

  const verified = await readRevisions(repository, next, encrypted.key)
  if (
    verified.length !== published.length ||
    published.some((revision) => {
      const remote = verified.find((item) => item.revisionId === revision.revisionId)
      return !remote || canonicalJson(remote) !== canonicalJson(revision)
    })
  ) {
    throw new WebDavError('corrupted', 'Encrypted generation failed full verification')
  }

  await setStoredEncryptionKey(next.vaultId, next.generationId, encrypted.key)
  try {
    await repository.activateGeneration(current, inspection.etag, next)
  } catch (error) {
    await clearStoredEncryptionKey(next.vaultId, next.generationId)
    throw error
  }
  const migratedState = await patchSyncState({
    encrypted: true,
    generationId,
    lastError: undefined,
    lastSuccessAt: new Date().toISOString(),
    paused: false,
    pauseReason: undefined,
    pending: undefined,
  })
  await writeDevicePresence(
    repository,
    next,
    migratedState,
    heads[0]!.revisionId,
    encrypted.key,
    true,
  )
  try {
    await repository.deleteObsoleteGeneration(next, current.generationId)
    await clearStoredEncryptionKey(current.vaultId, current.generationId)
  } catch (error) {
    const webDavError = error instanceof WebDavError ? error : new WebDavError('server', 'Cleanup failed')
    await patchSyncState({
      lastError: {
        category: webDavError.category,
        operationId: crypto.randomUUID(),
        occurredAt: new Date().toISOString(),
        phase: 'unknown',
        status: webDavError.status,
        pathKind: 'vault',
      },
    })
  }
  return migratedState
}

async function migrateCurrentWallpaperAssets(
  repository: WebDavVaultRepository,
  current: VaultMetadataV1,
  next: VaultMetadataV1,
  head: SyncRevisionV1,
  oldKey: CryptoKey | undefined,
  newKey: CryptoKey,
): Promise<Map<string, AssetReferenceV1>> {
  const migrated = new Map<string, AssetReferenceV1>()
  for (const variant of ['light', 'dark'] as const) {
    const reference = head.snapshot.optional?.wallpapers?.[variant]
    if (!reference || migrated.has(reference.sha256)) continue
    const source = head.assets.find((asset) => asset.id === reference.assetId)
    let blob = await getLocalWallpaperBlob(variant, reference.sha256)
    if (!blob && source) blob = await readWallpaperAsset(repository, current, source, oldKey)
    if (!blob) {
      throw new WebDavError('corrupted', 'Current wallpaper is unavailable for encryption')
    }
    const storageId = crypto.randomUUID()
    const storedPayload = await encryptSyncBytes(
      newKey,
      await blob.arrayBuffer(),
      createEncryptionAad({
        vaultId: next.vaultId,
        generationId: next.generationId,
        objectType: 'asset',
        objectId: storageId,
      }),
    )
    const asset = await repository.publishEncryptedAsset(
      next,
      wallpaperRole(variant),
      blob,
      storageId,
      storedPayload,
    )
    await readWallpaperAsset(repository, next, asset, newKey)
    migrated.set(reference.sha256, asset)
  }
  return migrated
}

export interface BrowserWebDavSetupInput {
  connection: WebDavConnection
  directory?: string
  deviceName?: string
  encryptionPassword?: string
  historyLimit?: number
  rememberPassword: boolean
  scope?: Partial<LocalSyncStateV1['scope']>
}

export interface BrowserWebDavSetupPreview {
  capabilities: VaultMetadataV1['capabilities']
  conflicts: ReturnType<typeof mergeSyncSnapshots>['conflicts']
  encrypted: boolean
  generationId?: string
  headRevisionIds: string[]
  localSnapshotHash: string
  state: 'empty' | 'existing' | 'remote-conflict'
  vaultId?: string
}

interface SetupInspection {
  capabilities: VaultMetadataV1['capabilities']
  encryptionKey?: CryptoKey
  inspection: Awaited<ReturnType<WebDavVaultRepository['inspect']>>
  local: SyncSnapshotV1
  metadata?: VaultMetadataV1
  repository: WebDavVaultRepository
  revisions: SyncRevisionV1[]
}

function setupScope(input: BrowserWebDavSetupInput): LocalSyncStateV1['scope'] {
  return { ...DEFAULT_SYNC_SCOPE, ...input.scope }
}

async function inspectBrowserWebDavSetup(
  input: BrowserWebDavSetupInput,
): Promise<SetupInspection> {
  const client = new WebDavClient(input.connection)
  const repository = new WebDavVaultRepository(client, input.directory)
  const [capabilities, inspection, local] = await Promise.all([
    probeWebDavCapabilities(client),
    repository.inspect(),
    captureBrowserSyncSnapshot(setupScope(input)),
  ])
  if (inspection.state !== 'ready') {
    if (inspection.state === 'foreign') {
      throw new WebDavError('foreign-vault', 'WebDAV directory contains unrelated data')
    }
    return { capabilities, inspection, local, repository, revisions: [] }
  }
  const metadata = inspection.metadata
  let encryptionKey: CryptoKey | undefined
  if (metadata.encrypted) {
    if (!metadata.encryption || !input.encryptionPassword) {
      throw new WebDavError('encryption-locked', 'Encryption password is required')
    }
    try {
      encryptionKey = await unlockVaultEncryption(
        input.encryptionPassword,
        metadata.vaultId,
        metadata.generationId,
        metadata.encryption,
      )
    } catch {
      throw new WebDavError('encryption-locked', 'Encryption password is incorrect')
    }
  }
  const revisions = await readRevisions(repository, metadata, encryptionKey)
  return { capabilities, encryptionKey, inspection, local, metadata, repository, revisions }
}

function firstConnectionBase(): SyncSnapshotV1 {
  return {
    settings: {},
    quickLinks: { items: [], rootOrder: [], groups: [], groupOrder: [] },
    customSearchEngines: { items: [], order: [] },
    ui: {
      language: '__no_shared_baseline__',
      colorMode: '__no_shared_baseline__' as SyncSnapshotV1['ui']['colorMode'],
    },
  }
}

export async function previewBrowserWebDavSetup(
  input: BrowserWebDavSetupInput,
): Promise<BrowserWebDavSetupPreview> {
  const scanned = await inspectBrowserWebDavSetup(input)
  const localSnapshotHash = await hashCanonicalJson(scanned.local)
  if (!scanned.metadata || scanned.revisions.length === 0) {
    return {
      capabilities: scanned.metadata?.capabilities ?? scanned.capabilities,
      conflicts: [],
      encrypted: scanned.metadata?.encrypted ?? Boolean(input.encryptionPassword),
      generationId: scanned.metadata?.generationId,
      headRevisionIds: [],
      localSnapshotHash,
      state: 'empty',
      vaultId: scanned.metadata?.vaultId,
    }
  }
  const heads = findRevisionHeads(scanned.revisions)
  const decision = decideInitialization({
    base: firstConnectionBase(),
    local: scanned.local,
    revisions: scanned.revisions,
  })
  return {
    capabilities: scanned.metadata.capabilities,
    conflicts: decision.action === 'conflict' ? decision.conflicts : [],
    encrypted: scanned.metadata.encrypted,
    generationId: scanned.metadata.generationId,
    headRevisionIds: heads.map((revision) => revision.revisionId),
    localSnapshotHash,
    state: heads.length === 1 ? 'existing' : 'remote-conflict',
    vaultId: scanned.metadata.vaultId,
  }
}

export async function connectBrowserWebDav(
  input: BrowserWebDavSetupInput,
  expected: Pick<
    BrowserWebDavSetupPreview,
    'generationId' | 'headRevisionIds' | 'localSnapshotHash' | 'state' | 'vaultId'
  >,
): Promise<LocalSyncStateV1> {
  const existingState = await getOrCreateSyncState()
  if (existingState.configured) {
    throw new WebDavError('conflict', 'Disconnect the current WebDAV vault before connecting another')
  }
  const scanned = await inspectBrowserWebDavSetup(input)
  const heads = findRevisionHeads(scanned.revisions)
  const actualState = !scanned.metadata || scanned.revisions.length === 0
    ? 'empty'
    : heads.length === 1
      ? 'existing'
      : 'remote-conflict'
  if (
    actualState !== expected.state ||
    scanned.metadata?.vaultId !== expected.vaultId ||
    scanned.metadata?.generationId !== expected.generationId ||
    !jsonEquals(heads.map((revision) => revision.revisionId), expected.headRevisionIds) ||
    (await hashCanonicalJson(scanned.local)) !== expected.localSnapshotHash
  ) {
    throw new WebDavError('precondition', 'WebDAV data changed after the connection preview')
  }
  let metadata = scanned.metadata
  let encryptionKey = scanned.encryptionKey
  let vaultEtag = scanned.inspection.state === 'ready' ? scanned.inspection.etag : undefined
  if (!metadata) {
    const vaultId = crypto.randomUUID()
    const generationId = crypto.randomUUID()
    if (input.encryptionPassword) {
      const encryption = await createVaultEncryption(
        input.encryptionPassword,
        vaultId,
        generationId,
      )
      encryptionKey = encryption.key
      metadata = {
        product: 'lemon-new-tab',
        formatVersion: 1,
        vaultId,
        generationId,
        encrypted: true,
        encryption: encryption.metadata,
        capabilities: scanned.capabilities,
      }
    } else {
      metadata = {
        product: 'lemon-new-tab',
        formatVersion: 1,
        vaultId,
        generationId,
        encrypted: false,
        capabilities: scanned.capabilities,
      }
    }
    vaultEtag = (await scanned.repository.initialize(metadata)).etag
  }

  const deviceName = input.deviceName?.trim().slice(0, 80) || (await createPrivateDeviceName())
  const scope = setupScope(input)
  await webDavSyncConfigStorage.setValue({
    version: 1,
    connection: {
      baseUrl: input.connection.baseUrl,
      insecureHttpApproval: input.connection.insecureHttpApproval,
    },
    username: input.connection.username,
    directory: scanned.repository.directory,
    rememberPassword: input.rememberPassword,
  })
  await saveWebDavPassword(input.connection.password, input.rememberPassword)
  if (encryptionKey) {
    await setStoredEncryptionKey(metadata.vaultId, metadata.generationId, encryptionKey)
  }
  let state = await patchSyncState({
    baseRevisionId: undefined,
    configured: true,
    deviceFirstSeenAt: existingState.deviceFirstSeenAt ?? new Date().toISOString(),
    deviceName,
    encrypted: metadata.encrypted,
    generationId: metadata.generationId,
    historyLimit: Math.min(20, Math.max(2, input.historyLimit ?? 10)),
    lastError: undefined,
    paused: false,
    pauseReason: undefined,
    pending: undefined,
    scope,
    vaultId: metadata.vaultId,
  })
  if (heads.length === 0) {
    const pending: PendingSyncOperation = {
      operationId: crypto.randomUUID(),
      phase: 'captured',
      startedAt: new Date().toISOString(),
    }
    await publishAndFinalize({
      repository: scanned.repository,
      metadata,
      vaultEtag,
      state,
      pending,
      parents: [],
      reason: 'initial',
      snapshot: scanned.local,
      tombstones: [],
      knownAssets: [],
      encryptionKey,
    })
    return getOrCreateSyncState()
  }

  const base = firstConnectionBase()
  const combined = mergeRemoteRevisionHeads(base, scanned.revisions)
  if (!combined) throw new WebDavError('corrupted', 'Remote WebDAV revisions are unavailable')
  if (combined.kind === 'conflict') {
    await Promise.all([
      setBaseline(base),
      setStoredConflict({
        version: 1,
        base,
        conflicts: combined.conflicts,
        deviceLocal: scanned.local,
        local: combined.local,
        remote: combined.remote,
        remoteRevisionIds: combined.headRevisionIds,
        remainingRemoteRevisionIds: combined.remainingRemoteRevisionIds,
        remoteVersions: describeConflictRevisions(scanned.revisions, combined.headRevisionIds),
        stage: 'remote-branches',
      }),
    ])
    return patchSyncState({ paused: true, pauseReason: 'conflict' })
  }
  const remote = combined.state
  const comparison = mergeSyncSnapshots(base, scanned.local, remote.snapshot)
  if (comparison.conflicts.length > 0) {
    await Promise.all([
      setBaseline(base),
      setStoredConflict({
        version: 1,
        base,
        conflicts: comparison.conflicts,
        deviceLocal: scanned.local,
        local: scanned.local,
        remote: remote.snapshot,
        remoteRevisionIds: remote.headRevisionIds,
        remainingRemoteRevisionIds: [],
        remoteVersions: describeConflictRevisions(scanned.revisions, remote.headRevisionIds),
        stage: 'local-remote',
      }),
    ])
    state = await patchSyncState({ paused: true, pauseReason: 'conflict' })
    return state
  }
  if (remote.headRevisionIds.length === 1 && jsonEquals(comparison.snapshot, remote.snapshot)) {
    const wallpapers = await prepareIncomingWallpapers(
      scanned.repository,
      metadata,
      state,
      remote.snapshot,
      remote.assets,
      encryptionKey,
    )
    await finalizeSnapshot({
      operationId: crypto.randomUUID(),
      revisionId: remote.headRevisionIds[0]!,
      snapshot: remote.snapshot,
      state,
      apply: true,
      wallpapers,
    })
    await writeDevicePresence(
      scanned.repository,
      metadata,
      state,
      remote.headRevisionIds[0]!,
      encryptionKey,
      true,
    )
    return getOrCreateSyncState()
  }
  const pending: PendingSyncOperation = {
    operationId: crypto.randomUUID(),
    phase: 'captured',
    startedAt: new Date().toISOString(),
  }
  await publishAndFinalize({
    repository: scanned.repository,
    metadata,
    vaultEtag,
    state,
    pending,
    parents: remote.headRevisionIds,
    reason: 'merge',
    snapshot: comparison.snapshot,
    tombstones: remote.tombstones,
    knownAssets: remote.assets,
    encryptionKey,
  })
  return getOrCreateSyncState()
}

async function createPrivateDeviceName(): Promise<string> {
  const userAgent = navigator.userAgent
  const browserName = userAgent.includes('Edg/')
    ? 'Edge'
    : userAgent.includes('Firefox/')
      ? 'Firefox'
      : userAgent.includes('Chrome/')
        ? 'Chrome'
        : 'Browser'
  const platform = await browser.runtime.getPlatformInfo().catch(() => undefined)
  const osName = platform?.os === 'win'
    ? 'Windows'
    : platform?.os === 'mac'
      ? 'macOS'
      : platform?.os === 'android'
        ? 'Android'
        : platform?.os === 'linux'
          ? 'Linux'
          : 'Device'
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const random = crypto.getRandomValues(new Uint8Array(4))
  const suffix = Array.from(random, (value) => alphabet[value % alphabet.length]).join('')
  return `${browserName} · ${osName} · ${suffix}`
}

export async function writeDevicePresence(
  repository: WebDavVaultRepository,
  metadata: VaultMetadataV1,
  state: LocalSyncStateV1,
  revisionId: string,
  encryptionKey: CryptoKey | undefined,
  force: boolean,
): Promise<void> {
  const now = new Date().toISOString()
  if (!force && state.deviceRecordAt && Date.now() - Date.parse(state.deviceRecordAt) < 86_400_000) {
    return
  }
  const record: SyncDeviceRecordV1 = {
    deviceId: state.deviceId,
    firstSeenAt: state.deviceFirstSeenAt ?? now,
    formatVersion: 1,
    generationId: metadata.generationId,
    lastRevisionId: revisionId,
    lastSeenAt: now,
    name: state.deviceName,
    vaultId: metadata.vaultId,
  }
  let bytes = textEncoder.encode(canonicalJson(record))
  if (metadata.encrypted) {
    if (!encryptionKey) throw new WebDavError('encryption-locked', 'Encrypted WebDAV vault is locked')
    bytes = await encryptSyncBytes(
      encryptionKey,
      bytes,
      createEncryptionAad({
        vaultId: metadata.vaultId,
        generationId: metadata.generationId,
        objectType: 'device',
        objectId: state.deviceId,
      }),
    )
  }
  try {
    await repository.writeDevicePayload(metadata, state.deviceId, bytes)
    await patchSyncState({
      deviceFirstSeenAt: record.firstSeenAt,
      deviceRecordAt: now,
    })
  } catch {
    // 设备列表是辅助信息；写入失败不回滚已经验证的用户数据版本。
  }
}

export async function resolveBrowserSyncConflict(
  resolutions: readonly SyncConflictResolution[],
): Promise<LocalSyncStateV1> {
  const [config, state, webDavPassword, stored, baseline] = await Promise.all([
    webDavSyncConfigStorage.getValue(),
    getOrCreateSyncState(),
    getWebDavPassword(),
    getStoredConflict(),
    getBaseline(),
  ])
  if (
    !config ||
    !state.configured ||
    !webDavPassword ||
    state.pauseReason !== 'conflict' ||
    !stored ||
    !baseline
  ) {
    throw new WebDavError('conflict', 'No resolvable synchronization conflict exists')
  }
  const captured = await captureBrowserSyncSnapshot(state.scope)
  const local = preserveExcludedScope(captured, baseline, state.scope)
  const expectedLocal = stored.stage === 'remote-branches' ? stored.deviceLocal : stored.local
  if (!jsonEquals(local, expectedLocal)) {
    throw new WebDavError('precondition', 'Local data changed while resolving the conflict')
  }
  const repository = new WebDavVaultRepository(createClient(config, webDavPassword), config.directory)
  const inspection = await repository.inspect()
  if (
    inspection.state !== 'ready' ||
    inspection.metadata.vaultId !== state.vaultId ||
    inspection.metadata.generationId !== state.generationId
  ) {
    throw new WebDavError('foreign-vault', 'Configured WebDAV vault identity changed')
  }
  const metadata = inspection.metadata
  const encryptionKey = metadata.encrypted
    ? await getStoredEncryptionKey(metadata.vaultId, metadata.generationId)
    : undefined
  const revisions = await readRevisions(repository, metadata, encryptionKey)
  const heads = findRevisionHeads(revisions)
  const headIds = heads.map((revision) => revision.revisionId)
  if (!jsonEquals(headIds, [...stored.remoteRevisionIds].sort())) {
    throw new WebDavError('precondition', 'Remote data changed while resolving the conflict')
  }
  let snapshot = resolveSyncConflicts({
    base: stored.base,
    local: stored.local,
    remote: stored.remote,
    resolutions,
  })
  if (stored.stage === 'remote-branches') {
    const byId = new Map(heads.map((revision) => [revision.revisionId, revision]))
    for (const [index, revisionId] of stored.remainingRemoteRevisionIds.entries()) {
      const revision = byId.get(revisionId)
      if (!revision) throw new WebDavError('precondition', 'Remote branch changed while resolving the conflict')
      const merge = mergeSyncSnapshots(stored.base, snapshot, revision.snapshot)
      if (merge.conflicts.length > 0) {
        await setStoredConflict({
          ...stored,
          conflicts: merge.conflicts,
          local: snapshot,
          remote: revision.snapshot,
          remainingRemoteRevisionIds: stored.remainingRemoteRevisionIds.slice(index + 1),
        })
        return patchSyncState({ paused: true, pauseReason: 'conflict' })
      }
      snapshot = merge.snapshot
    }
    const merge = mergeSyncSnapshots(stored.base, stored.deviceLocal, snapshot)
    if (merge.conflicts.length > 0) {
      await setStoredConflict({
        ...stored,
        conflicts: merge.conflicts,
        local: stored.deviceLocal,
        remote: snapshot,
        remainingRemoteRevisionIds: [],
        stage: 'local-remote',
      })
      return patchSyncState({ paused: true, pauseReason: 'conflict' })
    }
    snapshot = merge.snapshot
  }
  const revisionId = crypto.randomUUID()
  const pending: PendingSyncOperation = {
    operationId: crypto.randomUUID(),
    phase: 'captured',
    revisionId,
    startedAt: new Date().toISOString(),
  }
  await patchSyncState({ pending })
  const knownAssets = new Map<string, AssetReferenceV1>()
  for (const asset of heads.flatMap((revision) => revision.assets)) {
    knownAssets.set(asset.id, asset)
  }
  await publishAndFinalize({
    repository,
    metadata,
    vaultEtag: inspection.etag,
    state,
    pending,
    parents: headIds,
    reason: 'merge',
    snapshot,
    tombstones: mergeTombstones(
      heads.flatMap((revision) => revision.tombstones),
      deriveSnapshotTombstones(baseline, snapshot, revisionId),
    ),
    knownAssets: [...knownAssets.values()],
    encryptionKey,
  })
  return getOrCreateSyncState()
}

export interface BrowserSyncHistoryEntry {
  createdAt: string
  deviceId: string
  deviceName: string
  integrity: 'verified'
  reason: SyncRevisionReason
  revisionId: string
  wallpaperAvailable: { dark?: boolean; light?: boolean }
}

export interface BrowserSyncHistoryPreview {
  currentSnapshotHash: string
  differences: SyncDifference[]
  headRevisionId: string
  revisionId: string
  truncated: boolean
  wallpaperUnavailable: Array<'dark' | 'light'>
}

export function describeConflictRevisions(
  revisions: readonly SyncRevisionV1[],
  revisionIds: readonly string[],
) {
  const selected = new Set(revisionIds)
  return revisions
    .filter((revision) => selected.has(revision.revisionId))
    .map((revision) => ({
      revisionId: revision.revisionId,
      deviceName: revision.device.name,
      modifiedAt: revision.createdAt,
    }))
}

export interface BrowserSyncDeviceEntry {
  deviceId: string
  firstSeenAt: string
  lastRevisionId: string
  lastSeenAt: string
  name: string
  stale: boolean
}

export async function openConfiguredVault(readAllRevisions = true): Promise<{
  encryptionKey?: CryptoKey
  inspection: Extract<Awaited<ReturnType<WebDavVaultRepository['inspect']>>, { state: 'ready' }>
  metadata: VaultMetadataV1
  repository: WebDavVaultRepository
  revisions: SyncRevisionV1[]
  state: LocalSyncStateV1
}> {
  const [config, state, webDavPassword] = await Promise.all([
    webDavSyncConfigStorage.getValue(),
    getOrCreateSyncState(),
    getWebDavPassword(),
  ])
  if (!config || !state.configured || !webDavPassword) {
    throw new WebDavError('authentication', 'WebDAV connection is not configured')
  }
  const repository = new WebDavVaultRepository(createClient(config, webDavPassword), config.directory)
  const inspection = await repository.inspect()
  if (
    inspection.state !== 'ready' ||
    inspection.metadata.vaultId !== state.vaultId ||
    inspection.metadata.generationId !== state.generationId
  ) {
    throw new WebDavError('foreign-vault', 'Configured WebDAV vault identity changed')
  }
  const metadata = inspection.metadata
  const encryptionKey = metadata.encrypted
    ? await getStoredEncryptionKey(metadata.vaultId, metadata.generationId)
    : undefined
  const revisions = readAllRevisions
    ? await readRevisions(repository, metadata, encryptionKey)
    : []
  return { encryptionKey, inspection, metadata, repository, revisions, state }
}
