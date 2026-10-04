import assert from 'node:assert/strict'
import test from 'node:test'

import { deduplicateInlineImages } from '../shared/webdavSync/capture.ts'

test('相同快捷链接/搜索引擎图标只哈希一次，并共享同一份内容', async (t) => {
  const digest = crypto.subtle.digest
  const spy = t.mock.method(crypto.subtle, 'digest', function (...args) {
    return digest.apply(this, args)
  })
  const icon = 'data:image/png;base64,AQID'
  const snapshot = {
    scope: {},
    quickLinks: { items: [{ id: 'link', favicon: icon }] },
    customSearchEngines: { items: [{ id: 'engine', icon }] },
  }
  assert.deepEqual(await deduplicateInlineImages(snapshot), [])
  const link = snapshot.quickLinks.items[0],
    engine = snapshot.customSearchEngines.items[0]
  assert.equal(link.faviconHash, engine.iconHash)
  assert.equal(snapshot.inlineImages[link.faviconHash], icon)
  assert.equal(Object.keys(snapshot.inlineImages).length, 1)
  assert.equal('favicon' in link, false)
  assert.equal('icon' in engine, false)
  assert.equal(spy.mock.callCount(), 1)
})
