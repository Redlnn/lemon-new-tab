/** @deprecated use BgType instead */
export enum OldBgType {
  none, // 0
  Local, // 1
  Bing, // 2
  Online // 3
}

export const BgType = {
  None: 'none',
  Local: 'local',
  Bing: 'bing',
  Online: 'online'
} as const
export type BgType = (typeof BgType)[keyof typeof BgType]

export const ClockSize = {
  Small: 'small',
  Medium: 'medium',
  Large: 'large',
  EvenLarge: 'even-large',
  ExtraLarge: 'extra-large'
} as const
export type ClockSize = (typeof ClockSize)[keyof typeof ClockSize]

/**
 * - Normal: 400
 * - Medium: 500
 * - Bold: 600
 * - ExtraBold: 700
 * - Heavy: 800
 * - Black: 900
 */
export const ClockWeight = {
  Normal: 'normal',
  Medium: 'medium',
  Bold: 'bold',
  ExtraBold: 'extra-bold',
  Heavy: 'heavy',
  Black: 'black'
} as const
export type ClockWeight = (typeof ClockWeight)[keyof typeof ClockWeight]

export const DrawerDirection = {
  ltr: 'ltr',
  rtl: 'rtl',
  ttb: 'ttb',
  btt: 'btt'
} as const
export type DrawerDirection = (typeof DrawerDirection)[keyof typeof DrawerDirection]

export const SortMode = {
  Original: 'original',
  NameAsc: 'name-asc',
  NameDesc: 'name-desc',
  CreatedAsc: 'created-asc',
  CreatedDesc: 'created-desc',
  ModifiedAsc: 'modified-asc',
  ModifiedDesc: 'modified-desc'
} as const
export type SortMode = (typeof SortMode)[keyof typeof SortMode]
