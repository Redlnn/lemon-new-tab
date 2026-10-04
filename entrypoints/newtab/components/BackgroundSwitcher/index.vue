<script setup lang="ts">
import './bg-switcher.scss'
import { useDark, useElementSize } from '@vueuse/core'

import { DragDropProvider, type DragEndEvent } from '@dnd-kit/vue'
import { useTranslation } from 'i18next-vue'
import DownloadRound from '~icons/ic/round-download'
import LaunchRound from '~icons/ic/round-launch'

import { BgType } from '@/shared/enums'
import { sha256Hex } from '@/shared/json'
import { useSettingsStore, type BingWallpaperResolution } from '@/shared/settings'
import { idbGet } from '@/shared/storage/idb'
import {
  addWallpaper,
  clearWallpaperThumbnails,
  removeWallpapers,
  reorderWallpapers,
  updateWallpaperLibrary,
  wallpaperStore,
  type WallpaperItem,
  type WallpaperVariant,
} from '@/shared/wallpaperLibrary'

import BaseDialog from '@newtab/components/BaseDialog.vue'
import { bingWallpaperURLGetter, useLocalWallpaperStore } from '@newtab/shared/wallpaper'
import { readWallpaperMetadata } from '@newtab/shared/wallpaper/thumbnail'

import useBackgroundSwitcher from './useBackgroundSwitcher'
import WallpaperSortableItem from './WallpaperSortableItem.vue'

const opened = defineModel<boolean>({ required: true })
const { t } = useTranslation('settings')
const settings = useSettingsStore()
const local = useLocalWallpaperStore()
const isDark = useDark()
const variant = ref<WallpaperVariant>(isDark.value ? 'dark' : 'light')
const managing = ref(false)
const expanded = ref(false)
const selected = ref<string[]>([])
const busy = ref(false)
const filesInput = useTemplateRef('filesInput')
const grid = useTemplateRef('grid')
const { width } = useElementSize(grid)
const columns = computed(() => (width.value < 350 ? 2 : width.value < 480 ? 3 : 4))
const items = computed(() => local.library[variant.value].items)
const visibleItems = computed(() =>
  expanded.value || managing.value ? items.value : items.value.slice(0, columns.value * 2 - 1),
)
const thumbnails = reactive<Record<string, string>>({})
const thumbnailHashes = new Map<string, string | undefined>()
const thumbnailTasks = new Map<string, { promise: Promise<void>; version: number }>()
const thumbnailLanes = [Promise.resolve(), Promise.resolve()]
let thumbnailLane = 0
let thumbnailVersion = 0
let thumbnailLoads = 0
let metadataRefreshNeeded = false
const { tempOnlineUrl, changeOnlineBg, onlineImageWarn } = useBackgroundSwitcher()
const bingSrc = bingWallpaperURLGetter.getBgUrl()
const bingInfo = bingWallpaperURLGetter.getInfo()
const resolutionBusy = ref(false)
const groups = ['light', 'dark'] as const
const label = (key: string) => t(`background.library.${key}`)

watch(
  opened,
  async (value) => {
    if (!value) {
      releaseThumbnails()
      return
    }
    await local.init()
    void bingWallpaperURLGetter.init().catch(console.error)
  },
  { immediate: true },
)
watch(variant, () => {
  selected.value = []
  expanded.value = false
})
watch(
  [visibleItems, variant, opened],
  () => {
    if (opened.value) for (const item of visibleItems.value) void loadThumbnail(variant.value, item)
  },
  { immediate: true },
)

