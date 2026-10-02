import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { getTimePeriod } from '../entrypoints/newtab/shared/timePeriod.ts'

const periods = [
  'lateNight',
  'lateNight',
  ...Array(5).fill('dawn'),
  ...Array(4).fill('morning'),
  ...Array(3).fill('noon'),
  ...Array(3).fill('afternoon'),
  ...Array(2).fill('dusk'),
  ...Array(4).fill('evening'),
  'lateNight',
]

assert.equal(periods.length, 24)
for (const [hour, period] of periods.entries()) {
  assert.equal(getTimePeriod(hour), period, `Unexpected greeting period at ${hour}:00`)
}

for (const language of ['en', 'tr-TR', 'zh-CN', 'zh-HK', 'zh-TW']) {
  const newtab = JSON.parse(await readFile(`locales/${language}/newtab.json`, 'utf8'))
  const settings = JSON.parse(await readFile(`locales/${language}/settings.json`, 'utf8'))
  for (const period of new Set(periods)) {
    assert.ok(newtab.notification.greeting[period]?.trim(), `${language}: ${period}`)
  }
  assert.ok(settings.other.greeting.label?.trim(), `${language}: setting label`)
  assert.ok(settings.other.greeting.description?.trim(), `${language}: setting description`)
}
