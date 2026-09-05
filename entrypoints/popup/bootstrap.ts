import './styles/index.scss'
import { usePreferredDark } from '@vueuse/core'
import { createPinia } from 'pinia'
import { createVaporApp } from 'vue'

import { i18n, initI18n } from '@/shared/i18n'
import { isSettingsCompatible, useSettingsStore } from '@/shared/settings'
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

export async function bootstrapPopup() {
  await initI18n()

  const isCompatible = await isSettingsCompatible()
  const app = createVaporApp(App, { hasInvalidSettings: !isCompatible })
  const pinia = createPinia()

  app.use(pinia)
  i18n(app)

  if (!isCompatible) {
    app.mount('#app')
    return
  }

  await useSettingsStore().init()
  const settings = useSettingsStore()

  changeTheme(settings.theme.primaryColor)
  toggleDocumentClass('colorful', settings.theme.colorfulMode)

  if (settings.theme.monetColor) {
    const monetColors = await getMonetColors()
    if (monetColors) {
      applyStoredMonetColors(monetColors)
      toggleDocumentClass('monet', true)
    }
  }

  app.mount('#app')
}
