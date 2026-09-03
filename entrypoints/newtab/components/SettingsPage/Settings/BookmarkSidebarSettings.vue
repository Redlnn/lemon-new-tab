<script setup lang="ts">
import { useTranslation } from 'i18next-vue'

import { DrawerDirection, SortMode } from '@/shared/enums'
import { useSettingsStore } from '@/shared/settings'

import SettingsSection from './SettingsSection.vue'

const { t } = useTranslation('settings')
const { t: tt } = useTranslation()

const settings = useSettingsStore()

const directionOptions = [
  {
    label: 'bookmark.direction.rtl',
    value: DrawerDirection.rtl,
  },
  {
    label: 'bookmark.direction.ltr',
    value: DrawerDirection.ltr,
  },
]

const sortModeOptions = [
  {
    label: 'bookmark.sortMode.origin',
    value: SortMode.Original,
  },
  {
    label: 'bookmark.sortMode.nameAsc',
    value: SortMode.NameAsc,
  },
  {
    label: 'bookmark.sortMode.nameDesc',
    value: SortMode.NameDesc,
  },
  {
    label: 'bookmark.sortMode.createdAsc',
    value: SortMode.CreatedAsc,
  },
  {
    label: 'bookmark.sortMode.createdDesc',
    value: SortMode.CreatedDesc,
  },
]
</script>

<template>
  <div class="settings__items-container settings-page-grid">
    <SettingsSection
      :title="t('common.sections.display')"
      :summary="t('common.sections.summary.display')"
      content-class="settings-control-grid"
      mobile-open
    >
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('bookmark.direction.title') }}</div>
        <el-select v-model="settings.bookmark.direction" placeholder="Select" style="width: 120px">
          <el-option
            v-for="item in directionOptions"
            :key="item.value"
            :label="t(item.label)"
            :value="item.value"
          />
        </el-select>
      </div>
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('bookmark.showBtn') }}</div>
        <el-switch v-model="settings.bookmark.showBtn" />
      </div>
    </SettingsSection>

    <SettingsSection
      :title="t('common.sections.behavior')"
      :summary="t('common.sections.summary.behavior')"
      content-class="settings-control-grid"
    >
      <div class="settings__item settings__item--horizontal settings__item--with-note">
        <div class="settings__label">{{ t('bookmark.defaultSort') }}</div>
        <el-select
          v-model="settings.bookmark.defaultSortMode"
          placeholder="Select"
          style="width: 120px"
        >
          <el-option
            v-for="item in sortModeOptions"
            :key="item.value"
            :label="tt(item.label)"
            :value="item.value"
          />
        </el-select>
      </div>
      <div class="settings__item settings__item--horizontal settings__item--with-note">
        <div class="settings__label">{{ t('bookmark.rightClickToOpen') }}</div>
        <el-switch
          v-model="settings.bookmark.rightClickToOpen"
          :disabled="settings.dock.launchpad.rightClickToOpen"
        />
        <p v-if="settings.dock.launchpad.rightClickToOpen" class="settings__item-note">
          {{ t('bookmark.rightClickDisabledNote') }}
        </p>
      </div>
    </SettingsSection>
  </div>
</template>
