import { CURRENT_CONFIG_VERSION } from '@/shared/settings'
import { browser } from 'wxt/browser'

import {
  captureBrowserSyncSnapshot,
  clearAllStagedWallpaperSyncCandidates,
  clearStagedWallpaperSyncCandidate,
  getStagedWallpaperSyncCandidate,
  getLocalWallpaperBlob,
  prepareAndApplyBrowserSnapshot,
  resumePendingBrowserApply,
  stageWallpaperSyncCandidate,
  type IncomingWallpaperResources,
} from './browserData.ts'
import { preserveExcludedScope } from './apply.ts'
import { canonicalJson, hashCanonicalJson, jsonEquals, sha256Hex } from './canonical.ts'
import {
  createEncryptionAad,
  createVaultEncryption,
  decryptSyncBytes,
  encryptSyncBytes,
  unlockVaultEncryption,
} from './crypto.ts'
import { resolveSyncConflicts } from './conflicts.ts'
import { deriveSnapshotTombstones, pruneExpiredTombstones } from './lifecycle.ts'
import { mergeSyncSnapshots } from './merge.ts'
import {
  DEFAULT_SYNC_SCOPE,
  clearWebDavConnection,
  clearPendingSnapshot,
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
  setPendingSnapshot,
  setStoredEncryptionKey,
  setStoredConflict,
  webDavSyncConfigStorage,
} from './localState.ts'
import { decideSynchronization, findRevisionHeads } from './syncDecision.ts'
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
import { validateSyncRevision, validateSyncSnapshot } from './validation.ts'
import { inspectStaticWallpaper } from './wallpaperCompression.ts'
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

function createClient(
  config: NonNullable<Awaited<ReturnType<typeof webDavSyncConfigStorage.getValue>>>,
  password: string,
): WebDavClient {
  return new WebDavClient({
    ...config.connection,
    username: config.username,
    password,
  })
}

async function readRevisions(
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
    revisions.push(revision)
  }
  return revisions
}

function mergeTombstones(
  existing: readonly TombstoneV1[],
  derived: readonly TombstoneV1[],
): TombstoneV1[] {
  const values = new Map<string, TombstoneV1>()
  for (const item of [...existing, ...derived]) values.set(`${item.entityType}\0${item.entityId}`, item)
  return pruneExpiredTombstones([...values.values()])
}

async function createRevision(input: {
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

async function finalizeSnapshot(input: {
  operationId: string
  revisionId: string
  snapshot: SyncSnapshotV1
  state: LocalSyncStateV1
  apply: boolean
  wallpapers?: IncomingWallpaperResources
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
      input.state.scope,
    )
    if (!jsonEquals(applied, input.snapshot)) {
      throw new WebDavError('corrupted', 'Applied local snapshot did not pass verification')
    }
  }

  await setBaseline(input.snapshot)
  await Promise.all([clearPendingSnapshot(), clearStoredConflict()])
  await patchSyncState({
    baseRevisionId: input.revisionId,
    lastSuccessAt: new Date().toISOString(),
    lastError: undefined,
    paused: false,
    pauseReason: undefined,
    pending: undefined,
  })
}

async function publishAndFinalize(input: {
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
}): Promise<void> {
  const revisionId = input.pending.revisionId ?? crypto.randomUUID()
  let pending = await setPendingPhase(input.pending, 'captured', revisionId)
  let snapshot = input.snapshot
  let assets: AssetReferenceV1[]
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
    snapshot = withoutWallpapers(snapshot)
    assets = []
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
      !snapshot.optional?.wallpapers
    ) {
      throw error
    }
    const orphanAssets = assets
    snapshot = withoutWallpapers(snapshot)
    assets = []
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
    await patchSyncState({ wallpaperStatus: 'storage-full' })
    for (const asset of orphanAssets) {
      await input.repository.deleteAsset(asset).catch(() => undefined)
    }
  }
  pending = await setPendingPhase(pending, 'committed', revisionId)

  const revisionsAfterPublish = await readRevisions(
    input.repository,
    input.metadata,
    input.encryptionKey,
  )
  const heads = findRevisionHeads(revisionsAfterPublish)
  if (heads.length !== 1 || heads[0]?.revisionId !== revisionId) {
    throw new WebDavError('precondition', 'A concurrent remote branch must be merged')
  }
  const wallpapers = await prepareIncomingWallpapers(
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
  })
  await clearAllStagedWallpaperSyncCandidates()
  if (snapshot.optional?.wallpapers) await patchSyncState({ wallpaperStatus: undefined })
  await writeDevicePresence(
    input.repository,
    input.metadata,
    input.state,
    revisionId,
    input.encryptionKey,
    true,
  )
  await cleanupHistory(
    input.repository,
    input.metadata,
    input.state.historyLimit,
    input.encryptionKey,
  )
}

