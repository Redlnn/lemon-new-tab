import { markRaw } from 'vue'

import NoteIcon from '@newtab/assets/note.svg?component'

export const BUILT_IN_APP_URL_PREFIX = 'lemon-new-tab://app/'
export type BuiltInAppId = 'note'

export const builtInApps = {
  note: {
    id: 'note',
    titleKey: 'builtinApps.note',
    icon: markRaw(NoteIcon),
  },
} as const

export function builtInAppUrl(id: BuiltInAppId): string {
  return `${BUILT_IN_APP_URL_PREFIX}${id}`
}

export function getBuiltInAppId(url: string): BuiltInAppId | null {
  const id = url.slice(BUILT_IN_APP_URL_PREFIX.length)
  return url.startsWith(BUILT_IN_APP_URL_PREFIX) && id === 'note' ? id : null
}

export function resolveBuiltInAppId(value: { appId?: unknown; url: string }): BuiltInAppId | null {
  if (value.appId === 'note') return value.appId
  return getBuiltInAppId(value.url)
}

export function openBuiltInApp(id: BuiltInAppId): void {
  window.dispatchEvent(
    new CustomEvent<BuiltInAppId>('lemon-new-tab:open-built-in-app', { detail: id }),
  )
}
