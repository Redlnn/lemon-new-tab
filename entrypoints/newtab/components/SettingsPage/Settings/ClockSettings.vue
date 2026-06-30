<script setup lang="ts">
import { useTranslation } from 'i18next-vue'

import { ClockWeight } from '@/shared/enums'
import { isChinese } from '@/shared/i18n'
import { useSettingsStore } from '@/shared/settings'

const { t } = useTranslation('settings')

const settings = useSettingsStore()

const weightOptions = [
  {
    value: ClockWeight.Normal,
    label: 'clock.weight.normal',
  },
  {
    value: ClockWeight.Medium,
    label: 'clock.weight.medium',
  },
  {
    value: ClockWeight.Bold,
    label: 'clock.weight.bold',
  },
  {
    value: ClockWeight.ExtraBold,
    label: 'clock.weight.extraBold',
  },
  {
    value: ClockWeight.Heavy,
    label: 'clock.weight.heavy',
  },
  {
    value: ClockWeight.Black,
    label: 'clock.weight.black',
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
  <div class="settings__items-container">
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('newtab:common.enable') }}</div>
      <el-switch v-model="settings.clock.enabled" />
    </div>
    <template v-if="settings.clock.enabled">
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('clock.hour12') }}</div>
        <el-switch v-model="settings.clock.hour12" />
      </div>
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('clock.newStyle') }}</div>
        <el-switch v-model="settings.clock.newStyle" @change="handleNewStyleChange" />
      </div>
      <p class="settings__item--note">
        {{ t('clock.newStyleDesc') }}
      </p>
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
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('clock.showSeconds') }}</div>
        <el-switch v-model="settings.clock.showSeconds" :disabled="settings.clock.newStyle" />
      </div>
      <p class="settings__item--note">
        {{ t('clock.secondsTip') }}
      </p>
      <div class="settings__item settings__item--vertical">
        <div class="settings__label">{{ t('clock.size.title') }}</div>
        <el-slider
          v-model="settings.clock.size"
          :min="30"
          :max="200"
          :show-tooltip="false"
          show-input
        />
      </div>
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('clock.weight.title') }}</div>
        <el-select
          v-model="settings.clock.weight.time"
          style="width: 160px"
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
        <div class="settings__label">{{ t('clock.weight.dateTitle') }}</div>
        <el-select
          v-model="settings.clock.weight.date"
          style="width: 160px"
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
      <div class="settings__item settings__item--horizontal">
        <div class="settings__label">{{ t('clock.blink') }}</div>
        <el-switch v-model="settings.clock.style.blink" />
      </div>
      <p class="settings__item--note">
        {{ t('clock.blinkingTip') }}
      </p>
    </template>
  </div>
</template>
