import { mkdtemp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
// examples/ -> extension-browser-debugging/ -> skills/ -> .agents/ -> project root
const projectRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const profileRoot = await mkdtemp(join(tmpdir(), 'lemon-extension-qa-'))
const extension = join(projectRoot, '.output', 'chrome-mv3')

if (!process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE)
  throw new Error('Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to a Chromium executable')

console.log(`Extension: ${extension}`)
console.log(`Temporary profile and screenshots: ${profileRoot}`)

const context = await chromium.launchPersistentContext(join(profileRoot, 'profile'), {
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  viewport: { width: 1100, height: 900 },
})

try {
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'))
  const newtabUrl = new URL('newtab.html', worker.url()).href
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto(newtabUrl)
  // 将这里替换为本项目当前稳定的初始化标志或可访问名称。
  await page.getByRole('button', { name: '打开页面操作菜单' }).waitFor()

  // 示例：通过真实扩展页面执行用户交互。
  await page.getByRole('button', { name: '打开页面操作菜单' }).click()
  console.log('Page menu opened', { extensionId: new URL(newtabUrl).host })

  await page.screenshot({ path: join(profileRoot, 'newtab.png') })
  if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`)
} finally {
  await context.close()
}
