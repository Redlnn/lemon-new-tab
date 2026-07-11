import './styles/index.scss'
import { usePreferredDark } from '@vueuse/core'
import { createPinia } from 'pinia'
import { createApp } from 'vue'

import { i18n, initI18n } from '@/shared/i18n'
import { shouldStartApp, useSettingsStore } from '@/shared/settings'
import {
  applyStoredMonetColors,
  changeTheme,
  getMonetColors,
  toggleDocumentClass,
} from '@/shared/theme'

import App from './App.vue'

const preferredDark = usePreferredDark()
watch(
  preferredDark,
  () => {
    if (preferredDark.value) {
      document.documentElement.classList.add('dark')
      document.documentElement.classList.remove('light')
    } else {
      document.documentElement.classList.add('light')
      document.documentElement.classList.remove('dark')
    }
  },
  { immediate: true },
)

function renderPopupStartupError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const fallbackMain = document.getElementById('fallback')
  if (fallbackMain) {
    fallbackMain.classList.remove('hidden')
    const pre = fallbackMain.querySelector('.fallback-pre')
    if (pre) {
      pre.textContent = message
    }
  }
}

async function bootstrapPopup() {
  const canStartApp = await shouldStartApp()
  if (!canStartApp) return

  const app = createApp(App)
  const pinia = createPinia()

  i18n(app)
  app.use(pinia)

  // 初始化设置
  await useSettingsStore().init()
  const settings = useSettingsStore()

  // 应用主题色
  changeTheme(settings.theme.primaryColor)

  // 应用 colorful 模式
  toggleDocumentClass('colorful', settings.theme.colorfulMode)

  // 应用莫奈模式
  if (settings.theme.monetColor) {
    const monetColors = await getMonetColors()
    if (monetColors) {
      applyStoredMonetColors(monetColors)
      toggleDocumentClass('monet', true)
    }
  }

  app.mount('body')
}

void (async () => {
  try {
    await initI18n()
    await bootstrapPopup()
  } catch (error) {
    console.error('[popup] startup failed', error)
    renderPopupStartupError(error)
  }
})()
