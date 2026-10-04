import assert from 'node:assert/strict'
import test from 'node:test'

import {
  WebDavError,
  serializeWebDavError,
  deserializeWebDavError,
} from '../shared/webdavSync/errors.ts'
import { isWebDavSyncMessage } from '../shared/webdavSync/messages.ts'

test('拒绝非法 scope、残缺连接预览与未验证的冲突选择', () => {
  for (const message of [
    { type: 'webdav-sync:update-preferences', scope: { notes: 'yes' } },
    { type: 'webdav-sync:update-preferences', scope: { password: true } },
    { type: 'webdav-sync:update-preferences', enabled: 'false' },
    { type: 'webdav-sync:preview-connection', input: {} },
    { type: 'webdav-sync:connect', input: {}, expected: {} },
    { type: 'webdav-sync:resolve-conflict', resolutions: [{ choice: 'both', conflictId: 'a' }] },
    { type: 'webdav-sync:resolve-conflict', resolutions: [null] },
    { type: 'toString' },
  ])
    assert.equal(isWebDavSyncMessage(message), false, JSON.stringify(message))
  assert.equal(
    isWebDavSyncMessage({
      type: 'webdav-sync:update-preferences',
      scope: { notes: false },
      enabled: false,
    }),
    true,
  )
  assert.equal(isWebDavSyncMessage({ type: 'webdav-sync:resolve-conflict', resolutions: [] }), true)
  const input = {
    connection: { baseUrl: 'https://example.test/', username: 'user', password: 'secret' },
    rememberPassword: false,
  }
  assert.equal(isWebDavSyncMessage({ type: 'webdav-sync:preview-connection', input }), true)
  assert.equal(
    isWebDavSyncMessage({
      type: 'webdav-sync:connect',
      input,
      expected: { state: 'empty', headRevisionIds: [], localSnapshotHash: 'hash' },
    }),
    true,
  )
})

test('消息错误保留可决策类别但不带出凭据、地址和原始异常文本', () => {
  const safe = serializeWebDavError(
    new WebDavError('authentication', 'https://user:secret@example.test/', 401),
  )
  assert.deepEqual(safe, { category: 'authentication', status: 401 })
  assert.equal(deserializeWebDavError(safe).category, 'authentication')
  assert.deepEqual(serializeWebDavError(new Error('secret')), { category: 'unknown' })
})
