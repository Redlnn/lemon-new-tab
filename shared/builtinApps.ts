export const BUILT_IN_APP_URL_PREFIX = 'lemon-new-tab://app/'
export type BuiltInAppId = 'memo'

export const builtInApps = {
  memo: {
    id: 'memo',
    titleKey: 'builtinApps.memo',
    icon: '/memo-icon.png',
  },
} as const

export function builtInAppUrl(id: BuiltInAppId): string {
  return `${BUILT_IN_APP_URL_PREFIX}${id}`
}

export function getBuiltInAppId(url: string): BuiltInAppId | null {
  const id = url.slice(BUILT_IN_APP_URL_PREFIX.length)
  return url.startsWith(BUILT_IN_APP_URL_PREFIX) && id === 'memo' ? id : null
}

export function openBuiltInApp(id: BuiltInAppId): void {
  window.dispatchEvent(new CustomEvent<BuiltInAppId>('lemon-new-tab:open-built-in-app', { detail: id }))
}
