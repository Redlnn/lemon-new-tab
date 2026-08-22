import { mergeSyncSnapshots } from './merge.ts'
import type {
  JsonObject,
  JsonValue,
  SyncConflict,
  SyncConflictResolution,
  SyncSnapshotV1,
} from './types.ts'
import { validateSyncSnapshot } from './validation.ts'

type EntityValue = { id: string; [key: string]: JsonValue }

export function resolveSyncConflicts(input: {
  base: SyncSnapshotV1
  local: SyncSnapshotV1
  remote: SyncSnapshotV1
  resolutions: readonly SyncConflictResolution[]
}): SyncSnapshotV1 {
  if (
    input.resolutions.some(
      (item) =>
        !item ||
        typeof item.conflictId !== 'string' ||
        !['both', 'local', 'remote'].includes(item.choice) ||
        (item.duplicateId !== undefined && typeof item.duplicateId !== 'string'),
    )
  ) {
    throw new TypeError('Conflict resolution is invalid')
  }
  const merged = mergeSyncSnapshots(input.base, input.local, input.remote)
  if (merged.conflicts.length === 0) return merged.snapshot
  const choices = new Map(input.resolutions.map((item) => [item.conflictId, item]))
  if (choices.size !== input.resolutions.length) throw new TypeError('Conflict resolution is duplicated')
  const snapshot = structuredClone(merged.snapshot)
  for (const conflict of merged.conflicts) {
    const resolution = choices.get(conflict.id)
    if (!resolution) throw new TypeError(`Conflict resolution is missing: ${conflict.id}`)
    if (resolution.choice === 'both') {
      if (!conflict.canKeepBoth || !resolution.duplicateId) {
        throw new TypeError(`Conflict cannot keep both values: ${conflict.id}`)
      }
      keepBothEntities(snapshot, input.local, input.remote, conflict, resolution.duplicateId)
    } else {
      applySelectedValue(
        snapshot,
        resolution.choice === 'local' ? input.local : input.remote,
        conflict,
        resolution.choice,
      )
    }
  }
  if (choices.size !== merged.conflicts.length) throw new TypeError('Unknown conflict resolution')
  const validation = validateSyncSnapshot(snapshot)
  if (!validation.ok) throw new TypeError(validation.error)
  return validation.value
}

function applySelectedValue(
  target: SyncSnapshotV1,
  source: SyncSnapshotV1,
  conflict: SyncConflict,
  side: 'local' | 'remote',
): void {
  const selected = side === 'local' ? conflict.local : conflict.remote
  const present = Object.hasOwn(conflict, side)
  if (conflict.kind === 'delete-vs-modify' || conflict.kind === 'simultaneous-create') {
    applyEntity(target, source, conflict, present ? selected : undefined)
    return
  }
  applyPathValue(target, conflict.path, selected, present)
}

function entityTarget(
  snapshot: SyncSnapshotV1,
  conflict: SyncConflict,
): { items: EntityValue[]; order: string[] } {
  if (conflict.path.startsWith('quickLinks.items.')) {
    return {
      items: snapshot.quickLinks.items as unknown as EntityValue[],
      order: snapshot.quickLinks.rootOrder,
    }
  }
  if (conflict.path.startsWith('quickLinks.groups.')) {
    return {
      items: snapshot.quickLinks.groups as unknown as EntityValue[],
      order: snapshot.quickLinks.groupOrder,
    }
  }
  if (conflict.path.startsWith('customSearchEngines.items.')) {
    return {
      items: snapshot.customSearchEngines.items as unknown as EntityValue[],
      order: snapshot.customSearchEngines.order,
    }
  }
  if (conflict.path.startsWith('optional.searchHistory.items.')) {
    snapshot.optional ??= {}
    snapshot.optional.searchHistory ??= { items: [], order: [] }
    return {
      items: snapshot.optional.searchHistory.items as unknown as EntityValue[],
      order: snapshot.optional.searchHistory.order,
    }
  }
  throw new TypeError(`Unsupported entity conflict: ${conflict.path}`)
}

function entityId(conflict: SyncConflict): string {
  const prefix = conflict.path.startsWith('quickLinks.items.')
    ? 'quickLinks.items.'
    : conflict.path.startsWith('quickLinks.groups.')
      ? 'quickLinks.groups.'
    : conflict.path.startsWith('customSearchEngines.items.')
      ? 'customSearchEngines.items.'
      : 'optional.searchHistory.items.'
  return conflict.path.slice(prefix.length)
}

