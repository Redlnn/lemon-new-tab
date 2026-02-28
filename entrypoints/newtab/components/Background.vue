<script lang="ts" setup>
import { storeToRefs } from 'pinia'
import {
  promiseTimeout,
  useDark,
  useDocumentVisibility,
  useEventListener,
  useTimeoutFn,
  useWindowFocus
} from '@vueuse/core'

import i18next from 'i18next'

import { browser } from '#imports'

import { BgType } from '@/shared/enums'
import { useSettingsStore } from '@/shared/settings'

import { useBgSwtichStore, useFocusStore } from '@newtab/shared/store'
import { applyMonet } from '@newtab/shared/theme'
import {
  bingWallpaperURLGetter,
  cacheOnlineWallpaper,
  clearAllOnlineWallpaperCache,
  getCachedOnlineWallpaper,
  useWallpaperUrlStore
} from '@newtab/shared/wallpaper'

let animationDuration = 1250
let hasShortenedFade = false

const isDark = useDark()

const focusStore = useFocusStore()
const settings = useSettingsStore()

// 如果设置了快速初始动画，则直接使用短时间
if (settings.background.fastAnimation) {
  animationDuration = 300
}

const wallpaperUrlStore = useWallpaperUrlStore()
const { lightUrl, darkUrl } = storeToRefs(wallpaperUrlStore)
const switchStore = useBgSwtichStore()

const imageRef = useTemplateRef('imageRef')
const videoRef = useTemplateRef('videoRef')
const bgURL = ref<string>('')
const bgOpacityDuration = ref(settings.background.fastAnimation ? '0.3s' : '1.25s')

function shortenBgFadeDuration() {
  if (hasShortenedFade) return
  hasShortenedFade = true
  animationDuration = 300
  bgOpacityDuration.value = '0.3s'
}

const bgURLreg = new RegExp('url\\((["\']?)(.*?)\\1\\)', 'i')
const isChrome = import.meta.env.CHROME || import.meta.env.EDGE

// 视频壁纸相关逻辑

const isWindowFocused = useWindowFocus()
const documentVisibility = useDocumentVisibility()

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
    } catch {}
  } else {
    try {
      // play() 会返回一个 Promise，使用 void 忽略未处理的 Promise 警告
      void vid.play()
    } catch {}
  }
}

const backgroundCss = computed(() => ({
  'background-container--default-scale': settings.perf.disableFocusScale,
  'background-container--focused__scale': focusStore.isFocused && !settings.perf.disableFocusScale,
  'background-container--focused__blur': focusStore.isFocused && !settings.perf.disableFocusBlur
}))

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
    if (!settings.background.online.cacheEnable && !settings.theme.monetColor) {
      return rawUrl
    }

    if (isChrome) {
      const allGranted = await browser.permissions.contains({ origins: [`*://*/*`] })
      if (!allGranted) {
        return rawUrl
      }
    }

    const now = Date.now()
    const useCache = settings.background.online.cacheEnable
    // 如果开启了缓存，则尝试从缓存中获取
    const cached = useCache ? await getCachedOnlineWallpaper(rawUrl) : null

    let isCacheValid = false

    if (cached) {
      const ageHours = (now - cached.timestamp) / 36e5
      const withinDuration = ageHours <= settings.background.online.cacheDuration

      isCacheValid = settings.background.online.noExpires || withinDuration
    }

    if (isCacheValid) {
      return URL.createObjectURL(cached!.blob)
    }

    let blob: Blob | null = null

    // 如果没有命中缓存或没有开启缓存
    try {
      // 下载新的图像
      const res = await fetch(rawUrl)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      blob = await res.blob()
    } catch (e) {
      ElNotification.error({
        title: i18next.t('newtab:notification.onlineWallpaperCache.error.title'),
        message: i18next.t('newtab:notification.onlineWallpaperCache.error.message', { error: e })
      })
      if (cached)
        return URL.createObjectURL(cached.blob) // 如果下载失败，不管缓存是否过期都继续使用缓存
      else return rawUrl // 假如开了莫奈，这里会有未定义行为，也许在应用莫奈的时候会出错
    }

    const newCache = { blob, timestamp: now }

    // 缓存新下载的图像（如果开启了缓存）
    if (settings.background.online.cacheEnable) {
      await cacheOnlineWallpaper(rawUrl, newCache)
    }

    return URL.createObjectURL(blob)
  },
  [BgType.None]: () => Promise.resolve('')
}

async function assignMaybeRef<T>(
  target: Ref<T>,
  source: T | Ref<T> | Promise<T> | Promise<Ref<T>>
) {
  let stop: (() => void) | undefined

  const process = async () => {
    const resolved = await source
    if (isRef(resolved)) {
      stop?.() // 停止旧的 watch（避免重复）
      stop = watch(resolved, (v) => (target.value = v), { immediate: true })
    } else {
      target.value = resolved
    }
  }

  process()
  return () => stop?.()
}

