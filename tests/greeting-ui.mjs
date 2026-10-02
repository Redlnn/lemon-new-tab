import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import packageInfo from '../package.json' with { type: 'json' }
import { defaultSettings } from '../shared/settings/default.ts'
import { getTimePeriod } from '../entrypoints/newtab/shared/timePeriod.ts'
import newtabEn from '../locales/en/newtab.json' with { type: 'json' }

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const extension = resolve('.output/chrome-mv3')
const profile = join(await mkdtemp(join(tmpdir(), 'lemon-greeting-')), 'profile')
const browserOptions = {
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1100, height: 900 },
}
const greeting = newtabEn.notification.greeting[getTimePeriod(new Date().getHours())]
let context = await chromium.launchPersistentContext(profile, browserOptions)

async function openNewtab() {
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'))
  const page = await context.newPage()
  await page.goto(new URL('newtab.html', worker.url()).href)
  await page.locator('.clock').waitFor()
  return page
}

async function openOtherSettings(page) {
  await page.locator('.setting-btn').click()
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
  await page.locator('.settings-menu-item').filter({ hasText: 'Other' }).click()
  await page.locator('.settings__item--horizontal').filter({ hasText: 'Startup greeting' }).waitFor()
}

async function toggleGreeting(page, enabled) {
  await openOtherSettings(page)
  const setting = page
    .locator('.settings__item--horizontal')
    .filter({ hasText: 'Startup greeting' })
    .locator('.el-switch')
  assert.equal(await setting.evaluate((element) => element.classList.contains('is-checked')), !enabled)
  await setting.click()
  assert.equal(await setting.evaluate((element) => element.classList.contains('is-checked')), enabled)
  await page.locator('.settings__dialog .base-dialog-close-btn').click()
  await page.waitForFunction(async (value) => {
    const { settings } = await chrome.storage.local.get('settings')
    return settings?.greetingEnabled === value
  }, enabled)
}

try {
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'))
  const settings = structuredClone(defaultSettings)
  settings.pluginVersion = packageInfo.version
  settings.readChangeLog = true
  settings.background.bgType = 'none'
  settings.quickLinks.enabled = false
  settings.dock.enabled = false
  await worker.evaluate(async (value) => {
    await chrome.storage.local.set({
      settings: value,
      settings$: { v: 12 },
      shownFaviconCacheHint: true,
      uiPreferences: { language: 'en' },
    })
  }, settings)

  const first = await openNewtab()
  await first.getByText(greeting, { exact: true }).waitFor()
  assert.equal((await first.evaluate(() => chrome.storage.session.get('greetingShown'))).greetingShown, true)

  const second = await openNewtab()
  await second.waitForTimeout(800)
  assert.equal(await second.getByText(greeting, { exact: true }).count(), 0)

  await toggleGreeting(first, false)
  await worker.evaluate(() => chrome.storage.session.remove('greetingShown'))
  const disabled = await openNewtab()
  await disabled.waitForTimeout(800)
  assert.equal(await disabled.getByText(greeting, { exact: true }).count(), 0)
  assert.deepEqual(await worker.evaluate(() => chrome.storage.session.get('greetingShown')), {})

  await toggleGreeting(first, true)
  const reenabled = await openNewtab()
  await reenabled.getByText(greeting, { exact: true }).waitFor()

  await worker.evaluate(() => chrome.storage.session.remove('greetingShown'))
  const claims = await Promise.all([
    first.evaluate(() => chrome.runtime.sendMessage({ type: 'greeting:claim' })),
    second.evaluate(() => chrome.runtime.sendMessage({ type: 'greeting:claim' })),
    disabled.evaluate(() => chrome.runtime.sendMessage({ type: 'greeting:claim' })),
  ])
  assert.deepEqual(claims.sort(), [false, false, true])

  await context.close()
  context = await chromium.launchPersistentContext(profile, browserOptions)
  const restarted = await openNewtab()
  await restarted.getByText(greeting, { exact: true }).waitFor()
  console.log('Greeting toggle, session limit, concurrent claim, and browser restart passed')
} finally {
  await context.close()
}
