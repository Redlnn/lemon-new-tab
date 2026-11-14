<script setup lang="ts">
import './bg-switcher.scss'
import { useElementSize, useWindowSize } from '@vueuse/core'

import { DragDropProvider, type DragEndEvent } from '@dnd-kit/vue'
import { useTranslation } from 'i18next-vue'
import AddImageIcon from '~icons/ic/outline-add-photo-alternate'
import PaletteIcon from '~icons/ic/outline-palette'
import ImageIcon from '~icons/ic/outline-photo'
import PublicIcon from '~icons/ic/outline-public'
import AutoAwesome from '~icons/ic/round-auto-awesome'
import DownloadRound from '~icons/ic/round-download'
import LaunchRound from '~icons/ic/round-launch'
import MotionIcon from '~icons/ic/round-motion-photos-on'

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

import { useImeAwareDialog } from '@newtab/composables/useImeAwareDialog'
import { isDark } from '@newtab/shared/colorMode'
import { bingWallpaperURLGetter, useLocalWallpaperStore } from '@newtab/shared/wallpaper'
import { readWallpaperMetadata } from '@newtab/shared/wallpaper/thumbnail'

import useBackgroundSwitcher from './useBackgroundSwitcher'
import WallpaperSortableItem from './WallpaperSortableItem.vue'

const opened = defineModel<boolean>({ required: true })
const { width: windowWidth } = useWindowSize({ type: 'visual' })
const { isComposing } = useImeAwareDialog()
const { t } = useTranslation('settings')
const settings = useSettingsStore()
const maskEnabled = computed({
  get: () => settings.background.mask.enabled,
  set: (value: boolean) => (settings.background.mask.enabled = value),
})
const maskColors = computed(() => ({
  light: settings.background.mask.light,
  dark: settings.background.mask.night,
}))
function setMaskColor(group: 'light' | 'dark', value: string | null) {
  if (group === 'light') settings.background.mask.light = value ?? '#f2f3f5'
  else settings.background.mask.night = value ?? '#000'
}
const wallpaperBlur = computed({
  get: () => settings.background.blur,
  set: (value: number) => (settings.background.blur = value),
})
const blurDisabled = computed(
  () =>
    settings.background.bgType === BgType.Meadow ||
    settings.background.bgType === BgType.Beach ||
    settings.background.bgType === BgType.None,
)
const local = useLocalWallpaperStore()
const variant = ref<WallpaperVariant>(isDark.value ? 'dark' : 'light')
type Source = 'bing' | 'local' | 'online' | 'solid' | 'dynamic'
const source = ref<Source>('bing')
const sources = [
  { key: 'bing', icon: AutoAwesome, label: 'background.dailyRecommendation' },
  { key: 'local', icon: AddImageIcon, label: 'background.localMedia' },
  { key: 'online', icon: PublicIcon, label: 'background.type.online' },
  { key: 'solid', icon: PaletteIcon, label: 'background.library.solid' },
  { key: 'dynamic', icon: MotionIcon, label: 'background.dynamic' },
] as const
function selectSource(value: Source) {
  source.value = value
  if (value === 'bing') useBing()
  else if (value === 'local') settings.background.bgType = BgType.Local
  else if (value === 'solid') solid()
}
function currentSource(): Source {
  const type = settings.background.bgType
  if (type === BgType.Meadow || type === BgType.Beach) return 'dynamic'
  if (type === BgType.Local) return 'local'
  if (type === BgType.Online) return 'online'
  if (type === BgType.None) return 'solid'
  return 'bing'
}
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
const { tempOnlineUrl, changeOnlineBg } = useBackgroundSwitcher()
const bingSrc = bingWallpaperURLGetter.getBgUrl()
const bingInfo = bingWallpaperURLGetter.getInfo()
const resolutionBusy = ref(false)
const groups = ['light', 'dark'] as const
const label = (key: string) => t(`background.library.${key}`)
const beachControls = [
  { key: 'sigma', min: 40, max: 200 },
  { key: 'warp', min: 0, max: 80 },
  { key: 'shoal', min: 0, max: 300 },
  { key: 'shallow', min: 120, max: 700 },
  { key: 'palms', min: 0, max: 10 },
  { key: 'kayaks', min: 0, max: 4 },
  { key: 'birds', min: 0, max: 8 },
] as const

