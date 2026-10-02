import { ref, watch } from 'vue'

import { browser } from 'wxt/browser'

export const PermissionResult = {
  GrantedAll: 'granted-all',
  GrantedCurrent: 'granted-current',
  DeniedByUser: 'denied-by-user',
  DeniedByBrowser: 'denied-by-browser',
} as const
export type PermissionResult = (typeof PermissionResult)[keyof typeof PermissionResult]

export const PermissionContext = {
  OnlineWallpaper: 'onlineWallpaper',
  WallpaperCache: 'wallpaperCache',
  FaviconCache: 'faviconCache',
  MonetColor: 'monetColor',
} as const
export type PermissionContext = (typeof PermissionContext)[keyof typeof PermissionContext]

const permissionDialogVisible = ref(false)
const currentHostname = ref('')
const currentOnlyAll = ref(false)
const currentContext = ref<PermissionContext>(PermissionContext.OnlineWallpaper)
let permissionResolve: ((value: PermissionResult) => void) | null = null

watch(
  permissionDialogVisible,
  (visible) => {
    if (visible) return
    const resolve = permissionResolve
    permissionResolve = null
    resolve?.(PermissionResult.DeniedByUser)
  },
  { flush: 'sync' },
)

export function usePermission() {
  const onPermissionDialogResult = (result: PermissionResult) => {
    const resolve = permissionResolve
    permissionResolve = null
    permissionDialogVisible.value = false
    resolve?.(result)
  }

  const checkAndRequestPermission = async (
    hostname: string,
    onlyAll: boolean = false,
    context: PermissionContext = PermissionContext.OnlineWallpaper,
  ): Promise<PermissionResult> => {
    const allPermissions = { origins: [`*://*/*`] }
    const allGranted = await browser.permissions.contains(allPermissions)
    const permissions = { origins: [`*://${hostname}/*`] }
    const granted = await browser.permissions.contains(permissions)

    if (allGranted) return PermissionResult.GrantedAll
    if (!onlyAll && granted) return PermissionResult.GrantedCurrent

    currentHostname.value = hostname
    currentOnlyAll.value = onlyAll
    currentContext.value = context
    permissionDialogVisible.value = true

    return new Promise<PermissionResult>((resolve) => {
      permissionResolve = resolve
    })
  }

  return {
    permissionDialogVisible,
    currentHostname,
    currentOnlyAll,
    currentContext,
    onPermissionDialogResult,
    checkAndRequestPermission,
  }
}
