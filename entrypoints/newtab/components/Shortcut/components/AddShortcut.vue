<script setup lang="ts">
import { Plus } from '@vicons/fa'
import { AddRound } from '@vicons/material'
import type { FormInstance, UploadRequestOptions } from 'element-plus'
import { useTranslation } from 'i18next-vue'

import { useSettingsStore } from '@/shared/settings'
import { saveShortcut, useShortcutStore } from '@/shared/shortcut'

import usePerfClasses from '@newtab/composables/usePerfClasses'

import { useFaviconUpload } from '../composables/useFaviconUpload'

const { t } = useTranslation()

const settings = useSettingsStore()
const shortcutStore = useShortcutStore()
const modelForm = ref<FormInstance>()

const props = withDefaults(
  defineProps<{
    reload: () => Promise<void>
    showButton?: boolean
    tabindex?: boolean
  }>(),
  {
    showButton: true,
    tabindex: true
  }
)
const showDialog = ref(false)
const editingIndex = ref<number | null>(null)
const data: {
  url: string
  title: string
  favicon?: string
} = reactive({
  url: '',
  title: '',
  favicon: ''
})

const { beforeFaviconUpload, httpRequest } = useFaviconUpload({ maxKB: 100 })

const isEditing = computed(() => editingIndex.value !== null)
const dialogTitle = computed(() =>
  t(isEditing.value ? 'shortcut.editShortcut' : 'shortcut.addShortcut')
)
const confirmLabel = computed(() => t(isEditing.value ? 'common.save' : 'common.confirm'))

function resetFields() {
  modelForm.value?.resetFields()
  Object.assign(data, { url: '', title: '', favicon: '' })
  editingIndex.value = null
}

function openAddDialog() {
  resetFields()
  showDialog.value = true
}

function openEditDialog(index: number) {
  const target = shortcutStore.items[index]
  if (!target) return
  modelForm.value?.resetFields()
  editingIndex.value = index
  Object.assign(data, {
    url: target.url,
    title: target.title,
    favicon: target.favicon ?? ''
  })
  showDialog.value = true
}

function isValidUrl(url: string) {
  try {
    const urlToCheck = url.includes('://') ? url : `http://${url}`
    new URL(urlToCheck)
    return true
  } catch {
    return false
  }
}

async function submit() {
  if (!isValidUrl(data.url)) {
    ElMessage.error(t('shortcut.addDialog.invalidUrlError'))
    return
  }

  // 如果没有协议,自动添加https://
  let finalUrl = data.url.trim()
  if (!finalUrl.includes('://')) {
    finalUrl = `https://${finalUrl}`
  }

  const shortcut = {
    url: finalUrl,
    title: data.title.trim(),
    ...(!data.favicon ? {} : { favicon: data.favicon })
  }
  if (isEditing.value && editingIndex.value !== null) {
    shortcutStore.items.splice(editingIndex.value, 1, shortcut)
  } else {
    shortcutStore.items.push(shortcut)
  }
  await saveShortcut(shortcutStore.$state)
  await props.reload()
  showDialog.value = false
  resetFields()
}

async function cancel() {
  showDialog.value = false
  resetFields()
}

defineExpose({
  openEditDialog
})

const perf = usePerfClasses(() => ({
  transparentOff: settings.perf.disableShortcutTransparent,
  blurOff: settings.perf.disableShortcutBlur
}))

const iconPerfClass = perf('shortcut__icon')
</script>

