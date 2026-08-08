<script setup lang="ts">
import { useTranslation } from 'i18next-vue'

import { ClockWeight } from '@/shared/enums'
import { isChinese } from '@/shared/i18n'
import { useSettingsStore } from '@/shared/settings'

import SettingsSection from './SettingsSection.vue'

const { t } = useTranslation('settings')

const settings = useSettingsStore()

const weightOptions = [
  {
    value: ClockWeight.Normal,
    label: 'clock.weight.normal',
    weight: 400,
  },
  {
    value: ClockWeight.Medium,
    label: 'clock.weight.medium',
    weight: 500,
  },
  {
    value: ClockWeight.Bold,
    label: 'clock.weight.bold',
    weight: 600,
  },
  {
    value: ClockWeight.ExtraBold,
    label: 'clock.weight.extraBold',
    weight: 700,
  },
  {
    value: ClockWeight.Heavy,
    label: 'clock.weight.heavy',
    weight: 800,
  },
  {
    value: ClockWeight.Black,
    label: 'clock.weight.black',
    weight: 900,
  },
]

function handleNewStyleChange(val: string | number | boolean) {
  if (val as boolean) {
    settings.clock.meridiem.show = true
    settings.clock.meridiem.followSize = false
    settings.clock.showSeconds = true
    settings.clock.hour12 = true
  }
}

function formatTransparency(value: number) {
  return `${value}%`
}
</script>
<template>
  <div class="settings__items-container settings-page-grid">
    <SettingsSection
      :title="t('common.sections.display')"
      :summary="t('common.sections.summary.display')"
      content-class="settings-control-grid"
      mobile-open
    >
      <div class="settings__item settings__item--horizontal settings-control-wide">
        <div class="settings__label">{{ t('newtab:common.enable') }}</div>
        <el-switch v-model="settings.clock.enabled" />
      </div>
      <template v-if="settings.clock.enabled">
        <div
          class="settings__item settings__item--horizontal settings__item--with-note settings-control-wide"
        >
          <div class="settings__label">{{ t('clock.newStyle') }}</div>
          <el-switch v-model="settings.clock.newStyle" @change="handleNewStyleChange" />
          <p class="settings__item-note">{{ t('clock.newStyleDesc') }}</p>
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('clock.hour12') }}</div>
          <el-switch v-model="settings.clock.hour12" />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('clock.showDate') }}</div>
          <el-switch v-model="settings.clock.showDate" />
        </div>
        <div
          v-if="settings.clock.showDate && isChinese"
          class="settings__item settings__item--horizontal"
        >
          <div class="settings__label">{{ t('clock.showLunar') }}</div>
          <el-switch v-model="settings.clock.showLunar" />
        </div>
        <div class="settings__item settings__item--horizontal settings__item--with-note">
          <div class="settings__label">{{ t('clock.showSeconds') }}</div>
          <el-switch v-model="settings.clock.showSeconds" :disabled="settings.clock.newStyle" />
          <p class="settings__item-note">{{ t('clock.secondsTip') }}</p>
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('clock.meridiem.show') }}</div>
          <el-switch v-model="settings.clock.meridiem.show" :disabled="settings.clock.newStyle" />
        </div>
        <div class="settings__item settings__item--horizontal">
          <div class="settings__label">{{ t('clock.meridiem.followSize') }}</div>
          <el-switch
            v-model="settings.clock.meridiem.followSize"
            :disabled="!settings.clock.meridiem.show || settings.clock.newStyle"
          />
        </div>
      </template>
    </SettingsSection>

    <SettingsSection
      v-if="settings.clock.enabled"
      :title="t('common.sections.appearance')"
      :summary="t('common.sections.summary.appearance')"
      content-class="settings-control-grid"
    >
      <div class="settings__item settings__item--vertical">
        <div class="settings__label">{{ t('clock.size.title') }}</div>
        <el-slider
          v-model="settings.clock.size"
          :min="30"
          :max="200"
          :show-tooltip="false"
          :show-input-controls="false"
          show-input
        />
      </div>
      <div class="settings__item settings__item--vertical">
        <div class="settings__label">{{ t('clock.dateSize') }}</div>
        <el-slider
          v-model="settings.clock.dateSize"
          :min="10"
          :max="50"
          :show-tooltip="false"
          :show-input-controls="false"
          show-input
        />
      </div>
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('clock.weight.title') }}</div>
        <el-select
          v-model="settings.clock.weight.time"
          style="width: 120px"
          popper-class="settings-item-popper"
          :show-arrow="false"
        >
          <el-option
            v-for="item in weightOptions"
            :key="item.value"
            :label="t(item.label)"
            :value="item.value"
          >
            <span style="float: left">{{ t(item.label) }}</span>
            <span
              style="
                float: right;
                margin-left: 10px;
                font-size: 11px;
                color: var(--el-text-color-secondary);
              "
            >
              {{ item.weight }}
            </span>
          </el-option>
        </el-select>
      </div>
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('clock.weight.dateTitle') }}</div>
        <el-select
          v-model="settings.clock.weight.date"
          style="width: 120px"
          popper-class="settings-item-popper"
          :show-arrow="false"
        >
          <el-option
            v-for="item in weightOptions"
            :key="item.value"
            :label="t(item.label)"
            :value="item.value"
          />
        </el-select>
      </div>
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('clock.colorful') }}</div>
        <el-switch v-model="settings.clock.colorfulNum" />
      </div>
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('clock.shadow') }}</div>
        <el-switch v-model="settings.clock.style.shadow" />
      </div>
      <div class="settings__item settings__item--vertical">
        <div class="settings__label">{{ t('clock.transparency') }}</div>
        <el-slider
          v-model="settings.clock.style.transparency"
          :max="95"
          :step="1"
          :format-tooltip="formatTransparency"
        />
      </div>
      <div class="settings__item settings__item--horizontal settings__item--with-note">
        <div class="settings__label">{{ t('clock.blink') }}</div>
        <el-switch v-model="settings.clock.style.blink" />
        <p class="settings__item-note">{{ t('clock.blinkingTip') }}</p>
      </div>
    </SettingsSection>
  </div>
</template>