function withoutWallpapers(snapshot: SyncSnapshotV1): SyncSnapshotV1 {
  const result = structuredClone(snapshot)
  if (result.optional?.wallpapers) delete result.optional.wallpapers
  if (result.optional && Object.keys(result.optional).length === 0) delete result.optional
  return result
}

async function encryptRevision(
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

async function cleanupHistory(
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

async function resolveRevisionAssets(
  repository: WebDavVaultRepository,
  metadata: VaultMetadataV1,
  snapshot: SyncSnapshotV1,
  knownAssets: readonly AssetReferenceV1[],
  encryptionKey?: CryptoKey,
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

async function prepareIncomingWallpapers(
  repository: WebDavVaultRepository,
  metadata: VaultMetadataV1,
  state: LocalSyncStateV1,
  snapshot: SyncSnapshotV1,
  assets: readonly AssetReferenceV1[],
  encryptionKey?: CryptoKey,
): Promise<IncomingWallpaperResources | undefined> {
  if (!state.scope.wallpapers) return undefined
  const result: IncomingWallpaperResources = {}
  for (const variant of ['light', 'dark'] as const) {
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

async function readWallpaperAsset(
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
  const capturedLocal = await captureBrowserSyncSnapshot(initialState.scope)
  const local = baselineAtStart
    ? preserveExcludedScope(capturedLocal, baselineAtStart, initialState.scope)
    : capturedLocal
  await setPendingSnapshot(local)
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
  if (!baseline || !initialState.baseRevisionId) {
    await patchSyncState({ paused: true, pauseReason: 'conflict' })
    return
  }
  const decision = decideSynchronization({
    baseRevisionId: initialState.baseRevisionId,
    baseline,
    local,
    revisions,
  })

  if (decision.action === 'unknown-ancestor') {
    await patchSyncState({ paused: true, pauseReason: 'conflict' })
    return
  }
  if (decision.action === 'conflict') {
    await setStoredConflict({
      version: 1,
      base: decision.base,
      local: decision.local,
      remote: decision.remote,
      remoteRevisionIds: decision.remoteRevisionIds,
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
    deriveSnapshotTombstones(baseline, decision.snapshot, revisionId),
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
  if (!scanned.metadata || scanned.revisions.length === 0) {
    return {
      capabilities: scanned.metadata?.capabilities ?? scanned.capabilities,
      conflicts: [],
      encrypted: scanned.metadata?.encrypted ?? Boolean(input.encryptionPassword),
      generationId: scanned.metadata?.generationId,
      headRevisionIds: [],
      state: 'empty',
      vaultId: scanned.metadata?.vaultId,
    }
  }
  const heads = findRevisionHeads(scanned.revisions)
  if (heads.length !== 1) {
    return {
      capabilities: scanned.metadata.capabilities,
      conflicts: [],
      encrypted: scanned.metadata.encrypted,
      generationId: scanned.metadata.generationId,
      headRevisionIds: heads.map((revision) => revision.revisionId),
      state: 'remote-conflict',
      vaultId: scanned.metadata.vaultId,
    }
  }
  const comparison = mergeSyncSnapshots(firstConnectionBase(), scanned.local, heads[0]!.snapshot)
  return {
    capabilities: scanned.metadata.capabilities,
    conflicts: comparison.conflicts,
    encrypted: scanned.metadata.encrypted,
    generationId: scanned.metadata.generationId,
    headRevisionIds: [heads[0]!.revisionId],
    state: 'existing',
    vaultId: scanned.metadata.vaultId,
  }
}

export async function connectBrowserWebDav(
  input: BrowserWebDavSetupInput,
  expected: Pick<BrowserWebDavSetupPreview, 'generationId' | 'headRevisionIds' | 'state' | 'vaultId'>,
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
    !jsonEquals(heads.map((revision) => revision.revisionId), expected.headRevisionIds)
  ) {
    throw new WebDavError('precondition', 'WebDAV data changed after the connection preview')
  }
  if (actualState === 'remote-conflict') {
    throw new WebDavError('conflict', 'Existing WebDAV branches must be resolved first')
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
  const remote = heads[0]!
  const comparison = mergeSyncSnapshots(base, scanned.local, remote.snapshot)
  if (comparison.conflicts.length > 0) {
    await Promise.all([
      setBaseline(base),
      setStoredConflict({
        version: 1,
        base,
        local: scanned.local,
        remote: remote.snapshot,
        remoteRevisionIds: [remote.revisionId],
      }),
    ])
    state = await patchSyncState({ paused: true, pauseReason: 'conflict' })
    return state
  }
  if (jsonEquals(comparison.snapshot, remote.snapshot)) {
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
      revisionId: remote.revisionId,
      snapshot: remote.snapshot,
      state,
      apply: true,
      wallpapers,
    })
    await writeDevicePresence(
      scanned.repository,
      metadata,
      state,
      remote.revisionId,
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
    parents: [remote.revisionId],
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

async function writeDevicePresence(
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
  if (!jsonEquals(local, stored.local)) {
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
  const snapshot = resolveSyncConflicts({
    base: stored.base,
    local: stored.local,
    remote: stored.remote,
    resolutions,
  })
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

export interface BrowserSyncDeviceEntry {
  deviceId: string
  firstSeenAt: string
  lastRevisionId: string
  lastSeenAt: string
  name: string
  stale: boolean
}

async function openConfiguredVault(readAllRevisions = true): Promise<{
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
    } catch {
      corrupted.push(commit)
    }
  }
  return { corrupted, valid }
}

export async function inspectBrowserSyncCorruption(): Promise<BrowserCorruptionInspection> {
  const opened = await openConfiguredVault(false)
  const scan = await scanCorruptedRevisions(opened)
  if (scan.corrupted.length !== 1) {
    throw new WebDavError('corrupted', 'Corruption repair requires exactly one damaged revision')
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
  if (opened.metadata.capabilities.mode !== 'conditional') {
    throw new WebDavError('unsupported', 'Corruption repair requires reliable conditional writes')
  }
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
  const captured = await captureBrowserSyncSnapshot(opened.state.scope)
  const local = preserveExcludedScope(captured, previous.snapshot, opened.state.scope)
  const choice = jsonEquals(local, previous.snapshot) ? 'previous' : input.choice
  if (choice !== 'local' && choice !== 'previous') {
    throw new WebDavError('conflict', 'Choose local data or the previous cloud version')
  }
  const snapshot = choice === 'local' ? local : previous.snapshot
  await opened.repository.deleteRevision(opened.metadata, commit.revisionId)
  const pending: PendingSyncOperation = {
    operationId: crypto.randomUUID(),
    phase: 'captured',
    startedAt: new Date().toISOString(),
  }
  await publishAndFinalize({
    repository: opened.repository,
    metadata: opened.metadata,
    vaultEtag: opened.inspection.etag,
    state: opened.state,
    pending,
    parents: [previous.revisionId],
    reason: 'repair',
    snapshot,
    tombstones: previous.tombstones,
    knownAssets: scan.valid.flatMap((revision) => revision.assets),
    encryptionKey: opened.encryptionKey,
  })
  return getOrCreateSyncState()
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

export async function restoreBrowserSyncHistory(revisionId: string): Promise<LocalSyncStateV1> {
  const opened = await openConfiguredVault()
  if (opened.state.paused) throw new WebDavError('conflict', 'Resolve sync status before restoring history')
  const heads = findRevisionHeads(opened.revisions)
  if (heads.length !== 1) throw new WebDavError('conflict', 'Resolve remote branches first')
  const target = opened.revisions.find((revision) => revision.revisionId === revisionId)
  if (!target) throw new WebDavError('not-found', 'History revision no longer exists')
  const snapshot = structuredClone(target.snapshot)
  const knownAssets = new Map<string, AssetReferenceV1>()
  for (const asset of opened.revisions.flatMap((revision) => revision.assets)) {
    knownAssets.set(asset.id, asset)
  }
  for (const variant of ['light', 'dark'] as const) {
    const historical = snapshot.optional?.wallpapers?.[variant]
    if (!historical || knownAssets.has(historical.assetId)) continue
    const current = heads[0]!.snapshot.optional?.wallpapers?.[variant]
    if (current && knownAssets.has(current.assetId)) {
      snapshot.optional!.wallpapers![variant] = structuredClone(current)
    } else if (snapshot.optional?.wallpapers) {
      delete snapshot.optional.wallpapers[variant]
    }
  }
  if (snapshot.optional?.wallpapers && Object.keys(snapshot.optional.wallpapers).length === 0) {
    delete snapshot.optional.wallpapers
  }
  if (snapshot.optional && Object.keys(snapshot.optional).length === 0) delete snapshot.optional
  const pending: PendingSyncOperation = {
    operationId: crypto.randomUUID(),
    phase: 'captured',
    startedAt: new Date().toISOString(),
  }
  await publishAndFinalize({
    repository: opened.repository,
    metadata: opened.metadata,
    vaultEtag: opened.inspection.etag,
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

export async function stopAndDeleteBrowserSyncedWallpapers(): Promise<LocalSyncStateV1> {
  const opened = await openConfiguredVault()
  if (opened.state.paused) throw new WebDavError('conflict', 'Resolve sync status first')
  const heads = findRevisionHeads(opened.revisions)
  if (heads.length !== 1) throw new WebDavError('conflict', 'Resolve remote branches first')
  const baseline = await getBaseline()
  if (!baseline || opened.state.baseRevisionId !== heads[0]!.revisionId) {
    throw new WebDavError('precondition', 'Synchronize core data before deleting wallpapers')
  }
  const local = preserveExcludedScope(
    await captureBrowserSyncSnapshot(opened.state.scope),
    baseline,
    opened.state.scope,
  )
  if (!jsonEquals(withoutWallpapers(local), withoutWallpapers(heads[0]!.snapshot))) {
    throw new WebDavError('precondition', 'Synchronize core data before deleting wallpapers')
  }
  const snapshot = withoutWallpapers(heads[0]!.snapshot)
  const pending: PendingSyncOperation = {
    operationId: crypto.randomUUID(),
    phase: 'captured',
    startedAt: new Date().toISOString(),
  }
  await publishAndFinalize({
    repository: opened.repository,
    metadata: opened.metadata,
    vaultEtag: opened.inspection.etag,
    state: opened.state,
    pending,
    parents: [heads[0]!.revisionId],
    reason: 'local-change',
    snapshot,
    tombstones: heads[0]!.tombstones,
    knownAssets: [],
    encryptionKey: opened.encryptionKey,
  })
  const assets = new Map<string, AssetReferenceV1>()
  for (const asset of opened.revisions.flatMap((revision) => revision.assets)) {
    assets.set(asset.path, asset)
  }
  await patchSyncState({
    scope: { ...opened.state.scope, wallpapers: false },
    wallpaperStatus: undefined,
  })
  for (const asset of assets.values()) await opened.repository.deleteAsset(asset)
  return getOrCreateSyncState()
}

export async function commitCompressedBrowserWallpaper(
  variant: 'dark' | 'light',
  blob: Blob,
): Promise<LocalSyncStateV1> {
  await inspectStaticWallpaper(blob)
  const opened = await openConfiguredVault()
  if (opened.state.paused || !opened.state.scope.wallpapers) {
    throw new WebDavError('conflict', 'Wallpaper sync is not ready')
  }
  const baseline = await getBaseline()
  if (!baseline || !opened.state.baseRevisionId) {
    throw new WebDavError('conflict', 'Synchronization baseline is unavailable')
  }
  const local = preserveExcludedScope(
    await captureBrowserSyncSnapshot(opened.state.scope),
    baseline,
    opened.state.scope,
  )
  const reference = await stageWallpaperSyncCandidate(variant, blob)
  local.optional ??= {}
  local.optional.wallpapers ??= {}
  local.optional.wallpapers[variant] = reference
  const decision = decideSynchronization({
    baseRevisionId: opened.state.baseRevisionId,
    baseline,
    local,
    revisions: opened.revisions,
  })
  if (decision.action === 'unknown-ancestor') {
    await clearStagedWallpaperSyncCandidate(variant, reference.sha256)
    throw new WebDavError('conflict', 'Remote history no longer contains the local baseline')
  }
  if (decision.action === 'conflict') {
    await setStoredConflict({
      version: 1,
      base: decision.base,
      local: decision.local,
      remote: decision.remote,
      remoteRevisionIds: decision.remoteRevisionIds,
    })
    return patchSyncState({ paused: true, pauseReason: 'conflict' })
  }
  if (decision.action !== 'publish') {
    await clearStagedWallpaperSyncCandidate(variant, reference.sha256)
    throw new WebDavError('precondition', 'Wallpaper candidate did not create a new version')
  }
  const revisionId = crypto.randomUUID()
  const pending: PendingSyncOperation = {
    operationId: crypto.randomUUID(),
    phase: 'captured',
    revisionId,
    startedAt: new Date().toISOString(),
  }
  try {
    await publishAndFinalize({
      repository: opened.repository,
      metadata: opened.metadata,
      vaultEtag: opened.inspection.etag,
      state: opened.state,
      pending,
      parents: decision.parents,
      reason: decision.reason,
      snapshot: decision.snapshot,
      tombstones: mergeTombstones(
        decision.tombstones,
        deriveSnapshotTombstones(baseline, decision.snapshot, revisionId),
      ),
      knownAssets: decision.assets,
      encryptionKey: opened.encryptionKey,
    })
  } catch (error) {
    await clearStagedWallpaperSyncCandidate(variant, reference.sha256)
    throw error
  }
  return getOrCreateSyncState()
}

export const DELETE_REMOTE_CONFIRMATION = 'DELETE WEBDAV DATA'

export async function updateBrowserSyncPreferences(input: {
  historyLimit?: number
  scope?: Partial<LocalSyncStateV1['scope']>
}): Promise<LocalSyncStateV1> {
  const state = await getOrCreateSyncState()
  return patchSyncState({
    historyLimit:
      input.historyLimit === undefined
        ? state.historyLimit
        : Math.min(20, Math.max(2, Math.trunc(input.historyLimit))),
    scope: { ...state.scope, ...input.scope },
    ...(input.scope?.wallpapers ? { wallpaperStatus: undefined } : {}),
  })
}

export async function resetBrowserSyncedData(
  targetSnapshot: SyncSnapshotV1,
  encryptionPassword?: string,
): Promise<LocalSyncStateV1> {
  const validation = validateSyncSnapshot(targetSnapshot)
  if (!validation.ok) throw new WebDavError('corrupted', validation.error)
  const opened = await openConfiguredVault()
  if (opened.metadata.capabilities.mode !== 'conditional') {
    throw new WebDavError('unsupported', 'Global reset requires reliable conditional writes')
  }
  const heads = findRevisionHeads(opened.revisions)
  if (heads.length !== 1) throw new WebDavError('conflict', 'Resolve remote branches before reset')

  let oldKey = opened.encryptionKey
  let newKey: CryptoKey | undefined
  let encryption: VaultMetadataV1['encryption']
  const generationId = crypto.randomUUID()
  if (opened.metadata.encrypted) {
    if (!opened.metadata.encryption || !encryptionPassword) {
      throw new WebDavError('encryption-locked', 'Current encryption password is required')
    }
    try {
      oldKey = await unlockVaultEncryption(
        encryptionPassword,
        opened.metadata.vaultId,
        opened.metadata.generationId,
        opened.metadata.encryption,
      )
    } catch {
      throw new WebDavError('encryption-locked', 'Current encryption password is incorrect')
    }
    const created = await createVaultEncryption(
      encryptionPassword,
      opened.metadata.vaultId,
      generationId,
    )
    newKey = created.key
    encryption = created.metadata
  }
  const resetRevisionId = crypto.randomUUID()
  const next: VaultMetadataV1 = {
    ...opened.metadata,
    generationId,
    currentRevisionId: resetRevisionId,
    encryption,
    reset: {
      previousGenerationId: opened.metadata.generationId,
      resetRevisionId,
    },
  }
  await opened.repository.prepareGeneration(next)
  const anchor: SyncRevisionV1 = {
    ...heads[0]!,
    generationId,
    assets: [],
  }
  await opened.repository.publishRevision(
    next,
    anchor,
    next.encrypted ? await encryptRevision(next, anchor, newKey) : undefined,
  )
  const assets = await resolveRevisionAssets(
    opened.repository,
    next,
    validation.value,
    [],
    newKey,
  )
  const resetRevision = await createRevision({
    metadata: next,
    state: opened.state,
    operationId: crypto.randomUUID(),
    revisionId: resetRevisionId,
    parents: [anchor.revisionId],
    reason: 'reset',
    snapshot: validation.value,
    tombstones: mergeTombstones(
      anchor.tombstones,
      deriveSnapshotTombstones(anchor.snapshot, validation.value, resetRevisionId),
    ),
    assets,
  })
  await opened.repository.publishRevision(
    next,
    resetRevision,
    next.encrypted ? await encryptRevision(next, resetRevision, newKey) : undefined,
  )
  const verified = await readRevisions(opened.repository, next, newKey)
  if (
    verified.length !== 2 ||
    !verified.some((revision) => canonicalJson(revision) === canonicalJson(anchor)) ||
    !verified.some((revision) => canonicalJson(revision) === canonicalJson(resetRevision))
  ) {
    throw new WebDavError('corrupted', 'Reset generation failed full verification')
  }
  if (newKey) await setStoredEncryptionKey(next.vaultId, next.generationId, newKey)
  try {
    await opened.repository.activateGeneration(opened.metadata, opened.inspection.etag, next)
  } catch (error) {
    if (newKey) await clearStoredEncryptionKey(next.vaultId, next.generationId)
    throw error
  }
  const nextState = await patchSyncState({
    encrypted: next.encrypted,
    generationId,
    paused: false,
    pauseReason: undefined,
  })
  const wallpapers = await prepareIncomingWallpapers(
    opened.repository,
    next,
    nextState,
    validation.value,
    assets,
    newKey,
  )
  await finalizeSnapshot({
    operationId: resetRevision.operationId,
    revisionId: resetRevisionId,
    snapshot: validation.value,
    state: nextState,
    apply: true,
    wallpapers,
  })
  await writeDevicePresence(
    opened.repository,
    next,
    nextState,
    resetRevisionId,
    newKey,
    true,
  )
  try {
    await opened.repository.deleteObsoleteGeneration(next, opened.metadata.generationId)
    if (oldKey) {
      await clearStoredEncryptionKey(opened.metadata.vaultId, opened.metadata.generationId)
    }
  } catch {
    // 新代际已经完整切换；旧代际清理失败留待后续状态页重试，不回滚新数据。
  }
  return getOrCreateSyncState()
}

export async function acceptBrowserRemoteReset(input: {
  encryptionPassword?: string
  mode: 'apply' | 'merge'
}): Promise<LocalSyncStateV1> {
  const [config, state, webDavPassword] = await Promise.all([
    webDavSyncConfigStorage.getValue(),
    getOrCreateSyncState(),
    getWebDavPassword(),
  ])
  if (!config || !state.configured || !webDavPassword || state.pauseReason !== 'remote-reset') {
    throw new WebDavError('generation-reset', 'No remote reset is waiting for a decision')
  }
  const repository = new WebDavVaultRepository(createClient(config, webDavPassword), config.directory)
  const inspection = await repository.inspect()
  if (
    inspection.state !== 'ready' ||
    inspection.metadata.vaultId !== state.vaultId ||
    inspection.metadata.reset?.previousGenerationId !== state.generationId
  ) {
    throw new WebDavError('foreign-vault', 'Remote reset marker is invalid')
  }
  const metadata = inspection.metadata
  const reset = metadata.reset
  if (!reset) throw new WebDavError('corrupted', 'Remote reset marker is missing')
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
    await setStoredEncryptionKey(metadata.vaultId, metadata.generationId, encryptionKey)
  }
  const revisions = await readRevisions(repository, metadata, encryptionKey)
  const heads = findRevisionHeads(revisions)
  if (
    heads.length !== 1 ||
    heads[0]!.revisionId !== reset.resetRevisionId
  ) {
    throw new WebDavError('corrupted', 'Remote reset revision is missing')
  }
  const nextState = await patchSyncState({
    encrypted: metadata.encrypted,
    generationId: metadata.generationId,
    lastError: undefined,
    paused: false,
    pauseReason: undefined,
  })
  if (input.mode === 'merge') {
    await synchronizeBrowser()
    return getOrCreateSyncState()
  }
  const wallpapers = await prepareIncomingWallpapers(
    repository,
    metadata,
    nextState,
    heads[0]!.snapshot,
    heads[0]!.assets,
    encryptionKey,
  )
  await finalizeSnapshot({
    operationId: crypto.randomUUID(),
    revisionId: heads[0]!.revisionId,
    snapshot: heads[0]!.snapshot,
    state: nextState,
    apply: true,
    wallpapers,
  })
  return getOrCreateSyncState()
}

export async function disconnectBrowserWebDav(input: {
  deleteRemote: boolean
  confirmationText?: string
}): Promise<LocalSyncStateV1> {
  const state = await getOrCreateSyncState()
  if (!state.configured) return state
  if (input.deleteRemote) {
    if (input.confirmationText !== DELETE_REMOTE_CONFIRMATION || !state.vaultId) {
      throw new WebDavError('forbidden', 'Remote deletion confirmation is invalid')
    }
    const opened = await openConfiguredVault()
    await opened.repository.deleteOwnedVault(state.vaultId)
  }
  await clearWebDavConnection()
  return getOrCreateSyncState()
}
