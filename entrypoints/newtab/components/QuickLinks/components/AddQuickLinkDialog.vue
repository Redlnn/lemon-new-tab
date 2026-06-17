<script setup lang="ts">
import type { FormInstance, UploadRequestOptions } from 'element-plus'
import { useTranslation } from 'i18next-vue'
import Plus from '~icons/fa6-solid/plus'

import { fetchFaviconWithCache } from '@/shared/media'
import {
  DEFAULT_QUICK_LINK_GROUP_ID,
  useQuickLinksStore,
  type QuickLink,
  type QuickLinkTarget,
} from '@/shared/quickLinks'
import { useSettingsStore } from '@/shared/settings'

import { useFaviconUpload } from '@newtab/composables/useFaviconUpload'
import { useImeAwareDialog } from '@newtab/composables/useImeAwareDialog'
import { formatUrl, isValidUrl } from '@newtab/shared/utils'

const { t } = useTranslation()
const { isComposing } = useImeAwareDialog()

const quickLinksStore = useQuickLinksStore()
const settings = useSettingsStore()
const modelForm = ref<FormInstance>()

const emit = defineEmits<{
  saved: []
}>()

const showDialog = ref(false)
const editingTarget = ref<QuickLinkTarget | null>(null)
const addingGroupId = ref<string | null>(null)
const data: QuickLink = reactive({
  url: '',
  title: '',
  favicon: '',
})

const { beforeFaviconUpload, httpRequest } = useFaviconUpload()

const isEditing = computed(() => editingTarget.value !== null)
const dialogTitle = computed(() =>
  t(isEditing.value ? 'quickLinks.editLink' : 'quickLinks.addLink'),
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

function openEditDialog(targetRef: QuickLinkTarget) {
  const target = quickLinksStore.getQuickLink(targetRef)
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
    ElMessage.error(t('quickLinks.addDialog.invalidUrlError'))
    return
  }

  const quickLink = {
    url: formatUrl(data.url),
    title: data.title.trim(),
    ...(!data.favicon ? {} : { favicon: data.favicon }),
  }

  if (isEditing.value && editingTarget.value !== null) {
    if (typeof editingTarget.value === 'number') {
      quickLinksStore.items.splice(editingTarget.value, 1, quickLink)
      await quickLinksStore.save()
    } else {
      await quickLinksStore.updateQuickLinkInGroup(
        editingTarget.value.groupId,
        editingTarget.value.index,
        quickLink,
      )
    }
  } else if (settings.quickLinks.grouping && addingGroupId.value) {
    await quickLinksStore.addQuickLinkToGroup(addingGroupId.value, quickLink)
  } else if (settings.quickLinks.grouping) {
    await quickLinksStore.addQuickLinkToGroup(DEFAULT_QUICK_LINK_GROUP_ID, quickLink)
  } else {
    quickLinksStore.items.push(quickLink)
    await quickLinksStore.save()
  }

  showDialog.value = false
  resetFields()
  emit('saved')

  if (!quickLink.favicon) {
    ElNotification({
      title: t('quickLinks.fetchingFavicon'),
      message: quickLink.url,
      type: 'info',
    })
    fetchFaviconWithCache(quickLink.url)
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
    class="link-form-dialog base-dialog--blur base-dialog--opacity noselect"
    width="450"
    append-to-body
    destroy-on-close
    :close-on-press-escape="!isComposing"
  >
    <el-form ref="modelForm" :model="data">
      <el-form-item :label="t('common.name')" label-position="top">
        <el-input v-model="data.title" size="large" />
      </el-form-item>
      <el-form-item :label="t('common.url')" label-position="top">
        <el-input v-model="data.url" size="large" @keyup.enter="submit" />
      </el-form-item>
      <el-form-item :label="t('common.icon')" label-position="top">
        <div class="quick-links__favicon-uploader-container">
          <el-upload
            class="quick-links__favicon-uploader"
            :show-file-list="false"
            :http-request="
              (option: UploadRequestOptions) => httpRequest(option, (b64) => (data.favicon = b64))
            "
            :before-upload="beforeFaviconUpload"
            accept="image/*"
          >
            <img
              v-if="data.favicon"
              :src="data.favicon"
              class="quick-links__favicon-uploader-img"
            />
            <el-icon v-else class="quick-links__favicon-uploader-icon"><plus /></el-icon>
          </el-upload>
          <div>
            {{ t('quickLinks.addDialog.uploadFaviconAlert') }}<br />
            ICO、SVG、PNG、JPG、WebP
          </div>
        </div>
      </el-form-item>
    </el-form>
    <el-alert
      show-icon
      :closable="false"
      :title="t('quickLinks.addDialog.extensionIconTip')"
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
.link-form-dialog {
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

.quick-links__favicon-uploader {
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

      .quick-links__favicon-uploader-icon {
        color: var(--el-color-primary);
      }
    }
  }
}
</style>
