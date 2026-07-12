import { initI18n } from '@/shared/i18n'
import { shouldStartApp } from '@/shared/settings'

import { initDayjs } from './shared/dayjs'

function renderStartupError(error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const container = document.createElement('div')
  container.style.cssText = [
    'margin: 24px auto',
    'max-width: 720px',
    'padding: 16px',
    'border: 1px solid #f56c6c',
    'border-radius: 8px',
    'background: #fff5f5',
    'color: #c45656',
    'font: 14px/1.6 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    'white-space: pre-wrap',
  ].join(';')
  container.textContent = `Lemon New Tab startup failed.\n${message}\nSee console for details.`
  document.body.replaceChildren(container)
}

async function bootstrapNewtab() {
  const [, canStartApp] = await Promise.all([initI18n(), shouldStartApp()])
  if (!canStartApp) {
    return
  }

  const mainModuleTask = import('./main')
  const [, { main }] = await Promise.all([initDayjs(), mainModuleTask])
  await main()
}

void (async () => {
  try {
    await bootstrapNewtab()
  } catch (error) {
    console.error('[newtab] startup failed', error)
    renderStartupError(error)
  }
})()
