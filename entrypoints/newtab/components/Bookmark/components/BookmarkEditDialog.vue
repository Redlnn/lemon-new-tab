<script setup lang="ts">
import type { FormInstance } from 'element-plus'
import { useTranslation } from 'i18next-vue'

import { browser, type Browser } from 'wxt/browser'

import { formatUrl, isValidUrl } from '@newtab/shared/utils'

type BookmarkTreeNode = Browser.bookmarks.BookmarkTreeNode

const { t } = useTranslation()

const modelForm = ref<FormInstance>()

const showDialog = ref(false)
const data: {
  url: string
  title: string
  id: string
  isFolder: boolean
} = reactive({
  url: '',
  title: '',
  id: '',
  isFolder: false,
})

function resetFields() {
  modelForm.value?.resetFields()
  Object.assign(data, { url: '', title: '' })
}

function openEditDialog(node: BookmarkTreeNode) {
  modelForm.value?.resetFields()
  Object.assign(data, {
    url: node.url,
    title: node.title,
    id: node.id,
    isFolder: !!node.children,
  })
  showDialog.value = true
}

async function submit() {
  if (data.isFolder) {
    await browser.bookmarks.update(data.id, { title: data.title.trim() })
  } else {
    if (!isValidUrl(data.url)) {
      ElMessage.error(t('quickLinks.addDialog.invalidUrlError'))
      return
    }

    const bookmark = {
      url: formatUrl(data.url),
      title: data.title.trim(),
    }
    await browser.bookmarks.update(data.id, bookmark)
  }
  showDialog.value = false
  resetFields()
}

async function cancel() {
  showDialog.value = false
  resetFields()
}

defineExpose({
  openEditDialog,
})
</script>

<template>
  <el-dialog
    v-model="showDialog"
    :title="t('common.edit')"
    class="link-form-dialog base-dialog--blur base-dialog--opacity noselect"
    width="450"
    append-to-body
    destroy-on-close
  >
    <el-form ref="modelForm" :model="data">
      <el-form-item :label="t('common.name')" label-position="top">
        <el-input v-model="data.title" size="large" />
      </el-form-item>
      <el-form-item v-if="!data.isFolder" :label="t('common.url')" label-position="top">
        <el-input v-model="data.url" size="large" @keyup.enter="submit" />
      </el-form-item>
    </el-form>
    <template #footer>
      <span class="dialog-footer">
        <el-button round size="large" @click="cancel">{{ t('common.no') }}</el-button>
        <el-button type="primary" round size="large" @click="submit">
          {{ t('common.save') }}
        </el-button>
      </span>
    </template>
  </el-dialog>
</template>
