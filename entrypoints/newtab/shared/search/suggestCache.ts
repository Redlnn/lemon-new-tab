/**
 * 轻量 LRU 缓存：基于 Map 的实现，利用插入顺序管理最近使用。
 * 用于缓存搜索建议结果，减少网络请求
 */
export class LRUCache {
  private capacity: number
  private cache: Map<string, string[]>

  constructor(capacity: number = 50) {
    this.capacity = capacity
    this.cache = new Map()
  }

  get(key: string): string[] | null {
    const value = this.cache.get(key)
    if (value === undefined) return null

    // 标记为最近使用：删除后重新插入到 Map 末尾
    this.cache.delete(key)
    this.cache.set(key, value)
    return value
  }

  set(key: string, value: string[]): void {
    if (this.cache.has(key)) this.cache.delete(key)
    this.cache.set(key, value)

    if (this.cache.size > this.capacity) {
      // 删除最久未使用的项（Map 的第一个键）
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) this.cache.delete(firstKey)
    }
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear()
  }

}

// 创建全局搜索建议缓存实例
export const searchSuggestCache = new LRUCache(50)
