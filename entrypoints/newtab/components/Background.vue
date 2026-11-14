<script lang="ts" setup>
import {
  promiseTimeout,
  useDocumentVisibility,
  useEventListener,
  useThrottleFn,
  useWindowFocus,
} from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { defineAsyncComponent } from 'vue'

import { useTranslation } from 'i18next-vue'

import { browser } from '#imports'

import { BgType } from '@/shared/enums'
import { useSettingsStore } from '@/shared/settings'

import { useBackgroundMonet } from '@newtab/composables/useBackgroundMonet'
import { useFocusState } from '@newtab/composables/useFocus'
import { isDark } from '@newtab/shared/colorMode'
import { isOnlyTouchDevice } from '@newtab/shared/touch'
import {
  bingWallpaperURLGetter,
  cacheOnlineWallpaper,
  clearAllOnlineWallpaperCache,
  getCachedOnlineWallpaper,
  useWallpaperUrlStore,
  useLocalWallpaperStore,
  prepareWallpaper,
} from '@newtab/shared/wallpaper'

let animationDuration = 1250
let hasShortenedFade = false
const MeadowBackground = defineAsyncComponent(() => import('./MeadowBackground.vue'))
const BeachBackground = defineAsyncComponent(() => import('./BeachBackground.vue'))

const focusStore = useFocusState()
const settings = useSettingsStore()
const { t } = useTranslation()

// 如果设置了快速初始动画，则直接使用短时间
if (settings.background.fastAnimation) {
  animationDuration = 300
}

const wallpaperUrlStore = useWallpaperUrlStore()
const { bingUrl } = storeToRefs(wallpaperUrlStore)
const localLibrary = useLocalWallpaperStore()
const activeVariant = computed(() =>
  isDark.value && localLibrary.library.dark.items.length ? 'dark' : 'light',
)
const renderedVideo = ref(false)
const solidColor = computed(
  () => settings.background.solid[isDark.value ? 'dark' : 'light'] || 'var(--el-bg-color-page)',
)
// 动态壁纸的场景本身有入场动画，首屏无需先把整张画布从透明渐显。
const isSwitching = ref(
  settings.background.bgType !== BgType.Meadow && settings.background.bgType !== BgType.Beach,
)

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
  'background-container--focused__blur':
    settings.background.bgType !== BgType.Meadow &&
    settings.background.bgType !== BgType.Beach &&
    focusStore.isFocused &&
    settings.perf.focus.blur,
}))

