import { jsonEquals } from '../webdavSync/canonical.ts'

/** 只重放本机实际编辑，保留读取之后其他页面或同步写入的字段。 */
export function rebaseLocalChanges<T>(before: T, edited: T, current: T): T {
  if (
    before === edited ||
    (before !== undefined && edited !== undefined && jsonEquals(before, edited))
  )
    return structuredClone(current)
  if (Array.isArray(before) && Array.isArray(edited) && Array.isArray(current)) {
    const entities = [...before, ...edited, ...current]
    if (
      entities.every((item) => typeof item === 'string') &&
      [before, edited, current].every((items) => new Set(items).size === items.length)
    ) {
      const base = new Set(before),
        next = new Set(edited)
      const values = new Set(current)
      for (const id of base) if (!next.has(id)) values.delete(id)
      for (const id of next) if (!base.has(id)) values.add(id)
      return [...new Set([...edited, ...current])].filter((id) => values.has(id)) as T
    }
    if (entities.every((item) => isRecord(item) && typeof item.id === 'string')) {
      const base = new Map(before.map((item) => [item.id, item]))
      const next = new Map(edited.map((item) => [item.id, item]))
      const live = new Map(current.map((item) => [item.id, item]))
      for (const id of base.keys()) if (!next.has(id)) live.delete(id)
      for (const [id, item] of next) {
        if (!base.has(id) || !jsonEquals(base.get(id), item))
          live.set(id, rebaseLocalChanges(base.get(id), item, live.get(id)))
      }
      const reordered = !jsonEquals(
        before.map((item) => item.id),
        edited.map((item) => item.id),
      )
      const order = new Set([...(reordered ? next : live).keys(), ...live.keys()])
      return [...order].filter((id) => live.has(id)).map((id) => live.get(id)) as T
    }
  }
  if (isRecord(before) && isRecord(edited) && isRecord(current)) {
    const result: Record<string, unknown> = { ...current }
    for (const key of new Set([...Object.keys(before), ...Object.keys(edited)])) {
      if (!(key in edited)) delete result[key]
      else if (!(key in before)) result[key] = structuredClone(edited[key])
      else result[key] = rebaseLocalChanges(before[key], edited[key], current[key])
    }
    return result as T
  }
  return structuredClone(edited)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
