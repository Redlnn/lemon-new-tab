<script lang="ts" setup>
import {
  promiseTimeout,
  useDark,
  useDocumentVisibility,
  useEventListener,
  useThrottleFn,
  useWindowFocus,
} from '@vueuse/core'
import { storeToRefs } from 'pinia'

import i18next from 'i18next'

import { browser } from '#imports'

import { BgType } from '@/shared/enums'
import { useSettingsStore } from '@/shared/settings'

import { useBackgroundMonet } from '@newtab/composables/useBackgroundMonet'
import { useFocusState } from '@newtab/composables/useFocus'
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
const { lightUrl, darkUrl, bingUrl } = storeToRefs(wallpaperUrlStore)
const activeLocalUrl = computed(() =>
  isDark.value && settings.background.localDark.id ? darkUrl.value : lightUrl.value,
)
const isSwitching = ref(true)

const imageRef = useTemplateRef('imageRef')
const videoRef = useTemplateRef('videoRef')
const bgURL = ref<string>('')
const lastBlobUrl = ref<string>('')
const activeMonetSourceKey = ref('')

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

function getLocalMonetSourceKey() {
  if (isDark.value && settings.background.localDark.id) {
    return `local:dark:${settings.background.localDark.id}`
  }
  return settings.background.local.id ? `local:light:${settings.background.local.id}` : ''
}

function getBingMonetSourceKey() {
  const bing = settings.background.bing
  return bing.id ? `bing:${bing.id}:${bing.updateDate}` : ''
}

function getOnlineMonetSourceKey(rawUrl: string, timestamp: number | 'raw') {
  return rawUrl ? `online:${rawUrl}:${timestamp}` : ''
}

type CachedOnlineWallpaper = NonNullable<Awaited<ReturnType<typeof getCachedOnlineWallpaper>>>

function isOnlineWallpaperCacheValid(cached: CachedOnlineWallpaper | null, now: number) {
  if (!cached) return false
  const ageHours = (now - cached.timestamp) / 36e5
  const withinDuration = ageHours <= settings.background.online.cache.duration
  return settings.background.online.cache.noExpires || withinDuration
}

type BackgroundSource = {
  url: string
  sourceKey: string
  ownedObjectUrl: boolean
}

function createOnlineWallpaperBlobUrl(
  rawUrl: string,
  cached: CachedOnlineWallpaper,
): BackgroundSource {
  return {
    url: URL.createObjectURL(cached.blob),
    sourceKey: getOnlineMonetSourceKey(rawUrl, cached.timestamp),
    ownedObjectUrl: true,
  }
}

