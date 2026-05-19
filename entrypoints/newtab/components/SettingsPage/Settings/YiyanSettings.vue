<script setup lang="ts">
import { useTranslation } from 'i18next-vue'

import { isChinese } from '@/shared/i18n'
import { useSettingsStore } from '@/shared/settings'

import { isProviderKey, yiyanProviders } from '@newtab/shared/yiyan'

const { t } = useTranslation('settings')

const settings = useSettingsStore()

const currentProviderNote = computed(() => {
  if (isProviderKey(settings.yiyan.provider)) {
    return yiyanProviders[settings.yiyan.provider].note
  }
  return null
})
</script>

<template>
  <div class="settings__items-container">
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('newtab:common.enable') }}</div>
      <el-switch v-model="settings.yiyan.enabled" />
    </div>
    <p v-if="!isChinese" class="settings__item--note">
      {{ t('yiyan.description') }}
    </p>
    <template v-if="settings.yiyan.enabled">
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('yiyan.alwaysShow') }}</div>
        <el-switch v-model="settings.yiyan.alwaysShow" />
      </div>
      <p class="settings__item--note">
        {{ t('yiyan.normalyShowTip') }}
      </p>
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('yiyan.shadow') }}</div>
        <el-switch v-model="settings.yiyan.style.shadow" />
      </div>
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('yiyan.provider') }}</div>
        <el-select
          v-model="settings.yiyan.provider"
          style="width: 180px"
          fit-input-width
          :show-arrow="false"
        >
          <el-option
            v-for="(provider, key) in yiyanProviders"
            :key="key"
            :label="t(provider.nameKey)"
            :value="key"
          />
          <el-option :label="t('yiyan.providers.custom.name')" value="custom" />
        </el-select>
      </div>
      <p v-if="currentProviderNote" class="settings__item--note">
        {{ t(currentProviderNote) }}
      </p>
      <template v-if="settings.yiyan.provider === 'custom'">
        <div class="settings__item settings__item--vertical">
          <div class="settings__label">{{ t('yiyan.customLinesLabel') }}</div>
          <el-input
            class="yiyan-textarea"
            v-model="settings.yiyan.customLines"
            type="textarea"
            :rows="6"
            :placeholder="t('yiyan.customLinesPlaceholder')"
          />
        </div>
        <p class="settings__item--note">
          {{ t('yiyan.customLinesNote') }}
        </p>
      </template>
    </template>
  </div>
</template>

<style lang="scss">
.yiyan-textarea {
  .el-textarea__inner {
    padding: 10px 15px;
    margin: 8px 0;
    white-space: nowrap;
  }
}
</style>
