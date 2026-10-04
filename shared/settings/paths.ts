import type { CURRENT_CONFIG_SCHEMA } from './current.ts'

type Leaves<T> = {
  [K in keyof T & string]: T[K] extends readonly unknown[]
    ? K
    : T[K] extends object
      ? `${K}.${Leaves<T[K]>}`
      : K
}[keyof T & string]

export type SettingPath = Leaves<CURRENT_CONFIG_SCHEMA>
