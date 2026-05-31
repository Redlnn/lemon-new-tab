<script setup lang="ts">
import type { FormInstance, UploadRequestOptions } from 'element-plus'
import { useTranslation } from 'i18next-vue'
import Plus from '~icons/fa6-solid/plus'

import { fetchFaviconWithCache } from '@/shared/media'
import { useSettingsStore } from '@/shared/settings'
import {
  DEFAULT_SHORTCUT_GROUP_ID,
  useShortcutStore,
  type Shortcut,
  type ShortcutTarget,
} from '@/shared/shortcut'

import { formatUrl, isValidUrl } from '@newtab/shared/utils'

import { useFaviconUpload } from '../composables/useFaviconUpload'

const { t } = useTranslation()

const shortcutStore = useShortcutStore()
const settings = useSettingsStore()
const modelForm = ref<FormInstance>()

const showDialog = ref(false)
const editingTarget = ref<ShortcutTarget | null>(null)
const addingGroupId = ref<string | null>(null)
const data: Shortcut = reactive({
  url: '',
  title: '',
  favicon: '',
})

const { beforeFaviconUpload, httpRequest } = useFaviconUpload()

const isEditing = computed(() => editingTarget.value !== null)
const dialogTitle = computed(() =>
  t(isEditing.value ? 'shortcut.editShortcut' : 'shortcut.addShortcut'),
)
const confirmLabel = computed(() => t(isEditing.value ? 'common.save' : 'common.confirm'))

function resetFields() {
  modelForm.value?.resetFields()
  Object.assign(data, { url: '', title: '', favicon: '' })
  editingTarget.value = null
  addingGroupId.value = null
}

function openAddDialog(groupId?: string) {
  resetFields()
  addingGroupId.value = groupId ?? null
  showDialog.value = true
}

function openEditDialog(targetRef: ShortcutTarget) {
  const target = shortcutStore.getShortcut(targetRef)
  if (!target) return
  modelForm.value?.resetFields()
  editingTarget.value = targetRef
  Object.assign(data, {
    url: target.url,
    title: target.title,
    favicon: target.favicon ?? '',
  })
  showDialog.value = true
}

async function submit() {
  if (!isValidUrl(data.url)) {
    ElMessage.error(t('shortcut.addDialog.invalidUrlError'))
    return
  }

  const shortcut = {
    url: formatUrl(data.url),
    title: data.title.trim(),
    ...(!data.favicon ? {} : { favicon: data.favicon }),
  }

  if (isEditing.value && editingTarget.value !== null) {
    if (typeof editingTarget.value === 'number') {
      shortcutStore.items.splice(editingTarget.value, 1, shortcut)
      await shortcutStore.save()
    } else {
      await shortcutStore.updateShortcutInGroup(
        editingTarget.value.groupId,
        editingTarget.value.index,
        shortcut,
      )
    }
  } else if (addingGroupId.value) {
    await shortcutStore.addShortcutToGroup(addingGroupId.value, shortcut)
  } else if (settings.shortcut.grouping) {
    await shortcutStore.addShortcutToGroup(DEFAULT_SHORTCUT_GROUP_ID, shortcut)
  } else {
    shortcutStore.items.push(shortcut)
    await shortcutStore.save()
  }

  showDialog.value = false
  resetFields()

  if (!shortcut.favicon) {
    ElNotification({
      title: t('shortcut.fetchingFavicon'),
      message: shortcut.url,
      type: 'info',
    })
    fetchFaviconWithCache(shortcut.url)
  }
}

async function cancel() {
  showDialog.value = false
  resetFields()
}

defineExpose({ openAddDialog, openEditDialog })
</script>

<template>
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
