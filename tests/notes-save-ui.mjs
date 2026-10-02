import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { waitForAsync } from './waitForAsync.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const extension = resolve('.output/chrome-mv3')
const context = await chromium.launchPersistentContext(
  await mkdtemp(join(tmpdir(), 'lemon-note-save-')),
  {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1100, height: 900 },
  },
)
try {
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'))
  const base = {
    id: crypto.randomUUID(),
    title: 'base title',
    markdown: 'base body',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await worker.evaluate((note) => chrome.storage.local.set({ notes: { notes: [note] } }), base)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(new URL('newtab.html', worker.url()).href)
  await page.locator('.quick-links').first().waitFor()
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('lemon-new-tab:open-built-in-app', { detail: 'note' })),
  )
  await page.locator('.note-aside-item').click()
  await page.locator('.note-actions button').nth(1).click()
  await page.locator('.note-actions button').nth(1).click()
  const body = page.locator('.note-content-container textarea')
  // 干净草稿跟随另一页面/同步写入。
  await worker.evaluate(
    (note) =>
      chrome.storage.local.set({
        notes: { notes: [{ ...note, markdown: 'external clean body' }] },
      }),
    base,
  )
  await page.waitForFunction(
    () =>
      document.querySelector('.note-content-container textarea')?.value === 'external clean body',
  )
  await body.fill('local dirty body')
  await worker.evaluate(
    (note) =>
      chrome.storage.local.set({
        notes: { notes: [{ ...note, title: 'external title', markdown: 'external clean body' }] },
      }),
    base,
  )
  await page.locator('.note-aside-title').filter({ hasText: 'external title' }).waitFor()
  await page.locator('.note-actions button').nth(2).click()
  await waitForAsync(
    page,
    async () =>
      (await chrome.storage.local.get('notes')).notes.notes[0].markdown === 'local dirty body',
  )
  assert.equal(
    (await worker.evaluate(async () => (await chrome.storage.local.get('notes')).notes.notes[0]))
      .title,
    'external title',
  )
  await page.locator('.note-actions button.is-loading').waitFor({ state: 'hidden' })
  // 标题失焦自动保存不能吞掉同一次点击触发的完整保存。
  await body.fill('body saved with title')
  await page.locator('.note-title').click()
  await page.locator('.note-title-input input').fill('saved together')
  await worker.evaluate(() => {
    globalThis.titleSaveLock = navigator.locks.request(
      'lemon-notes',
      () =>
        new Promise((resolve) => {
          globalThis.releaseTitleSave = resolve
        }),
    )
  })
  await waitForAsync(page, async () =>
    (await navigator.locks.query()).held.some((lock) => lock.name === 'lemon-notes'),
  )
  await page.locator('.note-actions button').nth(2).click({ delay: 100 })
  await waitForAsync(page, async () =>
    (await navigator.locks.query()).pending.some((lock) => lock.name === 'lemon-notes'),
  )
  await worker.evaluate(() => globalThis.releaseTitleSave())
  await waitForAsync(
    page,
    async () => {
      const saved = (await chrome.storage.local.get('notes')).notes.notes[0]
      return saved.title === 'saved together' && saved.markdown === 'body saved with title'
    },
    { timeout: 5000 },
  )
  await page.locator('.note-actions button.is-loading').waitFor({ state: 'hidden' })
  await body.fill('second local edit')
  await worker.evaluate(async () => {
    const data = await chrome.storage.local.get('notes')
    data.notes.notes[0].markdown = 'external conflict'
    await chrome.storage.local.set(data)
  })
  // 自动保存标题也不能推进仍有编辑的正文基线，掩盖正文冲突。
  await page.locator('.note-title').click()
  await page.locator('.note-title-input input').fill('local title')
  await page.locator('.note-title-input input').press('Enter')
  await waitForAsync(
    page,
    async () => (await chrome.storage.local.get('notes')).notes.notes[0].title === 'local title',
  )
  await page.locator('.note-actions button.is-loading').waitFor({ state: 'hidden' })
  await page.locator('.note-actions button').nth(2).click()
  await page.locator('.el-message--error').waitFor()
  assert.equal(await body.inputValue(), 'second local edit')
  assert.equal(
    (await worker.evaluate(async () => (await chrome.storage.local.get('notes')).notes.notes[0]))
      .markdown,
    'external conflict',
  )
  await worker.evaluate(() => chrome.storage.local.set({ notes: { notes: [] } }))
  await page.locator('.note-list-empty').waitFor()
  await page.locator('.note-actions button').nth(2).click()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.el-message--error')].some((el) =>
      /deleted|删除|刪除|silindi/.test(el.textContent),
    ),
  )
  assert.equal(await body.inputValue(), 'second local edit')
  assert.equal(
    (await worker.evaluate(async () => (await chrome.storage.local.get('notes')).notes.notes))
      .length,
    0,
  )
  // 注入写锁失败，覆盖“离开前保存”分支，确认弹窗和草稿均保留。
  await page.evaluate(() => {
    const request = navigator.locks.request.bind(navigator.locks)
    navigator.locks.request = (...args) =>
      args[0] === 'lemon-notes'
        ? Promise.reject(new Error('Injected write failure'))
        : request(...args)
  })
  await page.locator('.note-header .base-dialog-close-btn').click()
  await page.locator('.el-message-box__btns .el-button--primary').click()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.el-message--error')].some((el) =>
      /Unable to save|无法保存|無法儲存|kaydedilemedi/.test(el.textContent),
    ),
  )
  assert.equal(await page.locator('.note__dialog').isVisible(), true)
  assert.equal(await body.inputValue(), 'second local edit')
  // 总量超限必须在写入前拒绝，而不是等 WebDAV 或备份失败。
  const sizePage = await context.newPage()
  sizePage.on('pageerror', (error) => errors.push(error.message))
  await worker.evaluate(async () => {
    const now = new Date().toISOString()
    const notes = Array.from({ length: 6 }, (_, i) => ({
      id: crypto.randomUUID(),
      title: `Large note ${i}`,
      markdown: 'a'.repeat(1024 * 1024 - 1024),
      createdAt: now,
      updatedAt: now,
    }))
    const items = Array.from({ length: 3 }, (_, i) => ({
      id: crypto.randomUUID(),
      title: `Icon ${i}`,
      url: `https://example.com/${i}`,
      favicon: 'data:image/png;base64,' + String(i).repeat(1024 * 1024 + 2500),
      faviconSource: 'user-selected',
    }))
    await chrome.storage.local.set({ notes: { notes }, quickLinks: { items, groups: [] } })
  })
  await sizePage.goto(new URL('newtab.html', worker.url()).href)
  await sizePage.locator('.quick-links').first().waitFor()
  // 初次读取便签尚未完成时，创建的草稿不能被异步 load 重置。
  await worker.evaluate(
    () =>
      new Promise((ready) => {
        void navigator.locks.request('lemon-notes', () => {
          ready()
          return new Promise((release) => {
            globalThis.qaReleaseNoteRead = release
          })
        })
      }),
  )
  await sizePage.evaluate(() =>
    window.dispatchEvent(new CustomEvent('lemon-new-tab:open-built-in-app', { detail: 'note' })),
  )
  await sizePage.locator('.note-create').click()
  await sizePage.locator('.note-title-input input').fill('Budget test')
  await worker.evaluate(() => globalThis.qaReleaseNoteRead())
  await sizePage.locator('.note-aside-item').nth(5).waitFor()
  assert.equal(await sizePage.locator('.note-title-input input').inputValue(), 'Budget test')
  await sizePage.locator('.note-title-input input').press('Enter')
  await sizePage.locator('.note-actions button').nth(1).click()
  const largeBody = 'b'.repeat(1024 * 1024 - 1024)
  await sizePage.locator('.note-content-container textarea').fill(largeBody)
  await sizePage.locator('.note-actions button').nth(2).click()
  await sizePage.waitForFunction(() =>
    [...document.querySelectorAll('.el-message--error')].some((el) =>
      el.textContent.includes('10 MiB'),
    ),
  )
  assert.equal(
    (await worker.evaluate(async () => (await chrome.storage.local.get('notes')).notes.notes))
      .length,
    6,
  )
  assert.equal(await sizePage.locator('.note-content-container textarea').inputValue(), largeBody)
  await sizePage.locator('.note-actions button.is-loading').waitFor({ state: 'hidden' })
  await worker.evaluate(() => chrome.storage.local.set({ quickLinks: { items: [], groups: [] } }))
  await sizePage.locator('.note-actions button').nth(2).click()
  await waitForAsync(
    sizePage,
    async () => (await chrome.storage.local.get('notes')).notes.notes.length === 7,
  )
  assert.deepEqual(errors, [])
  console.log(
    'PASS: live refresh; single-click title and body save; field merge and conflicts; deletion; save failure preserves draft; full snapshot size check and retry',
  )
} finally {
  await context.close()
}