const bgTypeProviders: Record<BgType, () => Promise<BackgroundSource>> = {
  [BgType.Bing]: async () => {
    await bingWallpaperURLGetter.init()
    return {
      url: bingUrl.value,
      sourceKey: getBingMonetSourceKey(),
      ownedObjectUrl: false,
    }
  },
  [BgType.Local]: async () => {
    const target = isDark.value && settings.background.localDark.id ? 'dark' : 'light'
    const targetUrl = target === 'dark' ? darkUrl : lightUrl
    // Store watcher 已经解析出的 URL 必须直接复用；再次读取 Blob 会创建新的对象 URL，
    // 反过来触发本组件 watcher 并形成无限加载循环。
    if (!targetUrl.value) await wallpaperUrlStore.getUrl(target)
    return {
      url: targetUrl.value,
      sourceKey: getLocalMonetSourceKey(),
      ownedObjectUrl: false,
    }
  },
  [BgType.Online]: async () => {
    const rawUrl = settings.background.online.url
    if (!rawUrl) {
      return { url: '', sourceKey: '', ownedObjectUrl: false }
    }

    // 如果没有开启缓存且没有开启莫奈，直接返回原始URL
    if (!settings.background.online.cache.enabled && !settings.theme.monetColor) {
      return {
        url: rawUrl,
        sourceKey: getOnlineMonetSourceKey(rawUrl, 'raw'),
        ownedObjectUrl: false,
      }
    }

    // MV3才需要检查全站权限，MV2的Firefox不需要
    if (import.meta.env.MANIFEST_VERSION === 3) {
      const allGranted = await browser.permissions.contains({ origins: [`*://*/*`] })
      if (!allGranted) {
        return {
          url: rawUrl,
          sourceKey: getOnlineMonetSourceKey(rawUrl, 'raw'),
          ownedObjectUrl: false,
        }
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

    if (cached && isOnlineWallpaperCacheValid(cached, now)) {
      return createOnlineWallpaperBlobUrl(rawUrl, cached)
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
        return { url: '', sourceKey: '', ownedObjectUrl: false }
      }
      ElNotification.error({
        title: i18next.t('newtab:notification.wallpaperCache.title'),
        message: i18next.t('newtab:notification.wallpaperCache.message', { error: e }),
      })
      if (cached) {
        return createOnlineWallpaperBlobUrl(rawUrl, cached) // 如果下载失败，不管缓存是否过期都继续使用缓存
      }
      // Download failed and no cache is available. Return the raw URL as explicit degraded
      // behavior: Monet will not be applied (onImgLoaded already guards against HTTP URLs).
      return {
        url: rawUrl,
        sourceKey: getOnlineMonetSourceKey(rawUrl, 'raw'),
        ownedObjectUrl: false,
      }
    }

    const newCache = { blob, timestamp: now }

    // 缓存新下载的图像（如果开启了缓存）
    if (settings.background.online.cache.enabled) {
      await cacheOnlineWallpaper(rawUrl, newCache)
    }

    return {
      url: URL.createObjectURL(blob),
      sourceKey: getOnlineMonetSourceKey(rawUrl, now),
      ownedObjectUrl: true,
    }
  },
  [BgType.None]: async () => ({ url: '', sourceKey: '', ownedObjectUrl: false }),
}

function revokeDiscardedSource(source: BackgroundSource) {
  if (source.ownedObjectUrl && source.url) URL.revokeObjectURL(source.url)
}

function trackBackgroundBlobUrl(source: BackgroundSource) {
  if (source.ownedObjectUrl && source.url) {
    revokeLastBlobUrl()
    lastBlobUrl.value = source.url
    return
  }

  revokeLastBlobUrl()
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

let backgroundRequestVersion = 0
let onlineFetchController: AbortController | null = null

async function updateBackgroundURL(type: BgType): Promise<void> {
  const requestVersion = ++backgroundRequestVersion
  invalidateMonet()
  const provider = bgTypeProviders[type]
  if (!provider) return

  let source: BackgroundSource
  try {
    source = await provider()
  } catch (error) {
    if (requestVersion !== backgroundRequestVersion) return
    console.error('Failed to update background URL:', error)
    isSwitching.value = false
    return
  }
  if (requestVersion !== backgroundRequestVersion) {
    revokeDiscardedSource(source)
    return
  }

  trackBackgroundBlobUrl(source)
  activeMonetSourceKey.value = source.sourceKey

  // 只在URL真正变化时才执行切换动画
  if (source.url === bgURL.value) {
    // 新请求可能在旧请求的切换动画期间切回当前壁纸；此时要主动结束旧切换状态。
    isSwitching.value = false
    return
  }

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

  bgURL.value = source.url

  isSwitching.value = false
  if (settings.perf.bgSwitchAnim) {
    await promiseTimeout(animationDuration)
    if (requestVersion !== backgroundRequestVersion) return
  }
  shortenBgFadeDuration()
}

const { invalidate: invalidateMonet, onImageLoaded: onImgLoaded } = useBackgroundMonet({
  backgroundUrl: bgURL,
  image: imageRef,
  isVideo: isVideoWallpaper,
  sourceKey: activeMonetSourceKey,
  refreshOnline: () => updateBackgroundURL(BgType.Online),
})

watch(
  () => settings.background.bgType,
  (newType, oldType) => {
    if (newType !== oldType) void updateBackgroundURL(newType)
  },
)

watch(activeLocalUrl, () => {
  if (settings.background.bgType === BgType.Local) void updateBackgroundURL(BgType.Local)
})

watch(bingUrl, () => {
  if (settings.background.bgType === BgType.Bing) void updateBackgroundURL(BgType.Bing)
})

watch(
  () => settings.background.online.url,
  () => {
    if (settings.background.bgType === BgType.Online) void updateBackgroundURL(BgType.Online)
  },
)

onMounted(async () => {
  await updateBackgroundURL(settings.background.bgType)
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
  // 卸载时释放 Blob URL
  revokeLastBlobUrl()
  // 使所有在途背景更新立即过期，避免卸载后继续写入响应式状态。
  backgroundRequestVersion += 1
  // 卸载时取消正在进行的在线壁纸网络请求
  onlineFetchController?.abort()
  onlineFetchController = null
})
</script>

<template>
  <div
    ref="backgroundWrapper"
    class="background-wrapper noselect"
    aria-hidden="true"
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
          alt=""
          @load="onImgLoaded"
        />
      </div>
    </Transition>
  </div>
</template>

<style lang="scss">
.background-wrapper {
  --background-mask-color: var(--mask-color__light);

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
  background-color: var(--background-mask-color);
  transition: background-color var(--el-transition-duration-fast) cubic-bezier(0.65, 0.05, 0.1, 1);
}

html.dark .background-wrapper {
  --background-mask-color: var(--mask-color__night);
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
