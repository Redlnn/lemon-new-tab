<script setup lang="ts">
import '@newtab/styles/github-markdown.css'
import { useTranslation } from 'i18next-vue'

import { version } from '@/package.json'

import { isChinese } from '@/shared/i18n'
import { useSettingsStore } from '@/shared/settings'

import BaseDialog from '@newtab/components/BaseDialog.vue'
import { useDialog } from '@newtab/composables/useDialog'

const { t } = useTranslation()
const settings = useSettingsStore()

const { opened, show, hide, toggle } = useDialog()
defineExpose({ show, hide, toggle })

const ChangelogZh = defineAsyncComponent(() => import('@/docs/CHANGELOG.md'))
const ChangelogEn = defineAsyncComponent(() => import('@/docs/CHANGELOG_en.md'))

function handleClose() {
  settings.pluginVersion = version
  settings.readChangeLog = true
}
</script>

<template>
  <base-dialog
    v-model="opened"
    :title="t('changelog.title')"
    container-class="changelog__dialog"
    @closed="handleClose"
  >
    <div class="changelog-wrapper">
      <div class="changelog-hide-major noselect">
        <span>{{ t('changelog.hideMajor') }}</span>
        <el-switch v-model="settings.hideMajorChangelog" />
      </div>
      <component :is="isChinese ? ChangelogZh : ChangelogEn" />
      <div class="markdown-body" style="padding-top: 21px">
        <h2>{{ t('changelog.otherVersions.title') }}</h2>
        <blockquote>
          <p>{{ t('changelog.otherVersions.description') }}</p>
          <ul>
            <li>
              <a href="https://github.com/Redlnn/lemon-new-tab/blob/master/docs/CHANGELOG.md">
                {{ t('changelog.otherVersions.linkZhCN') }}
              </a>
            </li>
            <li>
              <a href="https://github.com/Redlnn/lemon-new-tab/blob/master/docs/CHANGELOG_en.md">
                {{ t('changelog.otherVersions.linkEn') }}
              </a>
            </li>
          </ul>
        </blockquote>
      </div>
    </div>
  </base-dialog>
</template>

<style lang="scss" scoped>
.changelog-wrapper {
  position: relative;
}

.changelog-hide-major {
  position: absolute;
  top: -32px;
  right: 5px;
  display: flex;
  align-items: center;

  span {
    margin-right: 5px;
    font-size: 12px;
    color: var(--el-text-color-regular);
  }

  .el-switch {
    transform: scale(0.95);
  }
}
</style>
