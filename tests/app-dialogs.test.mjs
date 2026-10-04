import assert from 'node:assert/strict'
import test from 'node:test'

import { createAppDialogs } from '../entrypoints/newtab/composables/appDialogs.ts'

test('启动时无弹窗状态；打开幂等、允许嵌套打开，关闭保留挂载标记', () => {
  const dialogs = createAppDialogs()
  assert.deepEqual(Object.keys(dialogs.states), [])
  dialogs.close('note')
  assert.deepEqual(Object.keys(dialogs.states), [])
  dialogs.open('settings')
  dialogs.open('settings')
  dialogs.open('background')
  assert.equal(dialogs.states.settings.visible, true)
  assert.equal(dialogs.states.background.visible, true)
  dialogs.close('background')
  assert.equal(dialogs.states.background.visible, false)
  assert.equal(dialogs.states.settings.visible, true)
  assert.equal(Object.hasOwn(dialogs.states, 'background'), true)
  assert.deepEqual(Object.keys(createAppDialogs().states), [])
})

test('编辑和新增共用一个实例，但每次唤起传入新的请求', () => {
  const dialogs = createAppDialogs()
  dialogs.open('quickLink', { mode: 'edit', target: { groupId: 'g', index: 0 } })
  const first = dialogs.quickLink.request
  dialogs.close('quickLink')
  dialogs.open('quickLink', { mode: 'add', groupId: 'other' })
  assert.notEqual(dialogs.quickLink.request, first)
  assert.deepEqual(dialogs.quickLink.request, { mode: 'add', groupId: 'other' })
  assert.equal(dialogs.states.quickLink.visible, true)
})
