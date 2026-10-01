import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { defaultSettings } from '../shared/settings/default.ts'
import { waitForAsync } from './waitForAsync.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const extension = resolve('.output/chrome-mv3')
const context = await chromium.launchPersistentContext(
  await mkdtemp(join(tmpdir(), 'lemon-note-menu-')),
  {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1100, height: 900 },
  },
)

try {
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'))
  await worker.evaluate(
    (settings) =>
      chrome.storage.local.set({
        settings: {
          ...settings,
          pluginVersion: chrome.runtime.getManifest().version,
          quickLinks: { ...settings.quickLinks, topSites: false },
        },
        quickLinks: {
          items: [
            { id: 'app-note', appId: 'note', url: 'lemon-new-tab://app/note', title: 'QA Notes' },
          ],
          groups: [],
        },
        notes: {
          notes: [
            'Alpha',
            'Beta',
            'Gamma',
            ...Array.from({ length: 20 }, (_, i) => `Extra ${i}`),
          ].map((title, index) => ({
            id: crypto.randomUUID(),
            title,
            markdown: `Body ${title}`,
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: new Date(Date.UTC(2026, 9, 1, 0, 0, 30 - index)).toISOString(),
          })),
        },
      }),
    defaultSettings,
  )
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(new URL('newtab.html', worker.url()).href)
  await page.locator('.quick-links').first().waitFor()
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('lemon-new-tab:open-built-in-app', { detail: 'note' })),
  )
  const item = (title) =>
    page.locator('.note-aside-item').filter({
      has: page.locator('.note-aside-title', { hasText: title }),
    })
  const menu = page.locator('.note-context-menu:visible')
  const actions = () => menu.locator('.el-dropdown-menu__item')
  const stored = () =>
    worker.evaluate(async () => (await chrome.storage.local.get('notes')).notes.notes)
  async function openMenu(title, position) {
    await item(title).click({ button: 'right', position })
    await menu.waitFor()
    assert.equal(await page.locator('.note-context-menu').count(), 1, '所有 item 共用一个菜单')
    assert.equal(await actions().count(), 3)
  }
  async function runAction(index) {
    await actions().nth(index).click()
    await menu.waitFor({ state: 'hidden' })
  }
  async function confirmDeletion(title, confirm) {
    await openMenu(title)
    await runAction(2)
    const confirmation = page.locator('.el-message-box')
    await confirmation.waitFor()
    assert.ok((await confirmation.textContent()).includes(title))
    await confirmation
      .locator(confirm ? '.el-button--primary' : '.el-button:not(.el-button--primary)')
      .click()
    await confirmation.waitFor({ state: 'hidden' })
  }

  // 连续右键切换目标，不能复制菜单实例或误用上一条便签。
  await openMenu('Beta')
  await runAction(0)
  await waitForAsync(
    page,
    async () =>
      (await chrome.storage.local.get('notes')).notes.notes.find((n) => n.title === 'Beta')
        .pinned === true,
  )
  assert.equal((await page.locator('.note-aside-title').first().textContent()).trim(), 'Beta')
  await openMenu('Beta')
  assert.match(await actions().nth(0).textContent(), /Unpin|取消置頂|取消置顶|Sabitlemeyi kaldır/)
  await openMenu('Gamma')
  assert.match(await actions().nth(0).textContent(), /^\s*(Pin|置頂|置顶|Sabitle)\s*$/)
  await runAction(0)
  await waitForAsync(
    page,
    async () =>
      (await chrome.storage.local.get('notes')).notes.notes.find((n) => n.title === 'Gamma')
        .pinned === true,
  )
  await openMenu('Beta')
  await runAction(0)
  await waitForAsync(
    page,
    async () =>
      !(await chrome.storage.local.get('notes')).notes.notes.find((n) => n.title === 'Beta').pinned,
  )
  assert.equal((await stored()).find((n) => n.title === 'Gamma').pinned, true)
  console.log('PASS: shared menu, target switching and pin/unpin')

  // 当前便签直接进入编辑；再次编辑不能清空正在输入的草稿。
  await item('Gamma').click()
  await page.locator('.note-editor-frame .editor').waitFor()
  assert.equal(await page.locator('.note-actions button').count(), 2)
  await openMenu('Gamma')
  await runAction(1)
  await page.locator('.note-actions button').nth(2).waitFor()
  await page.locator('.note-actions button').nth(1).click()
  const body = page.locator('.note-content-container textarea')
  await body.fill('Unsaved Gamma')
  await openMenu('Gamma')
  await runAction(1)
  assert.equal(await body.inputValue(), 'Unsaved Gamma')

  // 编辑另一条必须先处理未保存内容，关闭确认框应保留原草稿。
  await openMenu('Alpha')
  await runAction(1)
  const unsaved = page.locator('.el-message-box')
  await unsaved.waitFor()
  await unsaved.locator('.el-message-box__headerbtn').click()
  await unsaved.waitFor({ state: 'hidden' })
  assert.equal(await body.inputValue(), 'Unsaved Gamma')
  await openMenu('Alpha')
  await runAction(1)
  await unsaved.waitFor()
  await unsaved.locator('.el-button:not(.el-button--primary)').click()
  await unsaved.waitFor({ state: 'hidden' })
  await page.locator('.note-title').filter({ hasText: 'Alpha' }).waitFor()
  assert.equal(await page.locator('.note-actions button').count(), 3)
  assert.ok((await page.locator('.note-editor-frame').textContent()).includes('Body Alpha'))
  console.log('PASS: direct edit and unsaved draft protection')

  // 取消删除保留便签，确认只删目标，删除当前便签回到空闲视图。
  await confirmDeletion('Beta', false)
  assert.ok((await stored()).some((n) => n.title === 'Beta'))
  await confirmDeletion('Beta', true)
  await item('Beta').waitFor({ state: 'hidden' })
  assert.ok(!(await stored()).some((n) => n.title === 'Beta'))
  assert.equal((await page.locator('.note-title').textContent()).trim(), 'Alpha')
  await confirmDeletion('Alpha', true)
  await page.locator('.note-empty-state').waitFor()
  assert.ok(!(await stored()).some((n) => n.title === 'Alpha'))
  console.log('PASS: target deletion and cancel')

  // 弹窗拖动和窄屏边缘的菜单必须可见，点击外部、滚动或关闭弹窗均收起。
  const header = await page.locator('.note-header').boundingBox()
  await page.mouse.move(header.x + 150, header.y + 20)
  await page.mouse.down()
  await page.mouse.move(header.x + 320, header.y + 120, { steps: 8 })
  await page.mouse.up()
  await openMenu('Gamma')
  const draggedBounds = await menu.boundingBox()
  assert.ok(draggedBounds.x >= 0 && draggedBounds.x + draggedBounds.width <= 1100)
  assert.ok(draggedBounds.y >= 0 && draggedBounds.y + draggedBounds.height <= 900)
  await page.locator('.note-header .base-dialog-title').click()
  await menu.waitFor({ state: 'hidden' })
  await openMenu('Gamma')
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'hidden' })
  assert.equal(await page.locator('.note__dialog').isVisible(), true)
  await openMenu('Gamma')
  await page.locator('.note-aside .el-scrollbar__wrap').evaluate((el) => {
    el.scrollTop = 150
  })
  await menu.waitFor({ state: 'hidden' })
  const movedHeader = await page.locator('.note-header').boundingBox()
  await page.mouse.move(movedHeader.x + 150, movedHeader.y + 20)
  await page.mouse.down()
  await page.mouse.move(header.x + 150, header.y + 20, { steps: 8 })
  await page.mouse.up()
  await page.setViewportSize({ width: 340, height: 620 })
  await page.locator('.note__dialog.is-compact').waitFor()
  await item('Gamma').scrollIntoViewIfNeeded()
  const target = await item('Gamma').boundingBox()
  await openMenu('Gamma', { x: target.width - 20, y: target.height / 2 })
  await page.waitForFunction(() => {
    const popup = document.querySelector('.note-context-menu')
    if (!popup) return false
    const bounds = popup.getBoundingClientRect()
    return (
      bounds.x >= 0 &&
      bounds.y >= 0 &&
      bounds.right <= innerWidth + 1 &&
      bounds.bottom <= innerHeight + 1
    )
  })
  await runAction(1)
  await page.locator('.note-actions button').nth(2).waitFor()
  assert.equal(await page.locator('.note-aside-wrapper').count(), 0, '窄屏编辑直接进入正文')
  await page.locator('.note-back-btn').click()
  await openMenu('Gamma')
  await page.locator('.note-header .base-dialog-close-btn').click()
  await page.locator('.note__dialog').waitFor({ state: 'hidden' })
  await menu.waitFor({ state: 'hidden' })
  const appLink = page.locator('.quick-links__item-link[aria-label="QA Notes"]')
  await appLink.click({ button: 'right' })
  const appMenu = page.locator('.el-dropdown__popper:visible')
  const language = await page.locator('html').getAttribute('lang')
  const translation = JSON.parse(await readFile(`locales/${language}/newtab.json`, 'utf8'))
  assert.equal(
    (await appMenu.locator('.el-dropdown-menu__item').last().textContent()).trim(),
    translation.quickLinks.hide,
  )
  await appMenu.locator('.el-dropdown-menu__item').last().click()
  await appLink.waitFor({ state: 'hidden' })
  await waitForAsync(
    page,
    async () => (await chrome.storage.local.get('quickLinks')).quickLinks.items.length === 0,
  )
  assert.equal(
    await worker.evaluate(
      async () => (await chrome.storage.local.get('quickLinks')).quickLinks.items.length,
    ),
    0,
  )
  assert.ok((await stored()).some((note) => note.title === 'Gamma'), '隐藏入口保留便签数据')
  const hiddenMessage = page
    .locator('.el-message--success')
    .filter({ hasText: translation.builtinApps.hidden })
  await hiddenMessage.waitFor()
  await hiddenMessage.locator('span').filter({ hasText: translation.common.undo }).click()
  await appLink.waitFor()
  await waitForAsync(
    page,
    async () => (await chrome.storage.local.get('quickLinks')).quickLinks.items[0]?.appId === 'note',
  )
  console.log('PASS: hiding app keeps notes; localized label and toast; undo restores the shortcut')
  assert.deepEqual(errors, [])
  console.log(
    'PASS: one shared menu; target switching; pin/unpin; direct edit and draft protection; delete/cancel; dragged and compact placement; outside/scroll/dialog dismissal; no page errors',
  )
} finally {
  await context.close()
}