function releaseThumbnails() {
  thumbnailVersion++
  thumbnailTasks.clear()
  thumbnailHashes.clear()
  for (const key of Object.keys(thumbnails)) {
    URL.revokeObjectURL(thumbnails[key]!)
    delete thumbnails[key]
  }
}
onUnmounted(releaseThumbnails)
async function loadThumbnail(group: WallpaperVariant, item: WallpaperItem) {
  const key = `${group}:${item.id}`
  if (thumbnails[key] && thumbnailHashes.get(key) !== item.sha256) {
    URL.revokeObjectURL(thumbnails[key]!)
    delete thumbnails[key]
  }
  if (thumbnails[key] || thumbnailTasks.has(key)) return
  const version = thumbnailVersion
  const lane = thumbnailLane++ % 2
  thumbnailLoads++
  const task = thumbnailLanes[lane]!.then(async () => {
    if (!opened.value || version !== thumbnailVersion) return
    let thumbnail = await idbGet('wallpaperLibrary', `thumbnail:${key}`)
    if (!(thumbnail instanceof Blob) && !item.metadataFailed) {
      const blob = await idbGet(wallpaperStore(group), item.id)
      if (!blob) {
        await updateWallpaperLibrary((library) => {
          const current = library[group].items.find((value) => value.id === item.id)
          if (current) current.metadataFailed = true
        })
        metadataRefreshNeeded = true
        return
      }
      try {
        const result = await readWallpaperMetadata(blob)
        thumbnail = result.thumbnail
        await updateWallpaperLibrary(async (library, tx) => {
          const current = library[group].items.find((value) => value.id === item.id)
          if (!current) return
          Object.assign(current, result.metadata)
          if (result.thumbnail)
            await tx.objectStore('wallpaperLibrary').put(result.thumbnail, `thumbnail:${key}`)
        })
        metadataRefreshNeeded = true
      } catch {
        await updateWallpaperLibrary((library) => {
          const current = library[group].items.find((value) => value.id === item.id)
          if (current) current.metadataFailed = true
        })
        metadataRefreshNeeded = true
      }
    }
    if (thumbnail instanceof Blob && version === thumbnailVersion && opened.value) {
      thumbnails[key] = URL.createObjectURL(thumbnail)
      thumbnailHashes.set(key, item.sha256)
    }
  })
    .finally(async () => {
      const current = thumbnailTasks.get(key)
      if (current?.promise === task && current.version === version) thumbnailTasks.delete(key)
      // 关闭面板会清空任务索引，但在途元数据仍需在两路队列结束后统一回填。
      thumbnailLoads--
      if (!thumbnailLoads && metadataRefreshNeeded) {
        metadataRefreshNeeded = false
        await local.reload().catch((error) => {
          metadataRefreshNeeded = true
          throw error
        })
      }
    })
    .catch(console.error)
  thumbnailLanes[lane] = task
  thumbnailTasks.set(key, { promise: task, version })
  await task
}
function metadata(item: WallpaperItem) {
  const resolution =
    item.width && item.height
      ? `${item.width} × ${item.height}`
      : label(item.metadataFailed ? 'unavailable' : 'loading')
  return item.duration ? `${resolution} · ${Math.round(item.duration)}s` : resolution
}
async function importFiles(files: File[]) {
  if (busy.value || !files.length) return
  busy.value = true
  const group = variant.value
  const failures: string[] = []
  let imported = false
  try {
    // 每批最多两个解码任务，提交仍按用户选择顺序。
    for (let index = 0; index < files.length; index += 2) {
      const results = await Promise.allSettled(
        files.slice(index, index + 2).map(async (file) => {
          if (!/^(image|video)\//.test(file.type)) throw new Error('Unsupported media')
          const sha256 = await sha256Hex(await file.arrayBuffer())
          const result = await readWallpaperMetadata(file).catch(() => ({
            metadata: { metadataFailed: true },
            thumbnail: undefined,
          }))
          const item: WallpaperItem = {
            id: crypto.randomUUID(),
            mediaType: file.type.startsWith('video/') ? 'video' : 'image',
            size: file.size,
            sha256,
            ...result.metadata,
          }
          return { file, item, thumbnail: result.thumbnail }
        }),
      )
      for (const [offset, result] of results.entries()) {
        if (result.status === 'rejected') {
          failures.push(files[index + offset]!.name)
          continue
        }
        try {
          await addWallpaper(group, result.value.item, result.value.file, result.value.thumbnail)
          imported = true
        } catch {
          failures.push(files[index + offset]!.name)
        }
      }
    }
    if (imported) await local.changed()
    if (failures.length)
      ElNotification.warning({
        title: t('background.library.importFailed', { count: failures.length }),
        message: failures.join('、'),
      })
  } finally {
    busy.value = false
    if (filesInput.value) filesInput.value.value = ''
  }
}
function onFiles(event: Event) {
  void importFiles(Array.from((event.target as HTMLInputElement).files ?? []))
}
function dropFiles(event: DragEvent) {
  if (event.dataTransfer?.files.length) void importFiles(Array.from(event.dataTransfer.files))
}
async function clickItem(item: WallpaperItem) {
  if (managing.value) {
    selected.value = selected.value.includes(item.id)
      ? selected.value.filter((id) => id !== item.id)
      : [...selected.value, item.id]
    return
  }
  await local.select(variant.value, item.id)
}
async function removeSelected() {
  const group = variant.value
  const ids = [...selected.value]
  try {
    await ElMessageBox.confirm(
      t('background.library.confirmRemove', { count: ids.length }),
      label('remove'),
      { type: 'warning' },
    )
  } catch {
    return
  }
  await removeWallpapers(group, ids)
  selected.value = []
  await local.changed()
}
function dragEnd(event: DragEndEvent) {
  if (event.canceled) return
  const source = event.operation.source as {
    data?: { id?: string }
    initialIndex?: number
    index?: number
  } | null
  if (source?.data?.id && source.initialIndex !== undefined && source.index !== undefined)
    void move(source.data.id, source.index - source.initialIndex)
}
async function move(id: string, offset: number) {
  const ids = items.value.map((item) => item.id)
  const index = ids.indexOf(id),
    target = index + offset
  if (index < 0 || target < 0 || target >= ids.length) return
  ids.splice(index, 1)
  ids.splice(target, 0, id)
  await reorderWallpapers(variant.value, ids)
  await local.changed()
}
async function clearPreviews() {
  await clearWallpaperThumbnails()
  releaseThumbnails()
  await local.reload()
}
function toggleManaging() {
  managing.value = !managing.value
  selected.value = []
}
function solid() {
  settings.background.bgType = BgType.None
}
async function resolution(value: BingWallpaperResolution) {
  resolutionBusy.value = true
  try {
    if (!(await bingWallpaperURLGetter.setResolution(value)))
      ElMessage.warning(t('background.warning.bingResolutionCacheFailed'))
  } catch {
    ElMessage.warning(t('background.warning.bingResolutionCacheFailed'))
  } finally {
    resolutionBusy.value = false
  }
}
function useBing() {
  settings.background.bgType = BgType.Bing
  void bingWallpaperURLGetter.refresh(true)
}
function open(url: string) {
  if (url) window.open(url, '_blank', 'noopener')
}
</script>

<template>
  <base-dialog
    v-model="opened"
    :title="t('background.preferenceTitle')"
    container-class="bg-switcher__dialog"
    :width="660"
    :style="{
      height: `min(${settings.background.bgType === BgType.Local ? (visibleItems.length < columns ? 600 : 700) : settings.background.bgType === BgType.Online ? 500 : 480}px, 85vh)`,
      maxHeight: '85vh',
    }"
  >
    <section class="bg-switcher-section">
      <h3>{{ t('background.today') }}</h3>
      <div class="bg-switcher-today">
        <button
          class="bg-switcher-bing-preview"
          :aria-label="t('background.today')"
          @click="useBing"
        >
          <el-image :src="bingSrc" fit="cover" />
        </button>
        <div class="bg-switcher-bing-content">
          <strong>{{ bingInfo.title }}</strong>
          <p>{{ bingInfo.copyright }}</p>
          <el-space class="bg-switcher-actions">
            <el-button
              text
              bg
              :icon="DownloadRound"
              :aria-label="label('download')"
              @click="open(bingWallpaperURLGetter.uhdUrl.value)"
            />
            <el-button
              text
              bg
              :icon="LaunchRound"
              :aria-label="t('background.bingFrom')"
              @click="open(bingInfo.copyrightlink)"
            />
            <label class="bg-switcher-resolution">
              {{ t('background.resolution') }}
              <el-select
                :model-value="settings.background.bing.resolution"
                :aria-label="t('background.resolution')"
                size="small"
                :loading="resolutionBusy"
                :disabled="resolutionBusy"
                @change="resolution"
              >
                <el-option label="1080P" value="1080p" /><el-option label="4K (UHD)" value="uhd" />
              </el-select>
            </label>
            <span class="bg-switcher-meta">{{ t('background.bingFrom') }}</span>
          </el-space>
        </div>
      </div>
    </section>
    <section class="bg-switcher-section">
      <h3>{{ t('background.custom') }}</h3>
      <el-space class="bg-switcher-sources">
        <el-button
          text
          bg
          :class="{ active: settings.background.bgType === BgType.None }"
          @click="solid"
        >
          {{ label('solid') }}
        </el-button>
        <el-button
          text
          bg
          :class="{ active: settings.background.bgType === BgType.Local }"
          @click="settings.background.bgType = BgType.Local"
        >
          {{ t('background.type.local') }}
        </el-button>
        <el-button
          text
          bg
          :class="{ active: settings.background.bgType === BgType.Online }"
          @click="onlineImageWarn"
        >
          {{ t('background.type.online') }}
        </el-button>
      </el-space>
      <div v-if="settings.background.bgType === BgType.None" class="bg-switcher-colors">
        <el-space direction="vertical">
          <div v-for="group in groups" :key="group" class="bg-switcher-color-control">
            <span>{{ label(group) }}:</span>
            <el-color-picker
              :model-value="
                settings.background.solid[group] || (group === 'light' ? '#f2f3f5' : '#0a0a0a')
              "
              color-format="hex"
              :aria-label="label(group)"
              @change="(value) => (settings.background.solid[group] = value || '')"
            />
            <el-button
              text
              size="small"
              @click="settings.background.solid[group] = ''"
              style="font-size: 0.85em"
            >
              {{ label('reset') }}
            </el-button>
          </div>
        </el-space>
      </div>
      <div
        v-else-if="settings.background.bgType === BgType.Local"
        class="bg-switcher-local"
        @dragover.prevent
        @drop.prevent="dropFiles"
      >
        <input
          ref="filesInput"
          class="bg-switcher-file"
          type="file"
          accept="image/*,video/*"
          multiple
          @change="onFiles"
        />
        <div class="bg-switcher-toolbar">
          <el-radio-group v-model="variant" :aria-label="label('group')">
            <el-radio-button v-for="group in groups" :key="group" :value="group">
              {{ label(group) }} · {{ local.library[group].items.length }}
            </el-radio-button>
          </el-radio-group>
          <el-button v-if="items.length" text @click="toggleManaging">
            {{ label(managing ? 'done' : 'manage') }}
          </el-button>
        </div>
        <DragDropProvider @dragend="dragEnd">
          <div ref="grid" class="bg-switcher-grid" :style="{ '--wallpaper-columns': columns }">
            <WallpaperSortableItem
              v-for="(item, index) in visibleItems"
              :id="item.id"
              :key="`${variant}:${item.id}`"
              :index="index"
              :disabled="!managing"
              :label="label('sortHint')"
            >
              <button
                class="bg-switcher-tile"
                :class="{
                  selected: managing
                    ? selected.includes(item.id)
                    : local.displayed?.item.id === item.id && local.displayed?.variant === variant,
                }"
                :aria-label="`${label(item.mediaType)} · ${metadata(item)}`"
                :aria-pressed="
                  managing
                    ? selected.includes(item.id)
                    : local.displayed?.item.id === item.id && local.displayed?.variant === variant
                "
                @click="clickItem(item)"
              >
                <img
                  v-if="thumbnails[`${variant}:${item.id}`]"
                  :src="thumbnails[`${variant}:${item.id}`]"
                  alt=""
                  loading="lazy"
                  draggable="false"
                />
                <span v-else class="bg-switcher-placeholder">{{ label(item.mediaType) }}</span>
                <span v-if="item.mediaType === 'video'" class="bg-switcher-video">▶</span>
                <span
                  v-if="
                    managing
                      ? selected.includes(item.id)
                      : local.displayed?.item.id === item.id && local.displayed?.variant === variant
                  "
                  class="bg-switcher-check"
                >
                  ✓
                </span>
              </button>
              <div class="bg-switcher-meta">{{ metadata(item) }}</div>
            </WallpaperSortableItem>
            <button class="bg-switcher-add" :disabled="busy" @click="filesInput?.click()">
              <span>＋</span>{{ label('add') }}
            </button>
          </div>
        </DragDropProvider>
        <p v-if="!items.length" class="bg-switcher-hint">
          {{ label(variant === 'dark' ? 'inherit' : 'empty') }}
        </p>
        <div class="bg-switcher-toolbar">
          <span class="bg-switcher-meta" style="margin-top: 0">
            {{ label(managing ? 'sortHint' : 'dragAddHint') }}
          </span>
          <el-space>
            <el-button
              v-if="items.length > columns * 2 - 1 && !managing"
              text
              @click="expanded = !expanded"
            >
              {{ label(expanded ? 'collapse' : 'expand') }}
            </el-button>
            <template v-if="managing">
              <el-button text @click="clearPreviews">{{ label('clearPreviews') }}</el-button>
              <el-button type="danger" text :disabled="!selected.length" @click="removeSelected">
                {{ label('remove') }} ({{ selected.length }})
              </el-button>
            </template>
          </el-space>
        </div>
        <div
          v-if="Math.max(local.library.light.items.length, local.library.dark.items.length) > 1"
          class="bg-switcher-rotation"
        >
          <div class="bg-switcher-rotation-control">
            {{ label('rotation') }}
            <el-switch
              v-model="settings.background.rotation.enabled"
              :aria-label="label('rotation')"
              @change="settings.save"
            />
          </div>
          <el-radio-group
            v-if="settings.background.rotation.enabled"
            v-model="settings.background.rotation.order"
            @change="settings.save"
            :aria-label="label('order')"
          >
            <el-radio value="random">{{ label('random') }}</el-radio>
            <el-radio value="ordered">{{ label('ordered') }}</el-radio>
          </el-radio-group>
        </div>
      </div>
      <div v-else-if="settings.background.bgType === BgType.Online" class="bg-switcher-online">
        <el-input
          v-model="tempOnlineUrl"
          placeholder="https://example.com/image.jpg"
          @blur="changeOnlineBg"
          @keydown.enter="changeOnlineBg"
        >
          <template #prepend>URL</template>
        </el-input>
        <ul class="bg-switcher-hint">
          <li>{{ t('background.onlineTips.a') }}</li>
          <li v-if="!settings.background.online.cache.enabled">
            {{ t('background.onlineTips.b') }}
          </li>
          <li>{{ t('background.onlineTips.c') }}</li>
        </ul>
      </div>
    </section>
  </base-dialog>
</template>