function applyEntity(
  target: SyncSnapshotV1,
  source: SyncSnapshotV1,
  conflict: SyncConflict,
  value: JsonValue | undefined,
): void {
  const id = entityId(conflict)
  const destination = entityTarget(target, conflict)
  removeEntity(destination, target, conflict, id)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const entity = structuredClone(value) as EntityValue
  if (conflict.path.startsWith('quickLinks.groups.')) {
    const sourceGroup = source.quickLinks.groups.find((group) => group.id === id)
    const validIds = new Set(target.quickLinks.items.map((item) => item.id))
    const itemIds = sourceGroup?.itemIds.filter((itemId) => validIds.has(itemId)) ?? []
    for (const itemId of itemIds) {
      target.quickLinks.rootOrder = target.quickLinks.rootOrder.filter((item) => item !== itemId)
      for (const group of target.quickLinks.groups) {
        group.itemIds = group.itemIds.filter((item) => item !== itemId)
      }
    }
    entity.itemIds = itemIds
  }
  destination.items.push(entity)
  insertEntityOrder(destination.order, target, source, conflict, id, id)
}

function keepBothEntities(
  target: SyncSnapshotV1,
  local: SyncSnapshotV1,
  remote: SyncSnapshotV1,
  conflict: SyncConflict,
  duplicateId: string,
): void {
  if (!duplicateId || duplicateId.length > 128) throw new TypeError('Duplicate entity ID is invalid')
  const originalId = entityId(conflict)
  const destination = entityTarget(target, conflict)
  if (destination.items.some((item) => item.id === duplicateId)) {
    throw new TypeError('Duplicate entity ID already exists')
  }
  const localValue = Object.hasOwn(conflict, 'local') ? conflict.local : undefined
  const remoteValue = Object.hasOwn(conflict, 'remote') ? conflict.remote : undefined
  const modified = conflict.kind === 'simultaneous-create' ? remoteValue : (localValue ?? remoteValue)
  if (!modified || typeof modified !== 'object' || Array.isArray(modified)) {
    throw new TypeError('Conflict has no entity to duplicate')
  }
  if (conflict.kind === 'delete-vs-modify') {
    removeEntity(destination, target, conflict, originalId)
  }
  const duplicate = { ...(structuredClone(modified) as JsonObject), id: duplicateId } as EntityValue
  destination.items.push(duplicate)
  const source = conflict.kind === 'simultaneous-create' || !localValue ? remote : local
  insertEntityOrder(destination.order, target, source, conflict, originalId, duplicateId)
}

function removeEntity(
  target: { items: EntityValue[]; order: string[] },
  snapshot: SyncSnapshotV1,
  conflict: SyncConflict,
  id: string,
): void {
  const index = target.items.findIndex((item) => item.id === id)
  const removedGroup = conflict.path.startsWith('quickLinks.groups.')
    ? snapshot.quickLinks.groups.find((group) => group.id === id)
    : undefined
  if (index >= 0) target.items.splice(index, 1)
  target.order.splice(0, target.order.length, ...target.order.filter((item) => item !== id))
  if (conflict.path.startsWith('quickLinks.items.')) {
    for (const group of snapshot.quickLinks.groups) {
      group.itemIds = group.itemIds.filter((item) => item !== id)
    }
  } else if (conflict.path.startsWith('quickLinks.groups.')) {
    if (removedGroup) {
      for (const itemId of removedGroup.itemIds) {
        if (!snapshot.quickLinks.rootOrder.includes(itemId)) {
          snapshot.quickLinks.rootOrder.push(itemId)
        }
      }
    }
  }
}

function insertEntityOrder(
  fallbackOrder: string[],
  target: SyncSnapshotV1,
  source: SyncSnapshotV1,
  conflict: SyncConflict,
  sourceId: string,
  insertedId: string,
): void {
  if (conflict.path.startsWith('quickLinks.items.')) {
    const sourceGroup = source.quickLinks.groups.find((group) => group.itemIds.includes(sourceId))
    if (!sourceGroup) {
      insertAfterSource(fallbackOrder, source.quickLinks.rootOrder, sourceId, insertedId)
      return
    }
    const targetGroup = target.quickLinks.groups.find((group) => group.id === sourceGroup.id)
    if (targetGroup) {
      insertAfterSource(targetGroup.itemIds, sourceGroup.itemIds, sourceId, insertedId)
    } else {
      fallbackOrder.push(insertedId)
    }
    return
  }
  if (conflict.path.startsWith('quickLinks.groups.')) {
    insertAfterSource(
      fallbackOrder,
      source.quickLinks.groupOrder,
      sourceId,
      insertedId,
    )
    return
  }
  const sourceOrder = conflict.path.startsWith('customSearchEngines.items.')
    ? source.customSearchEngines.order
    : (source.optional?.searchHistory?.order ?? [])
  insertAfterSource(fallbackOrder, sourceOrder, sourceId, insertedId)
}

function insertAfterSource(
  target: string[],
  source: readonly string[],
  sourceId: string,
  insertedId: string,
): void {
  const sourceIndex = source.indexOf(sourceId)
  const previous = sourceIndex > 0 ? source[sourceIndex - 1] : undefined
  const targetIndex = previous ? target.indexOf(previous) + 1 : target.length
  target.splice(Math.max(0, targetIndex), 0, insertedId)
}

