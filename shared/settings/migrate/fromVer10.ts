import type { SettingsSchemaV10, SettingsSchemaV11 } from '..'

export function migrateFromVer10To11(old: SettingsSchemaV10): SettingsSchemaV11 {
  const { shortcut, perf, ...rest } = old
  const { shortcut: perfShortcut, ...restPerf } = perf

  return {
    ...rest,
    quickLinks: shortcut,
    perf: {
      ...restPerf,
      quickLinks: perfShortcut,
    },
    version: 11,
  } satisfies SettingsSchemaV11
}
