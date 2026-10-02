export function getTimePeriod(hours: number) {
  if (hours < 2 || hours >= 23) return 'lateNight'
  if (hours < 7) return 'dawn'
  if (hours < 11) return 'morning'
  if (hours < 14) return 'noon'
  if (hours < 17) return 'afternoon'
  if (hours < 19) return 'dusk'
  return 'evening'
}
