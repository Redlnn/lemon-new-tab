import { browser } from '#imports'

export async function isSettingsCompatible(): Promise<boolean> {
  const storedSettings: {
    $settings: number | null
    settings: { version: string | number | null; [key: string]: unknown }
  } = await browser.storage.local.get({
    $settings: null,
    settings: { version: null },
  })

  if (storedSettings.$settings && storedSettings.$settings <= 6) {
    return false
  }

  if (storedSettings.settings.version) {
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
      return false
    }
  }

  return true
}

export async function shouldStartApp(): Promise<boolean> {
  if (await isSettingsCompatible()) return true

  const { handleInvaildSettings } = await import('./handleInvaild')
  await handleInvaildSettings()
  return false
}
