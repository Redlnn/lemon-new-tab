import assert from 'node:assert/strict'
import test from 'node:test'

import { createTaskScope } from '../shared/taskScope.ts'

test('并行读取全部结束才解除忙碌，不受完成顺序影响', async () => {
  for (const first of [0, 1]) {
    let busy = false
    const scope = createTaskScope((value) => {
      busy = value
    }, assert.fail)
    const jobs = [Promise.withResolvers(), Promise.withResolvers()]
    const tasks = jobs.map((job) => scope.run(() => job.promise))
    jobs[first].resolve()
    await tasks[first]
    assert.equal(busy, true)
    jobs[1 - first].resolve()
    await tasks[1 - first]
    assert.equal(busy, false)
  }
})

test('关闭并重开后旧请求不回填、不报错、不解除新请求的忙碌；已开始的工作仍完成', async () => {
  let busy = false
  let completed = false
  const applied = [],
    errors = []
  const scope = createTaskScope(
    (value) => {
      busy = value
    },
    (error) => errors.push(error),
  )
  const old = Promise.withResolvers(),
    failed = Promise.withResolvers(),
    current = Promise.withResolvers()
  const oldTask = scope.run(
    async () => {
      await old.promise
      completed = true
      return 'old'
    },
    (value) => applied.push(value),
  )
  const failedTask = scope.run(() => failed.promise)
  scope.reset()
  const newTask = scope.run(
    () => current.promise,
    (value) => applied.push(value),
  )
  old.resolve()
  failed.reject(new Error('late'))
  await Promise.all([oldTask, failedTask])
  assert.equal(completed, true)
  assert.equal(busy, true)
  assert.deepEqual(applied, [])
  assert.deepEqual(errors, [])
  current.resolve('new')
  await newTask
  assert.deepEqual(applied, ['new'])
  assert.equal(busy, false)
})
