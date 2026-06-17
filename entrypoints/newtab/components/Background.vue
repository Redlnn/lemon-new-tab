<script lang="ts" setup>
import {
  promiseTimeout,
  useDark,
  useDocumentVisibility,
  useEventListener,
  useThrottleFn,
  useTimeoutFn,
  useWindowFocus,
} from '@vueuse/core'
import { storeToRefs } from 'pinia'

import i18next from 'i18next'

import { browser } from '#imports'

import { BgType } from '@/shared/enums'
import { useSettingsStore } from '@/shared/settings'

import { useFocusState } from '@newtab/composables/useFocus'
import { applyMonet } from '@newtab/shared/theme'
import { isOnlyTouchDevice } from '@newtab/shared/touch'
import {
  bingWallpaperURLGetter,
  cacheOnlineWallpaper,
  clearAllOnlineWallpaperCache,
  getCachedOnlineWallpaper,
  useWallpaperUrlStore,
} from '@newtab/shared/wallpaper'

let animationDuration = 1250
let hasShortenedFade = false

const isDark = useDark()

const focusStore = useFocusState()
const settings = useSettingsStore()

// 如果设置了快速初始动画，则直接使用短时间
if (settings.background.fastAnimation) {
  animationDuration = 300
}

const wallpaperUrlStore = useWallpaperUrlStore()
const { lightUrl, darkUrl } = storeToRefs(wallpaperUrlStore)
const isSwitching = ref(true)

const imageRef = useTemplateRef('imageRef')
const videoRef = useTemplateRef('videoRef')
const bgURL = ref<string>('')
const lastBlobUrl = ref<string>('')

function revokeLastBlobUrl() {
  if (lastBlobUrl.value) {
    URL.revokeObjectURL(lastBlobUrl.value)
    lastBlobUrl.value = ''
  }
}

const bgOpacityDuration = ref(settings.background.fastAnimation ? '0.3s' : '1.25s')

function shortenBgFadeDuration() {
  if (hasShortenedFade) return
  hasShortenedFade = true
  animationDuration = 300
  bgOpacityDuration.value = '0.3s'
}

const bgURLreg = new RegExp('url\\((["\']?)(.*?)\\1\\)', 'i')

// 视频壁纸相关逻辑

const isWindowFocused = useWindowFocus()
const documentVisibility = useDocumentVisibility()

function reportVideoPlaybackError(action: 'pause' | 'play', error: unknown) {
  console.warn(`[background] Failed to ${action} wallpaper video:`, error)
}

function updateVideoPlayback() {
  const vid = videoRef.value
  if (!vid) return
  // 如果页面不可见，或者窗口失去焦点且设置了失去焦点时暂停视频，则暂停视频
  if (
    document.visibilityState === 'hidden' ||
    (settings.background.pauseOnBlur && !isWindowFocused.value)
  ) {
    try {
      vid.pause()
    } catch (error) {
      reportVideoPlaybackError('pause', error)
    }
  } else {
    try {
      const playPromise = vid.play()
      if (playPromise instanceof Promise) {
        void playPromise.catch((error) => {
          reportVideoPlaybackError('play', error)
        })
      }
    } catch (error) {
      reportVideoPlaybackError('play', error)
    }
  }
}

const backgroundCss = computed(() => ({
  'background-container--focused__blur': focusStore.isFocused && settings.perf.focus.blur,
}))

// 视差效果
const backgroundParallaxEnabled = computed(
  () => settings.background.parallax && !isOnlyTouchDevice.value,
)
const mouseX = ref(typeof window !== 'undefined' ? window.innerWidth / 2 : 960)
const mouseY = ref(typeof window !== 'undefined' ? window.innerHeight / 2 : 540)

watchEffect((onCleanup) => {
  if (!backgroundParallaxEnabled.value || documentVisibility.value === 'hidden') return

  const onMouseMove = useThrottleFn((e: MouseEvent) => {
    mouseX.value = e.clientX
    mouseY.value = e.clientY
  }, 33)
  const onMouseLeave = () => {
    mouseX.value = window.innerWidth / 2
    mouseY.value = window.innerHeight / 2
  }

  const moveCleanup = useEventListener('mousemove', onMouseMove)
  const leaveCleanup = useEventListener('mouseleave', onMouseLeave)

  onCleanup(() => {
    moveCleanup()
    leaveCleanup()
    mouseX.value = window.innerWidth / 2
    mouseY.value = window.innerHeight / 2
  })
})

