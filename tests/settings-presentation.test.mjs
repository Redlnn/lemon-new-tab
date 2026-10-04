import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

import { SYNC_SETTING_PATHS } from '../shared/settings/projection.ts'
import { displaySyncDifference } from '../shared/webdavSync/conflictPresentation.ts'

const locales = new URL('../locales/', import.meta.url)
for (const language of readdirSync(locales)) {
  test(`同步字段在 ${language} 中都有有效且具体的标题`, () => {
    const resources = Object.fromEntries(
      ['settings', 'newtab'].map((ns) => [
        ns,
        JSON.parse(readFileSync(new URL(`${language}/${ns}.json`, locales), 'utf8')),
      ]),
    )
    const missing = []
    for (const path of SYNC_SETTING_PATHS) {
      const t = (key) => {
        const [namespace, name] = key.includes(':') ? key.split(':') : ['settings', key]
        const text = name.split('.').reduce((value, part) => value?.[part], resources[namespace])
        if (typeof text !== 'string' || key === 'webdavSync.conflicts.categories.settings')
          missing.push(`${path} → ${key}`)
        return text
      }
      displaySyncDifference(
        { category: 'settings', path: `settings.${path}`, value: true },
        undefined,
        t,
      )
    }
    assert.deepEqual(missing, [])
  })
}
