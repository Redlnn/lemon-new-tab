import {
  createClient,
  createRevision,
  encryptRevision,
  finalizeSnapshot,
  mergeTombstones,
  openConfiguredVault,
  prepareIncomingWallpapers,
  readRevisions,
  resolveRevisionAssets,
  synchronizeBrowser,
  writeDevicePresence,
} from './browserEngine.ts'
import { canonicalJson } from './canonical.ts'
import { createVaultEncryption, unlockVaultEncryption } from './crypto.ts'
import { deriveSnapshotTombstones } from './lifecycle.ts'
import {
  clearStoredEncryptionKey,
  clearWebDavConnection,
  getOrCreateSyncState,
  getWebDavPassword,
  patchSyncState,
  setStoredEncryptionKey,
  webDavSyncConfigStorage,
} from './localState.ts'
import { findRevisionHeads } from './syncDecision.ts'
import type {
  LocalSyncStateV1,
  SyncRevisionV1,
  SyncSnapshotV1,
  VaultMetadataV1,
} from './types.ts'
import { validateSyncSnapshot } from './validation.ts'
import { WebDavError, WebDavVaultRepository } from './webdav.ts'

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
  importedWallpapers: Partial<Record<'dark' | 'light', Blob>> = {},
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
    importedWallpapers,
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
  const incomingWallpapers = await prepareIncomingWallpapers(
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
    wallpapers: incomingWallpapers,
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
