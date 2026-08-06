import { type DBSchema, openDB } from 'idb'

/** favicon 缓存条目（与 faviconCache.ts 保持一致） */
export interface FaviconCacheEntry {
  /** base64 数据 URL（例如 "data:image/...;base64,..."）或普通 HTTP/HTTPS 链接 */
  data: string
  /** 'base64' 表示完整的离线数据 URI；'url' 表示需要通过网络获取的地址 */
  type: 'base64' | 'url'
  /** 该条目被存储时的 Unix 时间戳（毫秒） */
  fetchedAt: number
}

/** 在线壁纸缓存条目 */
export interface CachedImage {
  blob: Blob
  timestamp: number
}

interface LemonDBSchema extends DBSchema {
  favicon: {
    key: string
    value: FaviconCacheEntry
  }
  wallpaper: {
    key: string
    value: Blob
  }
  wallpaperBing: {
    key: string
    value: Blob
  }
  wallpaperDark: {
    key: string
    value: Blob
  }
  onlineWallpaperCache: {
    key: string
    value: CachedImage
  }
}

const DB_NAME = '柠檬起始页'
const DB_VERSION = 1
const REQUIRED_STORES: readonly StoreName[] = [
  'favicon',
  'wallpaper',
  'wallpaperBing',
  'wallpaperDark',
  'onlineWallpaperCache',
]

let dbPromise: Promise<import('idb').IDBPDatabase<LemonDBSchema>> | null = null

/**
 * 探测已有数据库的版本和 store 情况。
 * 兼容 localforage 创建的高版本数据库（localforage 从 version 2 开始，
 * 每增加一个 store 就 +1，5 个 store 可能达到 version 6+）。
 */
async function probeExistingDB(): Promise<{ version: number; needsUpgrade: boolean }> {
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME)
    req.onsuccess = () => {
      const db = req.result
      const needsUpgrade = !REQUIRED_STORES.every((s) => db.objectStoreNames.contains(s))
      const { version } = db
      db.close()
      resolve({ version, needsUpgrade })
    }
    req.onerror = () => resolve({ version: 0, needsUpgrade: true })
  })
}

function getDB() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const { version: existingVersion, needsUpgrade } = await probeExistingDB()
      // 需要创建 store 时版本号必须高于当前值以触发 upgrade；
      // 否则以当前版本打开即可（stores 已由 localforage 或上次运行创建）
      const targetVersion = needsUpgrade
        ? Math.max(existingVersion + 1, DB_VERSION)
        : existingVersion

      return openDB<LemonDBSchema>(DB_NAME, targetVersion, {
        upgrade(db) {
          for (const store of REQUIRED_STORES) {
            if (!db.objectStoreNames.contains(store)) db.createObjectStore(store)
          }
        },
      })
    })()
  }
  return dbPromise
}

export type StoreName =
  | 'favicon'
  | 'wallpaper'
  | 'wallpaperBing'
  | 'wallpaperDark'
  | 'onlineWallpaperCache'

/** 获取指定 store 中某个 key 的值 */
export async function idbGet<S extends StoreName>(
  storeName: S,
  key: string,
): Promise<LemonDBSchema[S]['value'] | undefined> {
  const db = await getDB()
  return db.get(storeName, key)
}

/** 写入（或覆盖）指定 store 中某个 key 的值 */
export async function idbSet<S extends StoreName>(
  storeName: S,
  key: string,
  value: LemonDBSchema[S]['value'],
): Promise<void> {
  const db = await getDB()
  await db.put(storeName, value, key)
}

/** 在一个事务中批量写入同一 store，避免为缓存整理创建大量事务。 */
export async function idbSetMany<S extends StoreName>(
  storeName: S,
  entries: ReadonlyArray<readonly [string, LemonDBSchema[S]['value']]>,
): Promise<void> {
  if (entries.length === 0) return
  const db = await getDB()
  const transaction = db.transaction(storeName, 'readwrite')
  await Promise.all([
    ...entries.map(([key, value]) => transaction.store.put(value, key)),
    transaction.done,
  ])
}

/** 返回指定 store 的全部字符串键值对。 */
export async function idbGetAllEntries<S extends StoreName>(
  storeName: S,
): Promise<Array<[string, LemonDBSchema[S]['value']]>> {
  const db = await getDB()
  const transaction = db.transaction(storeName, 'readonly')
  const [keys, values] = await Promise.all([
    transaction.store.getAllKeys(),
    transaction.store.getAll(),
    transaction.done,
  ])
  return values.map((value, index) => [String(keys[index]), value])
}

/** 删除指定 store 中某个 key */
export async function idbDelete(storeName: StoreName, key: string): Promise<void> {
  const db = await getDB()
  await db.delete(storeName, key)
}

/** 在一个事务中批量删除同一 store 的多个键。 */
export async function idbDeleteMany(storeName: StoreName, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return
  const db = await getDB()
  const transaction = db.transaction(storeName, 'readwrite')
  await Promise.all([...keys.map((key) => transaction.store.delete(key)), transaction.done])
}

/** 清空指定 store 的全部数据 */
export async function idbClear(storeName: StoreName): Promise<void> {
  const db = await getDB()
  await db.clear(storeName)
}

/** 在一个事务中原子清空多个 store。 */
export async function idbClearMany(storeNames: readonly StoreName[]): Promise<void> {
  if (storeNames.length === 0) return
  const db = await getDB()
  const transaction = db.transaction([...storeNames], 'readwrite')
  for (const storeName of storeNames) {
    transaction.objectStore(storeName).clear()
  }
  await transaction.done
}

/** 清空所有已知 store 的数据，保留各页面正在使用的数据库连接。 */
export async function idbClearAll(): Promise<void> {
  await idbClearMany(REQUIRED_STORES)
}