function applyPathValue(
  snapshot: SyncSnapshotV1,
  path: string,
  value: JsonValue | undefined,
  present: boolean,
): void {
  if (path.startsWith('quickLinks.location.')) {
    moveQuickLink(snapshot, path.slice('quickLinks.location.'.length), present ? value : undefined)
    return
  }
  if (path.startsWith('quickLinks.items.')) {
    applyEntityField(
      snapshot.quickLinks.items as unknown as EntityValue[],
      path.slice('quickLinks.items.'.length),
      value,
      present,
    )
    return
  }
  if (path.startsWith('quickLinks.groups.')) {
    applyQuickLinkGroupPath(snapshot, path.slice('quickLinks.groups.'.length), value, present)
    return
  }
  if (path === 'quickLinks.rootOrder' || path === 'quickLinks.groupOrder') {
    const key = path.endsWith('rootOrder') ? 'rootOrder' : 'groupOrder'
    snapshot.quickLinks[key] = present && Array.isArray(value) ? [...value] as string[] : []
    return
  }
  if (path.startsWith('customSearchEngines.items.')) {
    applyEntityField(
      snapshot.customSearchEngines.items as unknown as EntityValue[],
      path.slice('customSearchEngines.items.'.length),
      value,
      present,
    )
    return
  }
  if (path === 'customSearchEngines.order') {
    snapshot.customSearchEngines.order = present && Array.isArray(value) ? [...value] as string[] : []
    return
  }
  if (path.startsWith('optional.searchHistory.items.')) {
    snapshot.optional ??= {}
    snapshot.optional.searchHistory ??= { items: [], order: [] }
    applyEntityField(
      snapshot.optional.searchHistory.items as unknown as EntityValue[],
      path.slice('optional.searchHistory.items.'.length),
      value,
      present,
    )
    return
  }
  if (path === 'optional.searchHistory.order') {
    snapshot.optional ??= {}
    snapshot.optional.searchHistory ??= { items: [], order: [] }
    snapshot.optional.searchHistory.order = present && Array.isArray(value) ? [...value] as string[] : []
    return
  }
  const [root, ...keys] = path.split('.')
  if (root !== 'settings' && root !== 'ui' && root !== 'optional') {
    throw new TypeError(`Unsupported conflict path: ${path}`)
  }
  applyObjectPath(snapshot as unknown as JsonObject, [root, ...keys], value, present)
}

function applyEntityField(
  items: EntityValue[],
  path: string,
  value: JsonValue | undefined,
  present: boolean,
): void {
  const separator = path.indexOf('.')
  if (separator < 1) throw new TypeError(`Entity field path is invalid: ${path}`)
  const id = path.slice(0, separator)
  const item = items.find((candidate) => candidate.id === id)
  if (!item) throw new TypeError(`Conflict entity is missing: ${id}`)
  applyObjectPath(item, path.slice(separator + 1).split('.'), value, present)
}

function applyQuickLinkGroupPath(
  snapshot: SyncSnapshotV1,
  path: string,
  value: JsonValue | undefined,
  present: boolean,
): void {
  const separator = path.indexOf('.')
  if (separator < 1) throw new TypeError(`Quick Link group path is invalid: ${path}`)
  const id = path.slice(0, separator)
  const key = path.slice(separator + 1)
  const group = snapshot.quickLinks.groups.find((candidate) => candidate.id === id)
  if (!group) throw new TypeError(`Quick Link group is missing: ${id}`)
  if (key === 'itemIds') {
    group.itemIds = present && Array.isArray(value) ? [...value] as string[] : []
  } else {
    applyObjectPath(group as unknown as JsonObject, key.split('.'), value, present)
  }
}

function moveQuickLink(snapshot: SyncSnapshotV1, id: string, value: JsonValue | undefined): void {
  snapshot.quickLinks.rootOrder = snapshot.quickLinks.rootOrder.filter((item) => item !== id)
  for (const group of snapshot.quickLinks.groups) {
    group.itemIds = group.itemIds.filter((item) => item !== id)
  }
  if (typeof value === 'string' && value !== 'root') {
    const group = snapshot.quickLinks.groups.find((candidate) => candidate.id === value)
    if (group) {
      group.itemIds.push(id)
      return
    }
  }
  snapshot.quickLinks.rootOrder.push(id)
}

function applyObjectPath(
  root: JsonObject,
  keys: readonly string[],
  value: JsonValue | undefined,
  present: boolean,
): void {
  let current = root
  for (const key of keys.slice(0, -1)) {
    const child = current[key]
    if (!child || typeof child !== 'object' || Array.isArray(child)) current[key] = {}
    current = current[key] as JsonObject
  }
  const key = keys.at(-1)
  if (!key) throw new TypeError('Conflict path is empty')
  if (present && value !== undefined) current[key] = structuredClone(value)
  else delete current[key]
}
