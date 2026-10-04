import { inject, shallowReactive, type InjectionKey } from 'vue'

import type { QuickLinkTarget } from '@/shared/quickLinks'

export type QuickLinkDialogRequest =
  | { mode: 'add'; groupId?: string }
  | { mode: 'edit'; target: QuickLinkTarget }
type DialogRequests = {
  settings: undefined
  changelog: undefined
  faq: undefined
  about: undefined
  searchEngines: undefined
  background: undefined
  bookmark: undefined
  note: undefined
  builtinApps: undefined
  quickLink: QuickLinkDialogRequest
}
export type AppDialogName = keyof DialogRequests
export type SimpleDialogName = Exclude<AppDialogName, 'quickLink'>
type OpenArgs = {
  [K in AppDialogName]: DialogRequests[K] extends undefined
    ? [name: K]
    : [name: K, request: DialogRequests[K]]
}[AppDialogName]

/** 只创建被打开过的状态；关闭保留实例，各弹窗互不排斥。 */
export function createAppDialogs() {
  const states = shallowReactive<Partial<Record<AppDialogName, { visible: boolean }>>>({})
  const quickLink = shallowReactive<{ request: QuickLinkDialogRequest | null }>({ request: null })
  function open(...[name, request]: OpenArgs) {
    if (name === 'quickLink') quickLink.request = request
    states[name] = { visible: true }
  }
  function close(name: AppDialogName) {
    if (states[name]) states[name] = { visible: false }
  }
  return { states, quickLink, open, close }
}
export const APP_DIALOGS: InjectionKey<ReturnType<typeof createAppDialogs>> = Symbol('appDialogs')
export function useAppDialogs() {
  const dialogs = inject(APP_DIALOGS)
  if (!dialogs) throw new Error('App dialog host is missing')
  return dialogs
}
