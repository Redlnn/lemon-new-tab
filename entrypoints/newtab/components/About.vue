<script setup lang="ts">
import { useDateFormat, useNow } from '@vueuse/core'

import { useTranslation } from 'i18next-vue'
import Chrome from '~icons/fa6-brands/chrome'
import Edge from '~icons/fa6-brands/edge'
import Firefox from '~icons/fa6-brands/firefox-browser'
import Github from '~icons/fa6-brands/github'

import { browser } from 'wxt/browser'

import { version } from '@/package.json'

import { useSettingsStore } from '@/shared/settings'

import BiliBili from '@newtab/assets/bili.svg?component'
import BaseDialog from '@newtab/components/BaseDialog.vue'
import { useDialog } from '@newtab/composables/useDialog'
import { isProviderKey, yiyanProviders } from '@newtab/shared/yiyan'

const { t } = useTranslation()

const year = useDateFormat(useNow(), 'YYYY')

const { opened, show, hide, toggle } = useDialog()
defineExpose({ show, hide, toggle })

const settings = useSettingsStore()

const currentYiyanProvider = computed(() => {
  if (isProviderKey(settings.yiyan.provider)) {
    return yiyanProviders[settings.yiyan.provider]
  } else {
    return null
  }
})
</script>

<template>
  <base-dialog v-model="opened" container-class="about__dialog noselect">
    <section>
      <div class="ext-icon">
        <a href="https://lemon.redlnn.top" target="_blank">
          <div class="ext-icon__container"></div>
        </a>
      </div>
      <h1 class="ext-name">{{ browser.i18n.getMessage('extension_name') }}</h1>
      <div class="ext-version">{{ version }}</div>
      <div v-if="currentYiyanProvider" class="yiyan-links">
        <i18next :translation="t('newtab:about.yiyanProvider')">
          <template #api>
            <el-link
              underline="never"
              target="_blank"
              type="primary"
              :href="currentYiyanProvider.website"
            >
              {{ t(currentYiyanProvider.nameKey) }}
            </el-link>
          </template>
        </i18next>
      </div>
      <div class="copyright">
        ©&nbsp;{{ year }}&nbsp;
        <el-link underline="never" href="https://redlnn.top"> Red_lnn </el-link>
      </div>
      <el-space class="ext-links" :size="12">
        <el-link
          :underline="'never'"
          target="_blank"
          href="https://chromewebstore.google.com/detail/bhbpmpflnpnkjanfgbjjhldccbckjohb"
        >
          <el-icon :size="20"><Chrome /></el-icon>
        </el-link>
        <el-link
          :underline="'never'"
          target="_blank"
          href="https://microsoftedge.microsoft.com/addons/detail/keikkgfgidagjlicckkangkfgnbdjdnh"
        >
          <el-icon :size="20"><Edge /></el-icon>
        </el-link>
        <el-link
          :underline="'never'"
          target="_blank"
          href="https://addons.mozilla.org/firefox/addon/lemon-new-tab/"
        >
          <el-icon :size="20"><Firefox /></el-icon>
        </el-link>
        <el-link underline="never" target="_blank" href="https://github.com/Redlnn/lemon-new-tab/">
          <el-icon :size="20"><Github /></el-icon>
        </el-link>
        <el-link :underline="'never'" target="_blank" href="https://space.bilibili.com/20858581">
          <el-icon :size="20"><bili-bili /></el-icon>
        </el-link>
      </el-space>
    </section>
  </base-dialog>
</template>

<style lang="scss">
.about__dialog {
  --about-icon-background: var(--el-fill-color-extra-light);

  .ext-icon {
    width: 100%;

    &__container {
      width: 55px;
      height: 55px;
      margin: 0 auto;
      background-color: var(--about-icon-background);
      background-image: url('@/assets/icon.svg');
      background-repeat: no-repeat;
      background-position: center;
      background-size: 80%;
      border: var(--el-border);
      border-radius: 15px;
    }
  }

  .ext-name {
    font-size: var(--el-font-size-large);
    text-align: center;
  }

  .ext-version {
    width: min-content;
    padding: 3px 8px;
    margin: 0 auto;
    margin-bottom: 18px;
    font-size: var(--el-font-size-small);
    color: var(--el-color-primary);
    background-color: color-mix(in oklch, var(--el-color-primary-light-8), transparent 10%);
    border-radius: 5px;
  }

  .ext-links {
    display: flex;
    justify-content: center;
    margin: 18px 0;
  }

  .yiyan-links {
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 5px 0;
    font-size: var(--el-font-size-extra-small);
    color: var(--el-text-color-primary);

    .el-link {
      font-size: var(--el-font-size-extra-small);
    }
  }

  .copyright {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--el-font-size-small);
    color: var(--el-text-color-secondary);

    .el-link:not(:hover) {
      color: inherit;
    }
  }
}

html.colorful .about__dialog {
  --about-icon-background: var(--el-color-primary-light-8);
}
</style>
