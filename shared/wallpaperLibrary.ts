import type { IDBPTransaction } from 'idb'

import { getDB, idbGet, type LemonDBSchema } from './storage/idb'
import { sha256Hex } from './webdavSync/canonical'

export type WallpaperVariant = 'light' | 'dark'
export interface WallpaperItem {
  id: string
  mediaType: 'image' | 'video'
  mimeType?: string
  size?: number
  width?: number
  height?: number
  duration?: number
  sha256?: string
  metadataFailed?: boolean
  syncEligible?: boolean
}
export interface WallpaperGroup {
  items: WallpaperItem[]
  fixedId: string
  lastId: string
}
export interface WallpaperLibrary {
  light: WallpaperGroup
  dark: WallpaperGroup
}
export const wallpaperStore = (variant: WallpaperVariant) =>
  variant === 'light' ? ('wallpaper' as const) : ('wallpaperDark' as const)
export const emptyWallpaperLibrary = (): WallpaperLibrary => ({
  light: { items: [], fixedId: '', lastId: '' },
  dark: { items: [], fixedId: '', lastId: '' },
})

/** 所有列表与原文件变更使用同一事务；事务内只等待 IndexedDB 请求。 */
export async function updateWallpaperLibrary(
  update: (
    library: WallpaperLibrary,
    tx: IDBPTransaction<
      LemonDBSchema,
      ('wallpaperLibrary' | 'wallpaper' | 'wallpaperDark')[],
      'readwrite'
    >,
  ) => Promise<void> | void,
): Promise<WallpaperLibrary> {
  const db = await getDB()
  const tx = db.transaction(['wallpaperLibrary', 'wallpaper', 'wallpaperDark'], 'readwrite')
  try {
    const library =
      ((await tx.objectStore('wallpaperLibrary').get('library')) as WallpaperLibrary | undefined) ??
      emptyWallpaperLibrary()
    await update(library, tx)
    await tx.objectStore('wallpaperLibrary').put(library, 'library')
    await tx.done
    return library
  } catch (error) {
    try {
      tx.abort()
    } catch {
      /* 事务可能已经自动回滚。 */
    }
    await tx.done.catch(() => {})
    throw error
  }
}

export async function readWallpaperLibrary(): Promise<WallpaperLibrary> {
  return (
    ((await idbGet('wallpaperLibrary', 'library')) as WallpaperLibrary | undefined) ??
    emptyWallpaperLibrary()
  )
}

export async function migrateWallpaperLibrary(legacy: {
  local?: { id: string; mediaType?: 'image' | 'video' }
  localDark?: { id: string; mediaType?: 'image' | 'video' }
}) {
  return updateWallpaperLibrary(async (library, tx) => {
    if (await tx.objectStore('wallpaperLibrary').get('migrated')) return
    for (const variant of ['light', 'dark'] as const) {
      const old = variant === 'light' ? legacy.local : legacy.localDark
      if (!old?.id || library[variant].items.some((item) => item.id === old.id)) continue
      const blob = await tx.objectStore(wallpaperStore(variant)).get(old.id)
      library[variant].items.push({
        id: old.id,
        mediaType: old.mediaType ?? (blob?.type.startsWith('video/') ? 'video' : 'image'),
        size: blob?.size,
      })
      library[variant].fixedId ||= old.id
    }
    await tx.objectStore('wallpaperLibrary').put(true, 'migrated')
  })
}

