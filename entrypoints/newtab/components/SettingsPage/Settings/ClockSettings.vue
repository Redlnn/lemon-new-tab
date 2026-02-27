<script setup lang="ts">
import { useTranslation } from 'i18next-vue'

import { ClockSize, ClockWeight } from '@/shared/enums'
import { isChinese } from '@/shared/i18n'
import { useSettingsStore } from '@/shared/settings'

const { t } = useTranslation('settings')

const settings = useSettingsStore()

const sizeOptions = [
  {
    value: ClockSize.Small,
    label: 'clock.size.small'
  },
  {
    value: ClockSize.Medium,
    label: 'clock.size.medium'
  },
  {
    value: ClockSize.Large,
    label: 'clock.size.large'
  },
  {
    value: ClockSize.EvenLarge,
    label: 'clock.size.evgnlarge'
  },
  {
    value: ClockSize.ExtraLarge,
    label: 'clock.size.extralarge'
  }
]

const weightOptions = [
  {
    value: ClockWeight.Normal,
    label: 'clock.weight.normal'
  },
  {
    value: ClockWeight.Medium,
    label: 'clock.weight.medium'
  },
  {
    value: ClockWeight.Bold,
    label: 'clock.weight.bold'
  },
  {
    value: ClockWeight.ExtraBold,
    label: 'clock.weight.extraBold'
  },
  {
    value: ClockWeight.Heavy,
    label: 'clock.weight.heavy'
  },
  {
    value: ClockWeight.Black,
    label: 'clock.weight.black'
  }
]

function handleNewStyleChange(val: string | number | boolean) {
  if (val as boolean) {
    settings.clock.showMeridiem = true
    settings.clock.showSeconds = true
    settings.clock.meridiemFollowSize = false
    settings.clock.isMeridiem = true
  }
}

function handleTakeNewStyleOff(val: string | number | boolean) {
  if (!(val as boolean)) {
    settings.clock.newStyle = false
  }
}
</script>
<!-- TODO: i18n -->
<template>
  <div class="settings__items-container">
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('newtab:common.enable') }}</div>
      <el-switch v-model="settings.clock.enabled" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('clock.use12HourClock') }}</div>
      <el-switch v-model="settings.clock.isMeridiem" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">新风格</div>
      <el-switch v-model="settings.clock.newStyle" @change="handleNewStyleChange" />
    </div>
    <p class="settings__item--note">若开启将会同时开启“显示「上午 / 下午」”以及“显示秒钟”</p>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('clock.showAMPM') }}</div>
      <el-switch v-model="settings.clock.showMeridiem" @change="handleTakeNewStyleOff" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('clock.largeLabel') }}</div>
      <el-switch
        v-model="settings.clock.meridiemFollowSize"
        :disabled="!settings.clock.showMeridiem || settings.clock.newStyle"
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
      <el-switch v-model="settings.clock.showSeconds" @change="handleTakeNewStyleOff" />
    </div>
    <p class="settings__item--note">
      {{ t('clock.secondsTip') }}
    </p>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('clock.size.title') }}</div>
      <div class="settings__theme">
        <el-select
          v-model="settings.clock.size"
          style="width: 160px"
          popper-class="settings-item-popper"
          :show-arrow="false"
        >
          <el-option
            v-for="item in sizeOptions"
            :key="item.value"
            :label="t(item.label)"
            :value="item.value"
          />
        </el-select>
      </div>
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('clock.weight.title') }}</div>
      <div class="settings__theme">
        <el-select
          v-model="settings.clock.weight"
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
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">日期粗细</div>
      <div class="settings__theme">
        <el-select
          v-model="settings.clock.calcWeight"
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
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('clock.enableShadow') }}</div>
      <el-switch v-model="settings.clock.shadow" />
    </div>
    <div class="settings__item settings__item--horizontal">
      <div class="settings__label">{{ t('clock.blinkingColon') }}</div>
      <el-switch v-model="settings.clock.blink" />
    </div>
    <p class="settings__item--note">
      {{ t('clock.blinkingTip') }}
    </p>
  </div>
</template>
