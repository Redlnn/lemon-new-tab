<script setup lang="ts">
import { Plus } from '@vicons/fa'
import type { FormInstance, UploadRequestOptions } from 'element-plus'
import { useTranslation } from 'i18next-vue'

import { useFaviconUpload } from '@newtab/components/Shortcut/composables/useFaviconUpload'
import {
  saveCustomSearchEngine,
  useCustomSearchEngineStore
} from '@newtab/shared/customSearchEngine'

const { t } = useTranslation()

const customSearchEngineStore = useCustomSearchEngineStore()
const modelForm = ref<FormInstance>()

const showDialog = ref(false)
const editingIndex = ref<number | null>(null)
const data: {
  name: string
  url: string
  icon?: string
} = reactive({
  name: '',
  url: '',
  icon: undefined
})

const { beforeFaviconUpload, httpRequest } = useFaviconUpload({ maxKB: 100 })

const isEditing = computed(() => editingIndex.value !== null)
const dialogTitle = computed(() =>
  t(isEditing.value ? 'customSearchEngine.edit' : 'customSearchEngine.add')
)
const confirmLabel = computed(() => t(isEditing.value ? 'common.save' : 'common.confirm'))

function resetFields() {
  modelForm.value?.resetFields()
  Object.assign(data, { name: '', url: '', icon: '' })
  editingIndex.value = null
}

function openAddDialog() {
  resetFields()
  showDialog.value = true
}

function openEditDialog(index: number) {
  const target = customSearchEngineStore.items[index]
  if (!target) return
  modelForm.value?.resetFields()
  editingIndex.value = index
  Object.assign(data, {
    name: target.name,
    url: target.url,
    icon: target.icon ?? ''
  })
  showDialog.value = true
}

function validateUrl(url: string): boolean {
  try {
    new URL(url)
    return url.includes('%s')
  } catch {
    return false
  }
}

async function submit() {
  if (!data.name.trim()) {
    ElMessage.error(t('customSearchEngine.addDialog.nameRequiredError'))
    return
  }

  if (!validateUrl(data.url)) {
    ElMessage.error(t('customSearchEngine.addDialog.invalidUrlError'))
    return
  }

  const engine = {
    id: isEditing.value
      ? customSearchEngineStore.items[editingIndex.value!]!.id
      : crypto.randomUUID(),
    name: data.name.trim(),
    url: data.url.trim(),
    icon: data.icon || undefined
  }

  if (isEditing.value && editingIndex.value !== null) {
    customSearchEngineStore.items.splice(editingIndex.value, 1, engine)
  } else {
    customSearchEngineStore.items.push(engine)
  }

  await saveCustomSearchEngine(customSearchEngineStore.$state)
  showDialog.value = false
  resetFields()
}

async function cancel() {
  showDialog.value = false
  resetFields()
}

defineExpose({
  openAddDialog,
  openEditDialog
})
</script>

<template>
  <el-dialog
    v-model="showDialog"
    :title="dialogTitle"
    class="add-custom-search-engine-dialog base-dialog--blur base-dialog--opacity noselect"
    width="450"
    append-to-body
    destroy-on-close
  >
    <el-form ref="modelForm" :model="data">
      <el-form-item :label="t('common.name')" label-position="top">
        <el-input v-model="data.name" size="large" />
      </el-form-item>
      <el-form-item :label="t('common.url')" label-position="top">
        <el-input
          v-model="data.url"
          size="large"
          placeholder="https://example.com/?q=%s"
          @keyup.enter="submit"
        />
      </el-form-item>
      <el-form-item :label="t('common.icon')" label-position="top">
        <div class="search-engine-icon-uploader-container">
          <el-upload
            class="search-engine-icon-uploader"
            :show-file-list="false"
            :http-request="
              (option: UploadRequestOptions) => httpRequest(option, (b64) => (data.icon = b64))
            "
            :before-upload="beforeFaviconUpload"
            accept="image/*"
          >
            <img v-if="data.icon" :src="data.icon" class="search-engine-icon-uploader-img" />
            <el-icon v-else class="search-engine-icon-uploader-icon"><plus /></el-icon>
          </el-upload>
          <div>ICO、SVG、PNG、JPG、WebP</div>
        </div>
      </el-form-item>
    </el-form>
    <el-alert
      type="info"
      show-icon
      :closable="false"
      :title="t('customSearchEngine.addDialog.urlHelp')"
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
.add-custom-search-engine-dialog {
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

// 上传图标和图片
.search-engine-icon-uploader {
  &-container {
    display: flex;
    gap: 12px;
    align-items: center;
    font-size: var(--el-font-size-extra-small);
    line-height: 1.4;
    color: var(--el-text-color-secondary);
  }

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

      .search-engine-icon-uploader-icon {
        color: var(--el-color-primary);
      }
    }
  }
}
</style>
