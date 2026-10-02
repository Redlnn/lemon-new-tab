import { browser } from 'wxt/browser'

/** 授权是设备状态，不能由同步设置或查询过程隐式申请。 */
export function useBrowserHistoryPermission() {
  const granted = ref(false)
  let revision = 0
  const permission = { permissions: ['history' as const] }
  const refresh = async () => {
    const current = ++revision
    const value = await browser.permissions.contains(permission).catch(() => false)
    if (current === revision) granted.value = value
  }
  const onAdded = (change: { permissions?: string[] }) => {
    if (change.permissions?.includes('history')) void refresh()
  }
  const onRemoved = (change: { permissions?: string[] }) => {
    if (!change.permissions?.includes('history')) return
    revision++
    granted.value = false
  }
  browser.permissions.onAdded.addListener(onAdded)
  browser.permissions.onRemoved.addListener(onRemoved)
  void refresh()
  onScopeDispose(() => {
    revision++
    browser.permissions.onAdded.removeListener(onAdded)
    browser.permissions.onRemoved.removeListener(onRemoved)
  })
  return {
    granted,
    request: () =>
      browser.permissions.request(permission).then((allowed) => {
        revision++
        granted.value = allowed
        return allowed
      }),
  }
}