watch(
  [isVideoWallpaper, documentVisibility, isWindowFocused, () => settings.background.pauseOnBlur],
  ([isVideo]) => {
    if (!isVideo) {
      // 非视频壁纸，确保视频被暂停
      const vid = videoRef.value
      if (vid) {
        try {
          vid.pause()
        } catch {}
      }
      return
    }

    updateVideoPlayback()
  },
  { immediate: true }
)

// 动态watch管理
let stopBgWatch: (() => void) | undefined
let stopLocalBgWatch: (() => void) | null = null
let stopOnlineBgWatch: (() => void) | null = null

async function updateBackgroundURL(type: BgType): Promise<void> {
  const provider = bgTypeProviders[type]
  if (!provider) return

  const newUrl = await provider()
  // 只在URL真正变化时才执行切换动画
  if (type !== BgType.Online && newUrl === bgURL.value) return

  switchStore.start()

  // 等待过渡动画
  // 首次打开默认白屏，不需要等待白屏动画
  if (bgURL.value !== '') {
    if (!settings.perf.disableBgSwitchAnim) {
      await promiseTimeout(animationDuration)
    }
    // 不直接赋值是因为避免看到壁纸变形
    // 直接赋值为原始 URL（Background 组件会决定是否包裹 url()）
    bgURL.value = ''
  }
  stopBgWatch?.() // 切换 provider 时清除旧监听
  stopBgWatch = await assignMaybeRef(bgURL, newUrl)

  switchStore.end()
  if (!settings.perf.disableBgSwitchAnim) {
    await promiseTimeout(animationDuration)
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
  stopLocalBgWatch?.()
  stopOnlineBgWatch?.()
  stopLocalBgWatch = null
  stopOnlineBgWatch = null

  // 根据类型激活对应的watch
  if (type === BgType.Local) {
    // 只在使用本地背景时监听本地背景变化
    stopLocalBgWatch = watch(currentLocalUrl, handleLocalBgChange)
  } else if (type === BgType.Online) {
    // 只在使用在线背景时监听在线URL变化
    stopOnlineBgWatch = watch(() => settings.background.online.url, handleOnlineBgChange)
  }
  // Bing和None类型不需要watch，因为它们不会动态变化
}

// 监听背景类型切换，动态激活/停用对应的watch
watch(
  () => settings.background.bgType,
  async (newType, oldType) => {
    if (newType === oldType) return
    await updateBackgroundURL(newType)
    activateBackgroundWatch(newType)
  }
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
  { immediate: true }
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
      await clearAllOnlineWallpaperCache(bgURL.value)
      await updateBackgroundURL(BgType.Online)
    }
  } catch {}
}
defineExpose({ refreshBackground })

useEventListener('pageshow', async (e) => {
  if (e.persisted) {
    await updateBackgroundURL(settings.background.bgType)
  }
})

// 组件卸载时清理watch
onUnmounted(() => {
  stopLocalBgWatch?.()
  stopOnlineBgWatch?.()
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
      '--mask-opacity': settings.background.mask.opacity / 100,
      '--mask-color__light': settings.background.mask.light,
      '--mask-color__night': settings.background.mask.night,
      '--blur-intensity': `${settings.background.blur}px`,
      '--bg-opacity-duration': bgOpacityDuration
    }"
  >
    <div class="background-mask"></div>
    <div v-if="settings.background.vignette" class="background__vignette" />
    <Transition name="v-fade">
      <div
        v-show="!switchStore.isSwitching"
        ref="bgRef"
        class="background-container"
        :class="backgroundCss"
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
  inset: calc(var(--blur-intensity) * -2);
  background-color: var(--mask-color__light);
  opacity: var(--mask-opacity);
  transition: background-color var(--el-transition-duration-fast) cubic-bezier(0.65, 0.05, 0.1, 1);

  html.dark & {
    background-color: var(--mask-color__night);
  }
}

.background-container {
  position: absolute;
  inset: calc(var(--blur-intensity) * -2);
  z-index: -2;
  filter: blur(var(--blur-intensity));
  transition:
    transform var(--el-transition-duration-fast) cubic-bezier(0.65, 0.05, 0.1, 1),
    filter var(--el-transition-duration-fast) cubic-bezier(0.65, 0.05, 0.1, 1),
    opacity var(--bg-opacity-duration);

  &--default-scale {
    transform: scale(1.05);
  }

  &--focused {
    &__scale {
      transform: scale(1.1);
    }

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
