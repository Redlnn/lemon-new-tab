<script lang="ts" setup>
import '@newtab/styles/clock.scss'
import { useDocumentVisibility } from '@vueuse/core'

import dayjs from 'dayjs/esm'
import { useTranslation } from 'i18next-vue'

import { ClockWeight } from '@/shared/enums'
import { isChinese } from '@/shared/i18n'
import { useSettingsStore } from '@/shared/settings'

import { dayjsLanguage, ensureLunarPlugin } from '@newtab/shared/dayjs'
import { getTimePeriod } from '@newtab/shared/timePeriod'

const { t } = useTranslation('newtab')
const settings = useSettingsStore()
const lunarReady = ref(false)
const showLunar = computed(
  () => settings.clock.showDate && settings.clock.showLunar && isChinese.value,
)

watch(
  showLunar,
  async (enabled) => {
    if (!enabled || lunarReady.value) return
    try {
      await ensureLunarPlugin()
      lunarReady.value = true
    } catch (error) {
      console.error('[clock] Failed to load lunar calendar:', error)
    }
  },
  { immediate: true },
)

function customMeridiem(hours: number) {
  return t(`time.${getTimePeriod(hours)}`)
}

const timeNow = ref(new Date())
const documentVisibility = useDocumentVisibility()
let clockTimer: ReturnType<typeof setTimeout> | undefined

function scheduleClockTick() {
  if (clockTimer) clearTimeout(clockTimer)
  if (documentVisibility.value !== 'visible') return

  const interval = settings.clock.showSeconds || settings.clock.newStyle ? 1000 : 60 * 1000
  const delay = interval - (Date.now() % interval) + 10
  clockTimer = setTimeout(() => {
    timeNow.value = new Date()
    scheduleClockTick()
  }, delay)
}

watch(
  [() => settings.clock.showSeconds, () => settings.clock.newStyle, documentVisibility],
  () => {
    if (documentVisibility.value === 'visible') timeNow.value = new Date()
    scheduleClockTick()
  },
  { immediate: true },
)

onUnmounted(() => {
  if (clockTimer) clearTimeout(clockTimer)
})

const formattedTime = computed(() => {
  void dayjsLanguage.value // 日期语言加载完成后重新格式化。
  const now = dayjs(timeNow.value)
  return {
    hour: now.format('HH'),
    hourMeridiem: now.format('h'),
    minute: now.format('mm'),
    second: now.format('ss'),
    meridiem: now.format('A'),
  }
})

const currentMinute = computed(() => Math.floor(timeNow.value.getTime() / 60_000))

const formattedDate = computed(() => {
  void dayjsLanguage.value
  const now = dayjs(currentMinute.value * 60_000)
  return {
    meridiemZH: customMeridiem(now.hour()),
    weekday: now.format('dddd'),
    date: now.format('LL'),
    lunar: showLunar.value && lunarReady.value ? now.format('LMLD') : '',
  }
})

const weightMap = {
  [ClockWeight.Normal]: 400,
  [ClockWeight.Medium]: 500,
  [ClockWeight.Bold]: 600,
  [ClockWeight.ExtraBold]: 700,
  [ClockWeight.Heavy]: 800,
  [ClockWeight.Black]: 900,
}

const clockClass = computed(() => [settings.clock.newStyle ? 'clock__new' : undefined])
const clockRootStyle = computed(() => ({
  opacity: (100 - settings.clock.style.transparency) / 100,
}))
const clockStyle = computed(() => {
  return {
    fontWeight: weightMap[settings.clock.weight.time],
    fontSize: settings.clock.size + 'px',
  }
})
const dateStyle = computed(() => {
  return {
    fontSize: settings.clock.dateSize + 'px',
    fontWeight: weightMap[settings.clock.weight.date],
  }
})
</script>

<template>
  <div
    ref="time"
    class="clock noselect"
    :class="[
      settings.clock.style.shadow ? 'clock--shadow' : undefined,
      settings.clock.style.invertColor.light ? ['clock--invert', 'clock--light'] : undefined,
      settings.clock.style.invertColor.night ? ['clock--invert', 'clock--night'] : undefined,
    ]"
    :style="clockRootStyle"
  >
    <div class="clock__time-container" :class="clockClass" :style="clockStyle">
      <div
        :style="[settings.clock.newStyle ? { display: 'flex', alignItems: 'center' } : undefined]"
      >
        <span
          v-if="settings.clock.meridiem.show && !settings.clock.newStyle"
          class="clock__meridiem"
          :class="[settings.clock.meridiem.followSize ? undefined : 'clock__meridiem-small']"
        >
          {{ isChinese ? formattedDate.meridiemZH : formattedTime.meridiem }}
        </span>
        <span class="clock__time">
          <span class="clock__hour">
            {{ settings.clock.hour12 ? formattedTime.hourMeridiem : formattedTime.hour }}
          </span>
          <span
            class="clock__colon"
            :class="{ 'clock__colon--blinking': settings.clock.style.blink }"
            >:</span
          >
          <span
            class="clock__minute"
            :class="[
              settings.clock.colorfulNum && (!settings.clock.showSeconds || settings.clock.newStyle)
                ? 'colorful'
                : undefined,
            ]"
            >{{ formattedTime.minute }}</span
          >
          <template v-if="settings.clock.showSeconds && !settings.clock.newStyle">
            <span
              class="clock__colon"
              :class="{ 'clock__colon--blinking': settings.clock.style.blink }"
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
        <span style="grid-area: meridiem">
          {{ isChinese ? formattedDate.meridiemZH : formattedTime.meridiem }}
        </span>
      </div>
    </div>
    <div v-if="settings.clock.showDate" class="clock__date" :style="dateStyle">
      <span>
        {{ formattedDate.date }}
        {{ formattedDate.weekday }}
      </span>
      <span v-if="showLunar && lunarReady">{{ ` ${formattedDate.lunar}` }}</span>
    </div>
  </div>
</template>