const backgroundScale = computed(() => {
  if (focusStore.isFocused && settings.perf.focus.scale) {
    return 1.1
  } else if (!settings.perf.focus.scale) {
    return 1.05
  } else {
    return 1
  }
})

const backgroundTranslate = computed(() => {
  if (!backgroundParallaxEnabled.value || focusStore.isFocused) return ''
  const strength = 20
  const tx = (0.5 - mouseX.value / window.innerWidth) * 2 * strength
  const ty = (0.5 - mouseY.value / window.innerHeight) * 2 * strength
  return `${tx}px ${ty}px`
})

const isVideoWallpaper = computed(() => {
  if (settings.background.bgType !== BgType.Local) {
    return false
  }

  const mediaType = isDark.value
    ? (settings.background.localDark.mediaType ?? settings.background.local.mediaType)
    : settings.background.local.mediaType

  return mediaType === 'video'
})

// 壁纸更新相关逻辑

const currentLocalUrl = computed(() => {
  if (isDark.value && settings.background.localDark.id) {
    return darkUrl
  }
  return lightUrl
})

const bgTypeProviders: Record<
  BgType,
  () => string | Promise<string> | Ref<string> | Promise<Ref<string>>
> = {
  [BgType.Bing]: () => bingWallpaperURLGetter.getBgUrl(),
  [BgType.Local]: () => currentLocalUrl.value,
  [BgType.Online]: async () => {
    const rawUrl = settings.background.online.url
    if (!rawUrl) return ''

    // 如果没有开启缓存且没有开启莫奈，直接返回原始URL
    if (!settings.background.online.cache.enabled && !settings.theme.monetColor) {
      return rawUrl
    }

    // MV3才需要检查全站权限，MV2的Firefox不需要
    if (import.meta.env.MANIFEST_VERSION === 3) {
      const allGranted = await browser.permissions.contains({ origins: [`*://*/*`] })
      if (!allGranted) {
        return rawUrl
      }
    }

    // Cancel any in-flight fetch from a previous call before starting async work.
    onlineFetchController?.abort()
    onlineFetchController = new AbortController()
    const { signal } = onlineFetchController

    const now = Date.now()
    const useCache = settings.background.online.cache.enabled
    // 如果开启了缓存，则尝试从缓存中获取
    const cached = useCache ? await getCachedOnlineWallpaper(rawUrl) : null

    let isCacheValid = false

    if (cached) {
      const ageHours = (now - cached.timestamp) / 36e5
      const withinDuration = ageHours <= settings.background.online.cache.duration

      isCacheValid = settings.background.online.cache.noExpires || withinDuration
    }

    if (isCacheValid) {
      // Blob URL ownership transfers to updateBackgroundURL (tracked and revoked via lastBlobUrl).
      return URL.createObjectURL(cached!.blob)
    }

    let blob: Blob | null = null

    // 如果没有命中缓存或没有开启缓存
    try {
      // 下载新的图像
      const res = await fetch(rawUrl, { signal })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      blob = await res.blob()
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        // This request was invalidated by a newer request or component teardown.
        // updateBackgroundURL's version guard will discard the aborted result.
        return ''
      }
      ElNotification.error({
        title: i18next.t('newtab:notification.wallpaperCache.title'),
        message: i18next.t('newtab:notification.wallpaperCache.message', { error: e }),
      })
      if (cached) {
        // Blob URL ownership transfers to updateBackgroundURL (tracked and revoked via lastBlobUrl).
        return URL.createObjectURL(cached.blob) // 如果下载失败，不管缓存是否过期都继续使用缓存
      }
      // Download failed and no cache is available. Return the raw URL as explicit degraded
      // behavior: Monet will not be applied (onImgLoaded already guards against HTTP URLs).
      return rawUrl
    }

    const newCache = { blob, timestamp: now }

    // 缓存新下载的图像（如果开启了缓存）
    if (settings.background.online.cache.enabled) {
      await cacheOnlineWallpaper(rawUrl, newCache)
    }

    // Blob URL ownership transfers to updateBackgroundURL (tracked and revoked via lastBlobUrl).
    return URL.createObjectURL(blob)
  },
  [BgType.None]: () => Promise.resolve(''),
}

function assignMaybeRef<T>(target: Ref<T>, source: T | Ref<T>) {
  if (isRef(source)) {
    return watch(source, (v) => (target.value = v), { immediate: true })
  }

  target.value = source
  return () => {}
}

