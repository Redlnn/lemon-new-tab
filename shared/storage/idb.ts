import { type DBSchema, deleteDB, openDB } from 'idb'

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

type StoreName =
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

/** 删除指定 store 中某个 key */
export async function idbDelete(storeName: StoreName, key: string): Promise<void> {
  const db = await getDB()
  await db.delete(storeName, key)
}

/** 清空指定 store 的全部数据 */
export async function idbClear(storeName: StoreName): Promise<void> {
  const db = await getDB()
  await db.clear(storeName)
}

/** 删除整个数据库（用于重置所有数据） */
export async function idbDropDatabase(): Promise<void> {
  // 先关闭已有连接
  if (dbPromise) {
    const db = await dbPromise
    db.close()
    dbPromise = null
  }
  await deleteDB(DB_NAME)
}