watch(
  opened,
  async (value) => {
    if (!value) {
      releaseThumbnails()
      return
    }
    source.value = currentSource()
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
}
function open(url: string) {
  if (url) window.open(url, '_blank', 'noopener')
}
</script>

<template>
  <el-drawer
    v-model="opened"
    direction="rtl"
    class="bg-switcher__drawer"
    :size="windowWidth <= 500 ? '100%' : '430px'"
    :close-on-press-escape="!isComposing"
    :title="t('background.preferenceTitle')"
    append-to-body
  >
    <template #header>
      <div class="bg-switcher-header">
        <span class="bg-switcher-header-icon"><ImageIcon aria-hidden="true" /></span>
        <div>
          <h2>{{ t('background.preferenceTitle') }}</h2>
          <p>{{ t('background.drawerSubtitle') }}</p>
        </div>
      </div>
    </template>
    <el-scrollbar>
      <section class="bg-switcher-section">
        <h3>{{ t('background.source') }}</h3>
        <div class="bg-switcher-sources">
          <button
            v-for="item in sources"
            :key="item.key"
            type="button"
            class="bg-switcher-source"
            :class="{ active: source === item.key }"
            :aria-pressed="source === item.key"
            @click="selectSource(item.key)"
          >
            <component :is="item.icon" aria-hidden="true" />
            <span>{{ t(item.label) }}</span>
          </button>
        </div>
      </section>
      <section class="bg-switcher-section">
        <template v-if="source === 'bing'">
          <div class="bg-switcher-today">
            <button
              class="bg-switcher-bing-preview"
              :aria-label="t('background.bingFrom')"
              @click="useBing"
            >
              <el-image :src="bingSrc" fit="cover" />
            </button>
            <div class="bg-switcher-bing-content">
              <strong>{{ bingInfo.title }}</strong>
              <p>{{ bingInfo.copyright }}</p>
            </div>
          </div>
          <div class="bg-switcher-actions">
            <el-button
              text
              bg
              :icon="LaunchRound"
              :aria-label="t('background.bingFrom')"
              @click="open(bingInfo.copyrightlink)"
            />
            <el-button
              text
              bg
              :icon="DownloadRound"
              @click="open(bingWallpaperURLGetter.uhdUrl.value)"
              >{{ label('download') }}</el-button
            >
            <el-select
              :model-value="settings.background.bing.resolution"
              :aria-label="t('background.resolution')"
              :loading="resolutionBusy"
              :disabled="resolutionBusy"
              @change="resolution"
              style="width: 110px"
            >
              <el-option label="1080P" value="1080p" />
              <el-option label="4K (UHD)" value="uhd" />
            </el-select>
            <div
              style="
                display: flex;
                flex: 0 0 auto;
                align-items: center;
                margin-left: auto;
                font-size: 11px;
                font-weight: normal;
                color: var(--el-color-primary-dark-2);
              "
            >
              <el-icon><AutoAwesome /></el-icon>
              &nbsp;
              <span>{{ t('background.bingFrom') }}</span>
            </div>
          </div>
        </template>
        <div
          v-else-if="source === 'local'"
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
                      : local.displayed?.item.id === item.id &&
                        local.displayed?.variant === variant,
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
                        : local.displayed?.item.id === item.id &&
                          local.displayed?.variant === variant
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
        <div v-else-if="source === 'solid'" class="bg-switcher-colors">
          <div class="bg-switcher-color-grid">
            <div v-for="group in groups" :key="group" class="bg-switcher-color-control">
              <div class="bg-switcher-color-heading">
                <strong>{{ label(group) }}</strong>
                <el-button text size="small" @click="settings.background.solid[group] = ''">
                  {{ label('reset') }}
                </el-button>
              </div>
              <div class="bg-switcher-color-value">
                <span class="bg-switcher-color-picker">
                  <el-color-picker
                    :model-value="
                      settings.background.solid[group] ||
                      (group === 'light' ? '#f2f3f5' : '#0a0a0a')
                    "
                    color-format="hex"
                    :aria-label="label(group)"
                    @change="(value) => (settings.background.solid[group] = value || '')"
                  />
                </span>
                <span>{{
                  (
                    settings.background.solid[group] || (group === 'light' ? '#f2f3f5' : '#0a0a0a')
                  ).toUpperCase()
                }}</span>
              </div>
            </div>
          </div>
        </div>
        <template v-if="source === 'dynamic'">
          <div class="bg-switcher-dynamic">
            <button
              v-for="item in [
                { type: BgType.Meadow, name: 'meadow' },
                { type: BgType.Beach, name: 'beach' },
              ]"
              :key="item.name"
              type="button"
              class="bg-switcher-dynamic-card"
              :class="[
                `bg-switcher-dynamic-card--${item.name}`,
                { active: settings.background.bgType === item.type },
              ]"
              :aria-pressed="settings.background.bgType === item.type"
              @click="settings.background.bgType = item.type"
            >
              <span class="bg-switcher-dynamic-name">{{ t(`background.${item.name}.name`) }}</span>
              <span class="bg-switcher-dynamic-art" aria-hidden="true"></span>
              <span class="bg-switcher-dynamic-using" aria-hidden="true">使用中</span>
            </button>
          </div>
          <div v-if="settings.background.bgType === BgType.Meadow" class="bg-switcher-meadow">
            <label>
              <span>{{ t('background.meadow.fps') }}</span>
              <el-select
                v-model="settings.background.meadow.fps"
                :aria-label="t('background.meadow.fps')"
              >
                <el-option
                  v-for="fps in [25, 30, 45, 60, 120]"
                  :key="fps"
                  :label="`${fps} FPS`"
                  :value="fps"
                />
              </el-select>
            </label>
            <label>
              <span>{{ t('background.meadow.cloudSize') }}</span>
              <el-slider v-model="settings.background.meadow.cloudSize" :min="40" :max="200" />
            </label>
            <label>
              <span>{{ t('background.meadow.cloudCover') }}</span>
              <el-slider
                v-model="settings.background.meadow.cloudCover"
                :min="0"
                :max="1"
                :step="0.05"
              />
            </label>
            <label>
              <span>{{ t('background.meadow.flow') }}</span>
              <el-slider v-model="settings.background.meadow.flow" :min="0" :max="3" :step="0.1" />
            </label>
            <label
              ><span>{{ t('background.meadow.showNavigationCloud') }}</span
              ><el-switch v-model="settings.background.meadow.showNavigationCloud"
            /></label>
            <label
              ><span>{{ t('background.meadow.showBoy') }}</span
              ><el-switch v-model="settings.background.meadow.showBoy"
            /></label>
            <label
              ><span>{{ t('background.meadow.clickToMove') }}</span
              ><el-switch
                v-model="settings.background.meadow.clickToMove"
                :disabled="!settings.background.meadow.showBoy"
            /></label>
            <label
              ><span>{{ t('background.meadow.showCat') }}</span
              ><el-switch v-model="settings.background.meadow.showCat"
            /></label>
          </div>
          <div v-if="settings.background.bgType === BgType.Beach" class="bg-switcher-meadow">
            <label
              ><span>{{ t('background.meadow.fps') }}</span
              ><el-select
                v-model="settings.background.beach.fps"
                :aria-label="t('background.meadow.fps')"
                ><el-option
                  v-for="fps in [25, 30, 45, 60, 120]"
                  :key="fps"
                  :label="`${fps} FPS`"
                  :value="fps" /></el-select
            ></label>
            <label v-for="control in beachControls" :key="control.key">
              <span>{{ t(`background.beach.${control.key}`) }}</span>
              <el-slider
                v-model="settings.background.beach[control.key]"
                :min="control.min"
                :max="control.max"
                :aria-label="t(`background.beach.${control.key}`)"
              />
            </label>
          </div>
        </template>
        <div v-if="source === 'online'" class="bg-switcher-online">
          <div class="bg-switcher-online-input">
            <el-input
              v-model="tempOnlineUrl"
              placeholder="https://example.com/image.jpg"
              @keydown.enter.prevent="changeOnlineBg"
            >
              <template #prepend>URL</template>
            </el-input>
            <el-button type="primary" @click="changeOnlineBg">{{
              t('background.apply')
            }}</el-button>
          </div>
          <ul class="bg-switcher-hint">
            <li>{{ t('background.onlineTips.a') }}</li>
            <li v-if="!settings.background.online.cache.enabled">
              {{ t('background.onlineTips.b') }}
            </li>
            <li>{{ t('background.onlineTips.c') }}</li>
          </ul>
        </div>
      </section>
      <section class="bg-switcher-section bg-switcher-display">
        <h3>{{ t('common.sections.appearance') }}</h3>
        <label class="bg-switcher-display-row">
          <span>{{ t('background.blur') }}</span>
          <el-slider
            v-model="wallpaperBlur"
            :aria-label="t('background.blur')"
            :disabled="blurDisabled"
          />
        </label>
        <label class="bg-switcher-display-row">
          <span>{{ t('background.mask.enable') }}</span>
          <el-switch v-model="maskEnabled" :aria-label="t('background.mask.enable')" />
        </label>
        <label class="bg-switcher-display-row bg-switcher-mask-colors">
          <span>{{ t('background.mask.color') }}</span>
          <div class="bg-switcher-mask-options">
            <label v-for="group in groups" :key="group">
              <span>{{ label(group) }}</span>
              <el-color-picker
                :model-value="maskColors[group]"
                :predefine="['#f2f3f5', '#000']"
                :aria-label="`${t('background.mask.color')} · ${label(group)}`"
                show-alpha
                @change="(value) => setMaskColor(group, value)"
              />
            </label>
          </div>
        </label>
      </section>
    </el-scrollbar>

    <template #footer>
      <el-button type="primary" @click="opened = false">{{ label('done') }}</el-button>
    </template>
  </el-drawer>
</template>