watch(
  [isVideoWallpaper, documentVisibility, isWindowFocused, () => settings.background.pauseOnBlur],
  ([isVideo]) => {
    if (!isVideo) {
      // 非视频壁纸，确保视频被暂停
      const vid = videoRef.value
      if (vid && !vid.paused) {
        try {
          vid.pause()
        } catch (error) {
          reportVideoPlaybackError('pause', error)
        }
      }
      return
    }

    updateVideoPlayback()
  },
  { immediate: true },
)

// 动态watch管理
let stopBgWatch: (() => void) | undefined
let stopBgTypeWatch: (() => void) | null = null
let backgroundRequestVersion = 0
let onlineFetchController: AbortController | null = null

async function updateBackgroundURL(type: BgType): Promise<void> {
  const requestVersion = ++backgroundRequestVersion
  const provider = bgTypeProviders[type]
  if (!provider) return

  stopBgWatch?.()
  stopBgWatch = undefined

  let newUrl: string | Ref<string>
  try {
    newUrl = await provider()
  } catch (error) {
    if (requestVersion !== backgroundRequestVersion) return
    console.error('Failed to update background URL:', error)
    isSwitching.value = false
    return
  }
  if (requestVersion !== backgroundRequestVersion) {
    if (type === BgType.Online && !isRef(newUrl) && newUrl.startsWith('blob:')) {
      URL.revokeObjectURL(newUrl)
    }
    return
  }

  if (type === BgType.Online && !isRef(newUrl)) {
    if (newUrl.startsWith('blob:')) {
      revokeLastBlobUrl()
      lastBlobUrl.value = newUrl
    } else {
      revokeLastBlobUrl()
    }
  } else {
    revokeLastBlobUrl()
  }

  // 只在URL真正变化时才执行切换动画
  if (type !== BgType.Online && !isRef(newUrl) && newUrl === bgURL.value) return

  isSwitching.value = true

  // 等待过渡动画
  // 首次打开默认白屏，不需要等待白屏动画
  if (bgURL.value !== '') {
    if (settings.perf.bgSwitchAnim) {
      await promiseTimeout(animationDuration)
      if (requestVersion !== backgroundRequestVersion) return
    }
    // 不直接赋值是因为避免看到壁纸变形
    // 直接赋值为原始 URL（Background 组件会决定是否包裹 url()）
    bgURL.value = ''
  }
  if (requestVersion !== backgroundRequestVersion) return

  stopBgWatch = assignMaybeRef(bgURL, newUrl)

  isSwitching.value = false
  if (settings.perf.bgSwitchAnim) {
    await promiseTimeout(animationDuration)
    if (requestVersion !== backgroundRequestVersion) return
  }
  shortenBgFadeDuration()
}

// 本地背景URL变化处理器
async function handleLocalBgChange() {
  await updateBackgroundURL(BgType.Local)
}

// 在线背景URL变化处理器
async function handleOnlineBgChange() {
  await updateBackgroundURL(BgType.Online)
}

// 根据背景类型激活对应的watch
function activateBackgroundWatch(type: BgType) {
  // 清理旧的watch
  stopBgTypeWatch?.()
  stopBgTypeWatch = null

  // 根据类型激活对应的watch
  if (type === BgType.Local) {
    // 只在使用本地背景时监听本地背景变化
    stopBgTypeWatch = watch(currentLocalUrl, handleLocalBgChange)
  } else if (type === BgType.Online) {
    // 只在使用在线背景时监听在线URL变化
    stopBgTypeWatch = watch(() => settings.background.online.url, handleOnlineBgChange)
  }
  // Bing类型：assignMaybeRef 已对 bingUrl ref 建立 watch，后台刷新完成时会自动更新 bgURL
  // None类型：无需监听
}

// 监听背景类型切换，动态激活/停用对应的watch
watch(
  () => settings.background.bgType,
  async (newType, oldType) => {
    if (newType === oldType) return
    await updateBackgroundURL(newType)
    activateBackgroundWatch(newType)
  },
)

watch(
  () => settings.theme.monetColor,
  async (statu) => {
    if (statu) {
      document.documentElement.classList.add('monet')
      // 设置界面切换开关时才触发计算（此时有背景）
      if (bgURL.value !== '' && !isVideoWallpaper.value) {
        if (settings.background.bgType === BgType.Online) {
          await updateBackgroundURL(BgType.Online)
        }
        await applyMonet(imageRef.value)
      }
    } else {
      document.documentElement.classList.remove('monet')
    }
  },
  { immediate: true },
)

onMounted(async () => {
  await bingWallpaperURLGetter.init()
  await updateBackgroundURL(settings.background.bgType)

  // 初始化时激活当前背景类型的watch
  activateBackgroundWatch(settings.background.bgType)
})