// 视差效果
const backgroundParallaxEnabled = computed(
  () =>
    settings.background.bgType !== BgType.Meadow &&
    settings.background.bgType !== BgType.Beach &&
    settings.background.parallax &&
    !isOnlyTouchDevice.value,
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

const isVideoWallpaper = computed(() => renderedVideo.value)

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
  local?: NonNullable<typeof localLibrary.displayed>
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
    return {
      url: bingUrl.value,
      sourceKey: getBingMonetSourceKey(),
      ownedObjectUrl: false,
    }
  },
  [BgType.Local]: async () => {
    const variant = activeVariant.value
    const id = localLibrary.selected[variant]
    const items = localLibrary.library[variant].items
    const candidates = [
      ...items.filter((item) => item.id === id),
      ...items.filter((item) => item.id !== id),
    ]
    for (const item of candidates) {
      try {
        const url = await localLibrary.getUrl(variant, item)
        if (localLibrary.displayed?.url !== url)
          await prepareWallpaper(url, item.mediaType === 'video')
        return {
          url,
          sourceKey: `local:${variant}:${item.id}:${item.sha256 ?? ''}`,
          ownedObjectUrl: false,
          local: { variant, item, url },
        }
      } catch (error) {
        console.warn('[wallpaper] Could not load local wallpaper:', item.id, error)
      }
    }
    if (items.length) throw new Error('No local wallpaper could be loaded')
    return { url: '', sourceKey: '', ownedObjectUrl: false }
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
        title: t('newtab:notification.wallpaperCache.title'),
        message: t('newtab:notification.wallpaperCache.message', { error: e }),
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
  [BgType.Meadow]: async () => ({ url: '', sourceKey: 'meadow', ownedObjectUrl: false }),
  [BgType.Beach]: async () => ({ url: '', sourceKey: 'beach', ownedObjectUrl: false }),
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

let backgroundLoads = 0
async function updateBackgroundURL(type: BgType): Promise<void> {
  backgroundLoads++
  try {
    const requestVersion = ++backgroundRequestVersion
    invalidateMonet()
    const provider = bgTypeProviders[type]
    if (!provider) return

    let source: BackgroundSource
    try {
      if (type === BgType.Bing) await bingWallpaperURLGetter.init()
      else if (type === BgType.Local) {
        await localLibrary.init()
        if (requestVersion !== backgroundRequestVersion) return
        await localLibrary.choose(activeVariant.value)
      }
      // 初始化可能更新 URL 或选中项，先让统一入口接收最新来源，再准备媒体。
      await nextTick()
      if (requestVersion !== backgroundRequestVersion) return
      source = await provider()
    } catch (error) {
      if (requestVersion !== backgroundRequestVersion) return
      requestedSource = undefined
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

    // 新媒体已经解码就绪，同一渲染批次替换类型和 URL，不先清空旧画面。
    if (requestVersion !== backgroundRequestVersion) return
    renderedVideo.value = source.local?.item.mediaType === 'video'
    localLibrary.displayed = source.local ?? null
    bgURL.value = source.url

    isSwitching.value = false
    if (settings.perf.bgSwitchAnim) {
      await promiseTimeout(animationDuration)
      if (requestVersion !== backgroundRequestVersion) return
    }
    shortenBgFadeDuration()
  } finally {
    backgroundLoads--
    if (!backgroundLoads) {
      const current = localLibrary.displayed
      localLibrary.releaseExcept(
        new Set(
          current ? [`${current.variant}:${current.item.id}:${current.item.sha256 ?? ''}`] : [],
        ),
      )
    }
  }
}

const backgroundSource = computed(() => {
  const type = settings.background.bgType
  if (type === BgType.Local) {
    const variant = activeVariant.value
    return JSON.stringify([
      type,
      variant,
      localLibrary.selected[variant],
      localLibrary.library[variant].items.map((item) => [item.id, item.sha256 ?? '']),
    ])
  }
  return JSON.stringify([
    type,
    type === BgType.Bing
      ? bingUrl.value
      : type === BgType.Online
        ? settings.background.online.url
        : '',
  ])
})

let requestedSource: string | undefined
let backgroundTask = Promise.resolve()

function requestBackgroundUpdate(force = false) {
  if (!force && requestedSource === backgroundSource.value) return backgroundTask
  requestedSource = backgroundSource.value
  backgroundTask = updateBackgroundURL(settings.background.bgType)
  return backgroundTask
}

const { invalidate: invalidateMonet, onImageLoaded: onImgLoaded } = useBackgroundMonet({
  backgroundUrl: bgURL,
  image: imageRef,
  isVideo: isVideoWallpaper,
  sourceKey: activeMonetSourceKey,
  refreshOnline: () => requestBackgroundUpdate(true),
})

function handleBeachError() {
  if (settings.background.bgType !== BgType.Beach) return
  ElMessage.error(t('settings:background.beach.error'))
  settings.background.bgType = BgType.None
}

function handleMeadowError() {
  if (settings.background.bgType !== BgType.Meadow) return
  ElMessage.error(t('settings:background.meadow.error'))
  settings.background.bgType = BgType.None
}

watch(backgroundSource, () => void requestBackgroundUpdate())

onMounted(async () => {
  await requestBackgroundUpdate()
})

// 暴露刷新方法，供父组件调用
async function refreshBackground() {
  const type = settings.background.bgType
  try {
    if (type === BgType.Bing) {
      await bingWallpaperURLGetter.refresh(true)
      await requestBackgroundUpdate()
    } else if (type === BgType.Local) {
      await localLibrary.choose(activeVariant.value, true)
      await requestBackgroundUpdate()
    } else if (type === BgType.Online) {
      // Clear IDB cache only; the current blob URL is revoked through
      // updateBackgroundURL's normal revokeLastBlobUrl() path.
      await clearAllOnlineWallpaperCache()
      await requestBackgroundUpdate(true)
    }
  } catch (error) {
    console.error('[background] Failed to refresh background:', error)
  }
}
const meadowRef =
  useTemplateRef<InstanceType<typeof import('./MeadowBackground.vue').default>>('meadow')
const beachRef =
  useTemplateRef<InstanceType<typeof import('./BeachBackground.vue').default>>('beach')
function moveMeadowBoy(x: number, y: number) {
  meadowRef.value?.moveBoy(x, y)
}
function rippleBeach(x: number, y: number) {
  beachRef.value?.ripple(x, y)
}
defineExpose({ refreshBackground, moveMeadowBoy, rippleBeach })

useEventListener('pageshow', async (e) => {
  if (e.persisted) {
    await requestBackgroundUpdate(true)
  }
})

// 组件卸载时清理watch
onUnmounted(() => {
  // 卸载时释放 Blob URL
  revokeLastBlobUrl()
  localLibrary.displayed = null
  localLibrary.releaseExcept(new Set())
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
      backgroundColor: settings.background.bgType === BgType.Beach ? '#008fb9' : solidColor,
      '--mask-color__light': settings.background.mask.light,
      '--mask-color__night': settings.background.mask.night,
      '--blur-intensity': `${settings.background.bgType === BgType.Meadow || settings.background.bgType === BgType.Beach ? 0 : settings.background.blur}px`,
      '--bg-opacity-duration': bgOpacityDuration,
    }"
  >
    <div
      v-if="
        (bgURL ||
          settings.background.bgType === BgType.Meadow ||
          settings.background.bgType === BgType.Beach) &&
        settings.background.bgType !== BgType.None &&
        settings.background.mask.enabled
      "
      class="background-mask"
    ></div>
    <div
      v-if="
        bgURL &&
        settings.background.bgType !== BgType.None &&
        settings.background.bgType !== BgType.Meadow &&
        settings.background.bgType !== BgType.Beach &&
        settings.background.vignette
      "
      class="background__vignette"
    />
    <Transition
      name="bg-fade"
      :css="settings.perf.bgSwitchAnim"
      @before-leave="(element) => element.querySelector('video')?.pause()"
    >
      <div
        :key="
          settings.background.bgType === BgType.Meadow ||
          settings.background.bgType === BgType.Beach
            ? settings.background.bgType
            : bgURL
        "
        v-show="!isSwitching"
        ref="bgRef"
        class="background-container"
        :class="backgroundCss"
        :style="{
          scale:
            settings.background.bgType === BgType.Meadow ||
            settings.background.bgType === BgType.Beach
              ? 1
              : backgroundScale,
          translate: backgroundTranslate,
          '--parallax-inset':
            backgroundParallaxEnabled && settings.background.blur < 10 ? '20px' : '0px',
        }"
      >
        <MeadowBackground
          v-if="settings.background.bgType === BgType.Meadow"
          ref="meadow"
          @error="handleMeadowError"
        />
        <BeachBackground
          v-else-if="settings.background.bgType === BgType.Beach"
          ref="beach"
          @error="handleBeachError"
        />
        <video
          v-else-if="isVideoWallpaper"
          class="background background--video"
          ref="videoRef"
          :src="bgURL || ''"
          autoplay
          muted
          loop
          playsinline
          @loadeddata="updateVideoPlayback"
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
