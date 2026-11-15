import { browser } from '#imports'

export async function inspectSettings() {
  const storedSettings: {
    settings$: { v?: number } | null
    settings: { version: string | number | null; [key: string]: unknown } | null
  } = await browser.storage.local.get({
    settings$: null,
    settings: null,
  })

  if (storedSettings['settings$']?.v && storedSettings['settings$'].v <= 6) {
    return { compatible: false, hasSettings: storedSettings.settings !== null }
  }

  if (storedSettings.settings?.version) {
    let isInvaildSettings: boolean = false

    if (typeof storedSettings.settings.version === 'string') {
      // 远古配置文件
      isInvaildSettings = true
    } else if (storedSettings.settings.version <= 6) {
      isInvaildSettings = true
    }
    if (!('pluginVersion' in storedSettings.settings)) {
      // 早期版本没有 pluginVersion 字段，说明配置文件非常古老，直接清除重置
      isInvaildSettings = true
    }

    if (isInvaildSettings) {
      return { compatible: false, hasSettings: true }
    }
  }

  return { compatible: true, hasSettings: storedSettings.settings !== null }
}

export async function isSettingsCompatible(): Promise<boolean> {
  return (await inspectSettings()).compatible
}

export async function shouldStartApp() {
  const result = await inspectSettings()
  if (result.compatible) return { canStart: true, hasSettings: result.hasSettings }

  const { handleInvaildSettings } = await import('./handleInvaild')
  await handleInvaildSettings()
  return { canStart: false, hasSettings: result.hasSettings }
}