// 暴露刷新方法，供父组件调用
async function refreshBackground() {
  const type = settings.background.bgType
  try {
    if (type === BgType.Bing) {
      await bingWallpaperURLGetter.refresh(true)
      await updateBackgroundURL(BgType.Bing)
    } else if (type === BgType.Online) {
      // Clear IDB cache only; the current blob URL is revoked through
      // updateBackgroundURL's normal revokeLastBlobUrl() path.
      await clearAllOnlineWallpaperCache()
      await updateBackgroundURL(BgType.Online)
    }
  } catch (error) {
    console.error('[background] Failed to refresh background:', error)
  }
}
defineExpose({ refreshBackground })

useEventListener('pageshow', async (e) => {
  if (e.persisted) {
    await updateBackgroundURL(settings.background.bgType)
  }
})

// 组件卸载时清理watch
onUnmounted(() => {
  stopBgWatch?.()
  stopBgTypeWatch?.()
  // 卸载时释放 Blob URL
  revokeLastBlobUrl()
  // 使所有在途背景更新立即过期，避免卸载后继续写入响应式状态。
  backgroundRequestVersion += 1
  // 卸载时取消正在进行的在线壁纸网络请求
  onlineFetchController?.abort()
  onlineFetchController = null
})

async function onImgLoaded() {
  if (!(settings.theme.monetColor || isVideoWallpaper.value)) return
  if (bgURL.value.startsWith('http')) return
  // 不加延迟会导致刷新开屏卡住切换动画
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      useTimeoutFn(() => applyMonet(imageRef.value!), 0)
    })
  })
}
</script>

<template>
  <div
    ref="backgroundWrapper"
    class="background-wrapper noselect"
    :style="{
      '--mask-color__light': settings.background.mask.light,
      '--mask-color__night': settings.background.mask.night,
      '--blur-intensity': `${settings.background.blur}px`,
      '--bg-opacity-duration': bgOpacityDuration,
    }"
  >
    <div v-if="settings.background.mask.enabled" class="background-mask"></div>
    <div v-if="settings.background.vignette" class="background__vignette" />
    <Transition name="bg-fade">
      <div
        v-show="!isSwitching"
        ref="bgRef"
        class="background-container"
        :class="backgroundCss"
        :style="{
          scale: backgroundScale,
          translate: backgroundTranslate,
          '--parallax-inset':
            backgroundParallaxEnabled && settings.background.blur < 10 ? '20px' : '0px',
        }"
      >
        <video
          v-if="isVideoWallpaper"
          class="background background--video"
          ref="videoRef"
          :src="bgURL || ''"
          autoplay
          muted
          loop
          playsinline
        ></video>
        <img
          v-else-if="bgURL"
          class="background"
          ref="imageRef"
          :src="bgURL.startsWith('url') ? bgURL.replace(bgURLreg, '$2') : bgURL"
          @load="onImgLoaded"
        />
      </div>
    </Transition>
  </div>
</template>

<style lang="scss">
.background-wrapper {
  position: fixed;
  top: 0;
  left: 0;
  z-index: -1;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.background-mask {
  position: absolute;
  width: 100%;
  height: 100%;
  background-color: var(--mask-color__light);
  transition: background-color var(--el-transition-duration-fast) cubic-bezier(0.65, 0.05, 0.1, 1);

  html.dark & {
    background-color: var(--mask-color__night);
  }
}

.background-container {
  position: absolute;
  inset: calc(var(--blur-intensity) * -2 - var(--parallax-inset, 0px));
  z-index: -2;
  filter: blur(var(--blur-intensity));
  transition:
    scale var(--el-transition-duration-fast) cubic-bezier(0.65, 0.05, 0.1, 1),
    filter var(--el-transition-duration-fast) cubic-bezier(0.65, 0.05, 0.1, 1),
    opacity var(--bg-opacity-duration),
    inset var(--el-transition-duration-fast);

  &--focused {
    &__blur {
      filter: blur(calc(var(--blur-intensity) + 10px));
    }
  }
}

.background {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

video.background {
  width: calc(100% + 4 * var(--blur-intensity));
  height: calc(100% + 4 * var(--blur-intensity));
}

.background__vignette {
  position: absolute;
  top: 0;
  left: 0;
  z-index: -1;
  width: 100%;
  height: 100%;
  pointer-events: none;
  background: radial-gradient(rgb(0 0 0 / 0%) 33%, rgb(0 0 0 / 100%) 166%);
}
</style>
