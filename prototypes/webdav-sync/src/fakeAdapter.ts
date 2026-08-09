import { scenarios } from './fixtures'
import type { SyncPrototypeAdapter } from './types'

export const fakeSyncAdapter: SyncPrototypeAdapter = {
  listScenarios: () => scenarios,
  getScenario(id) {
    return scenarios.find((scenario) => scenario.id === id) ?? scenarios[0]!
  },
  async syncNow(id) {
    const scenario = this.getScenario(id)
    return { message: scenario.status === 'synced' ? '已经是最新状态' : '已完成一次模拟检查' }
  },
  async testConnection() {
    return { server: 'https://dav.example.com/remote.php/dav/files/lemon/', secure: true }
  },
  async resolveConflicts(resolutions) {
    return { message: `已为 ${Object.keys(resolutions).length} 项冲突生成模拟合并版本` }
  },
}
