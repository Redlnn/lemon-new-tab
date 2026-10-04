import assert from 'node:assert/strict'
import test from 'node:test'

import { defaultSettings } from '../shared/settings/default.ts'
import {
  applySyncSettings,
  normalizeRemoteSyncSettings,
} from '../shared/webdavSync/settingsWhitelist.ts'

test('同步设置合并保留本机字段和未携带字段，结果不与输入共享可写对象', () => {
  const local = structuredClone(defaultSettings)
  local.background.online.url = 'https://local.test/wallpaper.jpg'
  const incoming = { clock: { size: 72 }, search: { hiddenBuiltInEngines: ['bing'] } }
  const savedLocal = structuredClone(local)
  const savedIncoming = structuredClone(incoming)
  const merged = applySyncSettings(local, incoming)
  assert.equal(merged.clock.size, 72)
  assert.equal(merged.clock.showDate, local.clock.showDate)
  assert.equal(merged.background.online.url, local.background.online.url)
  merged.clock.size = 60
  merged.search.hiddenBuiltInEngines.push('google')
  assert.deepEqual(local, savedLocal)
  assert.deepEqual(incoming, savedIncoming)
})

test('旧远端缺失字段沿用基线，未知字段和本机专用字段不能进入同步结果', () => {
  const baseline = { clock: { size: 72, showDate: false } }
  const result = normalizeRemoteSyncSettings(baseline, {
    clock: { showDate: true, unknown: 'ignore' },
    background: { online: { url: 'https://remote.test/' } },
  })
  assert.equal(result.clock.size, 72)
  assert.equal(result.clock.showDate, true)
  assert.equal(Object.hasOwn(result.clock, 'unknown'), false)
  assert.equal(result.background?.online?.url, undefined)
})