<template>
  <div
    v-if="props.showButton"
    role="button"
    :tabindex="tabindex ? '0' : '-1'"
    class="shortcut__item shortcut__item--add-shortcut noselect"
  >
    <div
      class="shortcut__item-link"
      style="cursor: pointer"
      @click="openAddDialog"
      @keydown.enter="openAddDialog"
    >
      <div
        class="shortcut__icon-container"
        :style="{ marginBottom: `${settings.shortcut.iconMarginBottom}px` }"
      >
        <div class="shortcut__icon" :class="iconPerfClass">
          <add-round />
        </div>
      </div>
      <el-text
        v-if="settings.shortcut.showShortcutTitle"
        class="shortcut__title"
        :style="{ width: `calc(var(--icon_size) + ${settings.shortcut.titleExtraWidth}px)` }"
        truncated
      >
        {{ t('shortcut.addShortcut') }}
      </el-text>
    </div>
  </div>
  <el-dialog
    v-model="showDialog"
    :title="dialogTitle"
    class="add-shortcut-dialog base-dialog--blur base-dialog--opacity noselect"
    width="450"
    append-to-body
    destroy-on-close
  >
    <el-form ref="modelForm" :model="data">
      <el-form-item :label="t('common.name')" label-position="top">
        <el-input v-model="data.title" size="large" />
      </el-form-item>
      <el-form-item :label="t('common.url')" label-position="top">
        <el-input v-model="data.url" size="large" @keyup.enter="submit" />
      </el-form-item>
      <el-form-item :label="t('common.icon')" label-position="top">
        <div class="shortcut__favicon-uploader-container">
          <el-upload
            class="shortcut__favicon-uploader"
            :show-file-list="false"
            :http-request="
              (option: UploadRequestOptions) => httpRequest(option, (b64) => (data.favicon = b64))
            "
            :before-upload="beforeFaviconUpload"
            accept="image/*"
          >
            <img v-if="data.favicon" :src="data.favicon" class="shortcut__favicon-uploader-img" />
            <el-icon v-else class="shortcut__favicon-uploader-icon"><plus /></el-icon>
          </el-upload>
          <div>
            {{ t('shortcut.addDialog.uploadFaviconAlert') }}<br />
            ICO、SVG、PNG、JPG、WebP
          </div>
        </div>
      </el-form-item>
    </el-form>
    <el-alert
      show-icon
      :closable="false"
      :title="t('shortcut.addDialog.extensionIconTip')"
      style="margin-top: 10px"
    />
    <template #footer>
      <span class="dialog-footer">
        <el-button round size="large" @click="cancel">{{ t('common.no') }}</el-button>
        <el-button type="primary" round size="large" @click="submit">{{ confirmLabel }}</el-button>
      </span>
    </template>
  </el-dialog>
</template>

<style lang="scss">
.add-shortcut-dialog {
  max-width: 93%;
  padding: 30px;

  --el-dialog-padding-primary: 25px;

  html.colorful:not(.dialog-transparent) & {
    background-color: var(--el-color-primary-light-9);
  }

  .el-form-item--label-top .el-form-item__label {
    margin-bottom: 6px;
    line-height: 1;
  }

  .el-form-item {
    --el-form-label-font-size: var(--el-font-size-small);
  }

  .el-input {
    --el-input-border-radius: 12px;
  }

  .el-alert--info {
    --el-alert-bg-color: transparent;
    --el-alert-title-font-size: var(--el-font-size-extra-small);
    --el-alert-padding: 0;

    .el-alert__title {
      line-height: 1.4;
    }
  }
}

.shortcut__item--add-shortcut .shortcut__item-link {
  .shortcut__title,
  .shortcut__icon {
    color: var(--le-text-color-primary-opacity-65);
  }

  .shortcut__icon {
    svg {
      width: 70%;
    }
  }

  &:hover {
    .shortcut__title,
    .shortcut__icon {
      color: var(--el-text-color-primary);
    }
  }

  .shortcut__container--item-shadow &:not(:hover) .shortcut__title {
    text-shadow: 1px 1px 4px rgb(0 0 0 / 50%);
  }

  // 白色文本容器特化
  html.light .shortcut__container--white-text-light & {
    .shortcut__title,
    .shortcut__icon {
      color: rgb(255 255 255 / 70%);

      &:not(.shortcut__icon--opacity) {
        svg {
          color: var(--le-text-color-primary-opacity-65);
        }
      }
    }

    &:hover {
      .shortcut__title,
      .shortcut__icon {
        color: var(--el-color-white);

        &:not(.shortcut__icon--opacity) {
          svg {
            color: var(--el-text-color-regular);
          }
        }
      }
    }
  }
}

.shortcut__favicon-uploader {
  &-container {
    display: flex;
    gap: 12px;
    align-items: center;
    font-size: var(--el-font-size-extra-small);
    line-height: 1.4;
    color: var(--el-text-color-secondary);
  }

  // 上传图标和图片
  &-img,
  &-icon {
    width: 50px;
    height: 50px;
  }

  &-img {
    object-fit: cover;
  }

  &-icon {
    font-size: 20px;
    color: var(--el-text-color-placeholder);
    text-align: center;
    transition: var(--el-transition-duration-fast);
  }

  & .el-upload {
    position: relative;
    overflow: hidden;
    cursor: pointer;
    background-color: var(--el-fill-color-blank);
    border: 1px dashed var(--el-border-color);
    border-radius: 12px;
    transition: var(--el-transition-duration-fast);

    &:hover,
    &:focus-visible {
      border-color: var(--el-color-primary);

      .shortcut__favicon-uploader-icon {
        color: var(--el-color-primary);
      }
    }
  }
}
</style>
