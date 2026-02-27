<script lang="ts" setup>
import { ref } from 'vue'

import { useSettingsStore } from '@/shared/settings'

import { bingWallpaperURLGetter, getCachedOnlineWallpaper } from '@newtab/shared/wallpaper'

const playing = ref(false)
const canAnimation = ref(true)

function play() {
  if (playing.value) return
  canAnimation.value = true
  requestAnimationFrame(() => {
    playing.value = true
  })
}

function onEnd(e: TransitionEvent) {
  // 只监听一次（避免两个 path 重复触发）
  if (!e.target) return
  if (!(e.target as Element).classList.contains('arrow1')) return

  canAnimation.value = false
  requestAnimationFrame(() => {
    playing.value = false
  })
}

const settings = useSettingsStore()

const extMap: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/avif': 'avif',
  'image/jxl': 'jxl',
  'image/apng': 'png',
  'image/heic': 'heic',
  'image/heif': 'heif'
}

function downloadImageBlob(blob: Blob) {
  const mime = blob.type

  const ext = extMap[mime] || 'bin' // fallback
  const finalName = `image.${ext}`

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')

  a.href = url
  a.download = finalName
  a.target = '_blank'
  a.click()

  URL.revokeObjectURL(url)
}

async function downloadOnline() {
  if (!settings.background.online.cacheEnable) {
    ElMessage.warning('需要开启「在线壁纸缓存」后才能下载壁纸')
    return
  }
  const cached = await getCachedOnlineWallpaper(settings.background.online.url)
  if (!cached) return
  downloadImageBlob(cached.blob)
}

function downloadBing() {
  window.open(bingWallpaperURLGetter.uhdUrl.value, '_blank')
}

async function download() {
  if (settings.background.bgType === 'online') {
    await downloadOnline()
  } else if (settings.background.bgType === 'bing') {
    downloadBing()
  }
}
</script>

<template>
  <div
    role="button"
    tabindex="0"
    class="action-btn"
    @mouseenter="play"
    @mouseleave="play"
    @click="download"
    @keydown.enter="download"
  >
    <el-icon>
      <svg viewBox="0 0 24 24">
        <!-- material: DownloadRound -->
        <!-- 裁剪区域：只允许箭头在横线之上显示 -->
        <defs>
          <clipPath id="clip">
            <!-- 横线大概在 y=18，这里裁到 18 -->
            <rect x="0" y="0" width="24" height="18" />
          </clipPath>
        </defs>

        <!-- 箭头区域 -->
        <g
          class="arrow-wrap"
          :class="{ play: playing, canAnimation: canAnimation }"
          clip-path="url(#clip)"
          @transitionend="onEnd"
        >
          <path
            class="arrow arrow1"
            d="M16.59 10H15V4.5c0-.55-.45-1-1-1h-4c-.55 0-1 .45-1 1v5.5H7.41c-.89 0-1.34 1.08-.71 1.71l4.59 4.59c.39.39 1.02.39 1.41 0l4.59-4.59c.63-.63.19-1.71-.7-1.71z"
            fill="currentColor"
          />
          <path
            class="arrow arrow2"
            d="M16.59 10H15V4.5c0-.55-.45-1-1-1h-4c-.55 0-1 .45-1 1v5.5H7.41c-.89 0-1.34 1.08-.71 1.71l4.59 4.59c.39.39 1.02.39 1.41 0l4.59-4.59c.63-.63.19-1.71-.7-1.71z"
            fill="currentColor"
          />
        </g>

        <!-- 横线 -->
        <path
          d="M5 19c0 .55.45 1 1 1h12c.55 0 1-.45 1-1s-.45-1-1-1H6c-.55 0-1 .45-1 1z"
          fill="currentColor"
        />
      </svg>
    </el-icon>
  </div>
</template>

<style scoped lang="scss">
.arrow {
  .canAnimation & {
    transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  }

  /* 初始状态 */
  &.arrow1 {
    transform: translateY(0);
  }

  &.arrow2 {
    transform: translateY(-18px); /* 注意：只移动到裁剪顶部 */
  }
}

/* 播放动画 */
.arrow-wrap.play {
  .arrow1 {
    transform: translateY(18px);
  }

  .arrow2 {
    transform: translateY(0);
  }
}
</style>
