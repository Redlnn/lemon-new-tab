import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { defaultSettings } from '../shared/settings/default.ts'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const extension = resolve('.output/chrome-mv3')
const profile = await mkdtemp(join(tmpdir(), 'lemon-dock-enter-'))
const context = await chromium.launchPersistentContext(join(profile, 'profile'), {
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1100, height: 900 },
})

try {
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'))
  const settings = structuredClone(defaultSettings)
  settings.pluginVersion = '3.5.0'
  settings.readChangeLog = true
  settings.dock.enabled = true
  settings.dock.topSites = false
  settings.quickLinks.enabled = false
  settings.background.bgType = 'none'
  await worker.evaluate(
    async (settings) =>
      chrome.storage.local.set({
        settings,
        settings$: { v: 12 },
        uiPreferences: { language: 'en' },
      }),
    settings,
  )

  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    window.__dockFrames = []
    window.__dockEvents = []
    document.addEventListener('transitionrun', (event) => {
      if (event.target.classList?.contains('dock'))
        window.__dockEvents.push({ property: event.propertyName, time: performance.now() })
    })
    const observer = new MutationObserver(() => {
      const dock = document.querySelector('.dock')
      if (!dock || window.__dockStarted) return
      window.__dockStarted = true
      const start = performance.now()
      const sample = () => {
        const style = getComputedStyle(dock)
        window.__dockFrames.push({
          time: performance.now() - start,
          opacity: Number(style.opacity),
          bottom: Number.parseFloat(style.bottom),
          translateY: new DOMMatrixReadOnly(style.transform).m42,
          inlineOpacity: dock.style.opacity,
          classes: dock.className,
        })
        if (performance.now() - start < 800) requestAnimationFrame(sample)
        else window.__dockDone = true
      }
      requestAnimationFrame(sample)
      observer.disconnect()
    })
    observer.observe(document, { childList: true, subtree: true })
  })

  await page.goto(new URL('newtab.html', worker.url()).href)

  async function checkEntrance(enabled) {
    await page.waitForFunction(() => window.__dockDone === true)
    const result = await page.evaluate(() => ({
      frames: window.__dockFrames,
      events: window.__dockEvents,
    }))
    const visibleMovingFrames = result.frames.filter(
      (frame) => frame.opacity > 0.1 && frame.translateY > 2,
    )
    console.log('dock entrance', {
      enabled,
      transitions: result.events.map((event) => event.property),
      visibleMovingFrames: visibleMovingFrames.length,
      final: result.frames.at(-1),
    })
    if (enabled) {
      assert.ok(visibleMovingFrames.length >= 2, 'Dock should move while visible on load')
      assert.ok(result.events.some((event) => event.property === 'transform'))
    } else {
      assert.equal(visibleMovingFrames.length, 0, 'Dock should appear without moving')
      assert.ok(!result.events.some((event) => event.property === 'transform'))
    }
    assert.equal(result.frames.at(-1).opacity, 1)
    assert.equal(result.frames.at(-1).translateY, 0)
  }

  async function openPerformanceSettings() {
    await page.locator('.setting-btn').click()
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
    await page.locator('.settings-menu-item').filter({ hasText: 'Performance & Effects' }).click()
    await page.locator('.perf-behavior-row').filter({ hasText: 'Dock entrance animation' }).waitFor()
  }

  async function closeSettingsAndWaitFor(enabled) {
    await page.locator('.settings__dialog .base-dialog-close-btn').click()
    await page.waitForFunction(async (value) => {
      const { settings } = await chrome.storage.local.get('settings')
      return settings?.perf?.dockEnterAnim === value
    }, enabled)
  }

  await checkEntrance(true)
  await openPerformanceSettings()
  const entranceSwitch = page
    .locator('.perf-behavior-row')
    .filter({ hasText: 'Dock entrance animation' })
    .locator('.el-switch')
  const isEntranceEnabled = () => entranceSwitch.evaluate((el) => el.classList.contains('is-checked'))
  assert.equal(await isEntranceEnabled(), true)
  await entranceSwitch.click()
  assert.equal(await isEntranceEnabled(), false)
  await closeSettingsAndWaitFor(false)
  await page.reload()
  await checkEntrance(false)

  await openPerformanceSettings()
  const animationButtons = page.locator('.perf-panel--compact .perf-action-grid')
  await animationButtons.nth(1).getByRole('button', { name: 'Animation' }).click()
  assert.equal(await isEntranceEnabled(), true)
  await animationButtons.nth(0).getByRole('button', { name: 'Animation' }).click()
  assert.equal(await isEntranceEnabled(), false)
  await animationButtons.nth(1).getByRole('button', { name: 'Animation' }).click()
  await closeSettingsAndWaitFor(true)
  await page.reload()
  await checkEntrance(true)
  assert.deepEqual(errors, [])
} finally {
  await context.close()
}
