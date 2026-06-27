import { promiseTimeout, useDark } from '@vueuse/core'

import type { UploadProps, UploadRequestOptions } from 'element-plus'
import i18next from 'i18next'

import { BgType } from '@/shared/enums'
import { isMediaFile } from '@/shared/media'
import { useSettingsStore } from '@/shared/settings'

import {
  PermissionContext,
  PermissionResult,
  usePermission,
} from '@newtab/composables/usePermission'
import {
  clearAllOnlineWallpaperCache,
  uploadBackground,
  useDarkWallpaperStorge,
  useWallpaperStorge,
  useWallpaperUrlStore,
} from '@newtab/shared/wallpaper'

// 大小阈值 (字节)，超过会提示。这里设置为 50MB
const WARN_SIZE_BYTES = 50 * 1024 * 1024

const settings = useSettingsStore()
const wallpaperUrlStore = useWallpaperUrlStore()

const isDark = useDark()

let isShowingPermissionDialog = false

function useBackgroundSwitcher() {
  const isDarkBg = ref(false)

  // 存储上传后的元信息
  const metaLight = shallowRef<{
    width?: number
    height?: number
    duration?: number
    size?: number
  } | null>(null)
  const metaDark = shallowRef<{
    width?: number
    height?: number
    duration?: number
    size?: number
  } | null>(null)

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const readMediaMeta = (
    file: File,
    cb: (meta: { width?: number; height?: number; duration?: number }, file?: File) => void,
  ) => {
    if (!file) return
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        cb({ width: img.naturalWidth, height: img.naturalHeight }, file)
        URL.revokeObjectURL(url)
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        cb({})
      }
      img.src = url
    } else if (file.type.startsWith('video/')) {
      const url = URL.createObjectURL(file)
      const video = document.createElement('video')
      const cleanup = () => {
        video.onloadedmetadata = null
        video.onerror = null
        video.src = ''
        URL.revokeObjectURL(url)
      }
      video.onloadedmetadata = () => {
        cb({ width: video.videoWidth, height: video.videoHeight, duration: video.duration }, file)
        cleanup()
      }
      video.onerror = () => {
        cleanup()
        cb({})
      }
      video.src = url
    } else {
      cb({})
    }
  }

  const beforeBackgroundUpload: UploadProps['beforeUpload'] = async (rawFile: File) => {
    if (!isMediaFile(rawFile)) {
      ElMessage.error(i18next.t('settings:background.warning.fileIsNotImage'))
      return false
    }

    // 检查大小
    if (rawFile.size > WARN_SIZE_BYTES) {
      // 提示用户文件较大，确认是否继续
      try {
        await ElMessageBox.confirm(
          i18next.t('settings:background.warning.tooLarge.message', {
            size: formatBytes(rawFile.size),
          }),
          i18next.t('settings:background.warning.tooLarge.title'),
          { type: 'warning' },
        )
      } catch {
        // 用户取消上传
        return false
      }
    }

    return true
  }

  const setMeta = (m: { width?: number; height?: number; duration?: number }, file?: File) => {
    if (!file) return
    if (isDarkBg.value) {
      metaDark.value = { ...metaDark.value, ...m, size: file.size }
    } else {
      metaLight.value = { ...metaLight.value, ...m, size: file.size }
    }
  }

  const handleUpload = async (option: UploadRequestOptions) => {
    const file = option.file as File

    await uploadBackground(file, isDarkBg.value)

    // 上传完成后立即读取元信息以展示
    readMediaMeta(file, setMeta)
    if (
      settings.theme.monetColor &&
      settings.background.local.mediaType !== 'image' &&
      settings.background.localDark.mediaType !== 'image'
    ) {
      ElMessage.info(i18next.t('settings:background.warning.monetColorDisabled'))
      settings.theme.monetColor = false
    }
  }

  const deleteLocalBg = async () => {
    if (isDarkBg.value) {
      const oldUrl = settings.background.localDark?.url
      settings.background.localDark = { id: '', url: '', mediaType: undefined }
      metaDark.value = null
      await nextTick()
      await promiseTimeout(200)
      if (oldUrl) {
        try {
          URL.revokeObjectURL(oldUrl)
        } catch {}
      }
      useDarkWallpaperStorge.clear()
      await wallpaperUrlStore.clearUrl('dark')
    } else {
      const oldUrl = settings.background.local?.url
      settings.background.local = { id: '', url: '', mediaType: undefined }
      metaLight.value = null
      await nextTick()
      await promiseTimeout(200)
      if (oldUrl) {
        try {
          URL.revokeObjectURL(oldUrl)
        } catch {}
      }
      useWallpaperStorge.clear()
      await wallpaperUrlStore.clearUrl('light')
    }
  }

  // 在线壁纸相关
  const tempOnlineUrl = ref('') // 用于在线壁纸输入框的临时存储，避免频繁修改 settingsStore

  const onlineImageWarn = async () => {
    if (settings.background.online.url) {
      settings.background.bgType = BgType.Online
      return
    }
    ElMessageBox.confirm(
      i18next.t('settings:background.warning.unknownSource'),
      i18next.t('settings:background.warning.title'),
      {
        type: 'warning',
      },
    )
      .then(() => {
        settings.background.bgType = BgType.Online
      })
      .catch(() => {
        settings.background.bgType = BgType.None
        settings.background.online.url = ''
      })
  }

  const { checkAndRequestPermission } = usePermission()

  const offerEnableOnlineWallpaperCache = async (hostname: string) => {
    if (settings.background.online.cache.enabled) return

    try {
      await ElMessageBox.confirm(
        i18next.t('settings:background.cache.askEnable.message'),
        i18next.t('settings:background.cache.askEnable.title'),
        { type: 'info' },
      )
    } catch {
      return
    }

    if (import.meta.env.MANIFEST_VERSION === 2) {
      settings.background.online.cache.enabled = true
      return
    }

    const result = await checkAndRequestPermission(hostname, true, PermissionContext.WallpaperCache)
    if (result === PermissionResult.GrantedAll) {
      settings.background.online.cache.enabled = true
    } else {
      ElMessage.warning(i18next.t('settings:background.warning.cacheDisabled'))
    }
  }

  const handlePermissions = async (_url: string, hostname: string) => {
    const result = await checkAndRequestPermission(
      hostname,
      false,
      PermissionContext.OnlineWallpaper,
    )

    if (result === PermissionResult.GrantedAll) return true

    if (result === PermissionResult.GrantedCurrent) {
      if (settings.theme.monetColor) {
        settings.theme.monetColor = false
        ElMessage.warning(i18next.t('settings:background.warning.monetDisabled'))
      }
      // 如果只授予了当前地址权限，则无法安全使用在线壁纸缓存。
      // 如果用户之前启用了缓存，则自动关闭并清理缓存，同时给出提示说明原因。
      if (settings.background.online.cache.enabled) {
        settings.background.online.cache.enabled = false
        await clearAllOnlineWallpaperCache()
        ElMessage.warning(i18next.t('settings:background.warning.cacheDisabled'))
      }
      return true
    }

    if (result === PermissionResult.DeniedByBrowser || result === PermissionResult.DeniedByUser) {
      ElMessage.error(i18next.t('settings:background.warning.notGranted'))
    }

    return false
  }

  const changeOnlineBg = async (e: Event) => {
    if (isShowingPermissionDialog) return
    const _url = (e.target as HTMLInputElement).value
    if (!_url) {
      settings.background.bgType = BgType.None
      settings.background.online.url = ''
      tempOnlineUrl.value = ''
      return
    }
    // 清除已有缓存
    await clearAllOnlineWallpaperCache()
    const { hostname } = new URL(_url)

    // MV2的Firefox不需要检查权限，直接设置在线壁纸URL即可。MV3才需要检查权限。
    if (import.meta.env.MANIFEST_VERSION === 2 && !settings.theme.monetColor) {
      settings.background.online.url = _url
      await offerEnableOnlineWallpaperCache(hostname)
      return
    }

    isShowingPermissionDialog = true
    if (await handlePermissions(_url, hostname)) {
      settings.background.online.url = _url
      await offerEnableOnlineWallpaperCache(hostname)
    } else {
      settings.background.bgType = BgType.None
      tempOnlineUrl.value = ''
    }
    isShowingPermissionDialog = false
  }

  onMounted(async () => {
    watch(
      isDark,
      (newVal) => {
        if (settings.background.localDark.id) {
          isDarkBg.value = newVal
        }
      },
      { immediate: true },
    )

    const tasks: Array<Promise<void>> = []

    if (settings.background.local?.id) {
      tasks.push(
        (async () => {
          try {
            await wallpaperUrlStore.getUrl('light')
            const file = await useWallpaperStorge.getItem<Blob>(settings.background.local.id)
            if (file) {
              metaLight.value = { size: (file as File).size }
              readMediaMeta(file as File, (m) => {
                metaLight.value = { ...metaLight.value, ...m }
              })
              if (!settings.background.local.mediaType) {
                settings.background.local.mediaType = file.type.startsWith('video/')
                  ? 'video'
                  : 'image'
              }
            }
          } catch {}
        })(),
      )
    }

    if (settings.background.localDark?.id) {
      tasks.push(
        (async () => {
          try {
            await wallpaperUrlStore.getUrl('dark')
            const file = await useDarkWallpaperStorge.getItem<Blob>(
              settings.background.localDark.id,
            )
            if (file) {
              metaDark.value = { size: (file as File).size }
              readMediaMeta(file as File, (m) => {
                metaDark.value = { ...metaDark.value, ...m }
              })
              if (!settings.background.localDark.mediaType) {
                settings.background.localDark.mediaType = file.type.startsWith('video/')
                  ? 'video'
                  : 'image'
              }
            }
          } catch {}
        })(),
      )
    }

    await Promise.all(tasks)

    if (settings.background.online.url) {
      tempOnlineUrl.value = settings.background.online.url
    }
  })

  return {
    isDarkBg,
    metaLight,
    metaDark,
    formatBytes,
    beforeBackgroundUpload,
    handleUpload,
    deleteLocalBg,
    tempOnlineUrl,
    changeOnlineBg,
    onlineImageWarn,
  }
}

export default useBackgroundSwitcher
