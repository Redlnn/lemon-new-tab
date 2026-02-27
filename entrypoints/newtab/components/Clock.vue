<script lang="ts" setup>
import { useNow, useTimeoutFn } from '@vueuse/core'

import dayjs from 'dayjs/esm'
import { useTranslation } from 'i18next-vue'

import { ClockSize, ClockWeight } from '@/shared/enums'
import { isChinese } from '@/shared/i18n'
import { useSettingsStore } from '@/shared/settings'

const { t, i18next } = useTranslation('newtab')
const settings = useSettingsStore()
const time = ref()

const currentLang = ref(i18next.language)

i18next.on('languageChanged', (lng) => {
  useTimeoutFn(() => {
    currentLang.value = lng
  }, 100)
})

function customMeridiem(hours: number) {
  if (hours < 2) return t('time.lateNight')
  if (hours < 7) return t('time.dawn')
  if (hours < 11) return t('time.morning')
  if (hours < 14) return t('time.noon')
  if (hours < 17) return t('time.afternoon')
  if (hours < 19) return t('time.dusk')
  if (hours < 23) return t('time.evening')
  return t('time.lateNight')
}

// 显示秒时使用较短间隔以保证秒数更新及时，否则使用 1000ms 节省资源
const timeNow = ref(new Date())
let timeTimer: ReturnType<typeof setInterval> | null = null

function setupTimeTimer() {
  if (timeTimer) clearInterval(timeTimer)
  const interval = settings.clock.showSeconds ? 100 : 1000
  timeTimer = setInterval(() => {
    timeNow.value = new Date()
  }, interval)
}

watch(() => settings.clock.showSeconds, setupTimeTimer, { immediate: true })

onUnmounted(() => {
  if (timeTimer) clearInterval(timeTimer)
})

const dateNow = useNow({ interval: 60 * 1000 })

const formattedTime = computed(() => {
  void currentLang.value // 作为响应式依赖，确保语言切换时重新计算
  const now = dayjs(timeNow.value)
  return {
    hour: now.format('HH'),
    hourMeridiem: now.format('h'),
    minute: now.format('mm'),
    second: now.format('ss'),
    meridiem: now.format('A')
  }
})

const formattedDate = computed(() => {
  void currentLang.value // 作为响应式依赖，确保语言切换时重新计算
  const now = dayjs(dateNow.value)
  return {
    meridiemZH: customMeridiem(now.hour()),
    weekday: now.format('dddd'),
    date: now.format('LL'),
    lunar: now.format('LMLD')
  }
})

const sizeMap = {
  [ClockSize.Small]: 'clock__time-container-small',
  [ClockSize.Medium]: 'clock__time-container-medium',
  [ClockSize.Large]: undefined,
  [ClockSize.EvenLarge]: 'clock__time-container-even-large',
  [ClockSize.ExtraLarge]: 'clock__time-container-extra-large'
}

const weightMap = {
  [ClockWeight.Normal]: 400,
  [ClockWeight.Medium]: 500,
  [ClockWeight.Bold]: 600,
  [ClockWeight.ExtraBold]: 700,
  [ClockWeight.Heavy]: 800,
  [ClockWeight.Black]: 900
}

const clockClass = computed(() => [
  sizeMap[settings.clock.size],
  settings.clock.newStyle ? 'clock__new' : undefined
])
const clockStyle = computed(() => {
  return {
    fontWeight: weightMap[settings.clock.weight]
  }
})
const calcStyle = computed(() => {
  return {
    fontWeight: weightMap[settings.clock.calcWeight]
  }
})
</script>

<template>
  <div
    ref="time"
    class="clock noselect"
    :class="[
      settings.clock.shadow ? 'clock--shadow' : undefined,
      settings.clock.invertColor.light ? ['clock--invert', 'clock--light'] : undefined,
      settings.clock.invertColor.night ? ['clock--invert', 'clock--night'] : undefined
    ]"
  >
    <div class="clock__time-container" :class="clockClass" :style="clockStyle">
      <div
        :style="[settings.clock.newStyle ? { display: 'flex', alignItems: 'center' } : undefined]"
      >
        <span
          v-if="settings.clock.showMeridiem && !settings.clock.newStyle"
          class="clock__meridiem"
          :class="[settings.clock.meridiemFollowSize ? undefined : 'clock__meridiem-small']"
        >
          {{ isChinese ? formattedDate.meridiemZH : formattedTime.meridiem }}
        </span>
        <span class="clock__time">
          <span class="clock__hour">
            {{ settings.clock.isMeridiem ? formattedTime.hourMeridiem : formattedTime.hour }}
          </span>
          <span class="clock__colon" :class="{ 'clock__colon--blinking': settings.clock.blink }"
            >:</span
          >
          <span
            class="clock__minute"
            :class="[
              settings.clock.colorfulNum && (!settings.clock.showSeconds || settings.clock.newStyle)
                ? 'colorful'
                : undefined
            ]"
            >{{ formattedTime.minute }}</span
          >
          <template v-if="settings.clock.showSeconds && !settings.clock.newStyle">
            <span class="clock__colon" :class="{ 'clock__colon--blinking': settings.clock.blink }"
              >:</span
            >
            <span
              class="clock__second"
              :class="[settings.clock.colorfulNum ? 'colorful' : undefined]"
              >{{ formattedTime.second }}</span
            >
          </template>
        </span>
      </div>
      <div class="clock__new-container" v-if="settings.clock.newStyle">
        <span>{{ formattedTime.second }}</span>
        <span style="grid-area: meridiem">{{
          isChinese ? formattedDate.meridiemZH : formattedTime.meridiem
        }}</span>
      </div>
    </div>
    <div v-if="settings.clock.showDate" class="clock__date" :style="calcStyle">
      <span>
        {{ formattedDate.date }}
        {{ formattedDate.weekday }}
      </span>
      <span v-if="settings.clock.showLunar && isChinese">{{ ` ${formattedDate.lunar}` }}</span>
    </div>
  </div>
</template>