export async function addWallpaper(
  variant: WallpaperVariant,
  item: WallpaperItem,
  blob: Blob,
  thumbnail?: Blob,
) {
  // 旧单图尚未补齐哈希时，在导入路径补齐；不增加新标签页的启动读取。
  const hashes = new Map<string, string>()
  if (item.sha256) {
    for (const existing of (await readWallpaperLibrary())[variant].items) {
      if (existing.sha256) continue
      const original = await idbGet(wallpaperStore(variant), existing.id)
      if (original) hashes.set(existing.id, await sha256Hex(await original.arrayBuffer()))
    }
  }
  let { id } = item
  await updateWallpaperLibrary(async (library, tx) => {
    for (const existing of library[variant].items) existing.sha256 ??= hashes.get(existing.id)

    const duplicate =
      item.sha256 && library[variant].items.find((existing) => existing.sha256 === item.sha256)
    if (duplicate) {
      id = duplicate.id
      return
    }
    if (library[variant].items.some((existing) => existing.id === item.id))
      throw new Error('Wallpaper ID already exists')
    await tx.objectStore(wallpaperStore(variant)).put(blob, item.id)
    if (thumbnail)
      await tx.objectStore('wallpaperLibrary').put(thumbnail, `thumbnail:${variant}:${item.id}`)
    library[variant].items.push({ ...item, size: blob.size, mimeType: blob.type })
    library[variant].fixedId ||= item.id
  })
  return id
}

export async function removeWallpapers(variant: WallpaperVariant, ids: readonly string[]) {
  const removed = new Set(ids)
  return updateWallpaperLibrary(async (library, tx) => {
    const group = library[variant]
    group.items = group.items.filter((item) => !removed.has(item.id))
    if (removed.has(group.fixedId)) group.fixedId = group.items[0]?.id ?? ''
    if (removed.has(group.lastId)) group.lastId = ''
    for (const id of removed) {
      await tx.objectStore(wallpaperStore(variant)).delete(id)
      await tx.objectStore('wallpaperLibrary').delete(`thumbnail:${variant}:${id}`)
    }
  })
}

export async function reorderWallpapers(variant: WallpaperVariant, ids: readonly string[]) {
  return updateWallpaperLibrary((library) => {
    const { items } = library[variant]
    const order = new Map(ids.map((id, index) => [id, index]))
    items.sort((a, b) => (order.get(a.id) ?? ids.length) - (order.get(b.id) ?? ids.length))
  })
}

export function chooseWallpaper(
  group: WallpaperGroup,
  enabled: boolean,
  order: 'random' | 'ordered',
  random = Math.random,
) {
  if (!enabled)
    return group.items.find((item) => item.id === group.fixedId)?.id ?? group.items[0]?.id ?? ''
  if (order === 'ordered')
    return (
      group.items[
        (group.items.findIndex((item) => item.id === group.lastId) + 1) % group.items.length
      ]?.id ?? ''
    )
  const candidates = group.items.filter(
    (item) => group.items.length === 1 || item.id !== group.lastId,
  )
  return candidates[Math.floor(random() * candidates.length)]?.id ?? ''
}

export async function allocateWallpaper(
  variant: WallpaperVariant,
  enabled: boolean,
  order: 'random' | 'ordered',
) {
  let id = ''
  await updateWallpaperLibrary((library) => {
    id = chooseWallpaper(library[variant], enabled, order)
    library[variant].lastId = id
  })
  return id
}

export async function clearWallpaperLibrary() {
  return updateWallpaperLibrary(async (library, tx) => {
    await tx.objectStore('wallpaper').clear()
    await tx.objectStore('wallpaperDark').clear()
    await tx.objectStore('wallpaperLibrary').clear()
    Object.assign(library, emptyWallpaperLibrary())
    await tx.objectStore('wallpaperLibrary').put(true, 'migrated')
  })
}

/** 只比较用户数据，缩略图补齐和轮换进度不应制造同步冲突。 */
export function wallpaperLibrarySignature(library: WallpaperLibrary) {
  return JSON.stringify(
    (['light', 'dark'] as const).map((variant) => ({
      fixedId: library[variant].fixedId,
      items: library[variant].items.map((item) => ({ id: item.id, mediaType: item.mediaType })),
    })),
  )
}

/** 预览图可以重新生成，清理时不触碰原文件、列表和轮换状态。 */
export async function clearWallpaperThumbnails() {
  const db = await getDB()
  const tx = db.transaction('wallpaperLibrary', 'readwrite')
  for (const key of await tx.store.getAllKeys())
    if (String(key).startsWith('thumbnail:')) await tx.store.delete(key)
  await tx.done
}
