function parseMajorMinor(value: string): [number, number] | null {
  const [majorStr, minorStr] = value.split('.')
  if (majorStr == null || minorStr == null) return null
  const major = Number(majorStr)
  const minor = Number(minorStr)
  if (Number.isNaN(major) || Number.isNaN(minor)) return null
  return [major, minor]
}

export function shouldShowChangelog(previousVersion: string, nextVersion: string): boolean {
  const nextMajorMinor = parseMajorMinor(nextVersion)
  if (!nextMajorMinor) return false
  const previousMajorMinor = parseMajorMinor(previousVersion)
  if (!previousMajorMinor) return true
  if (previousMajorMinor[0] < nextMajorMinor[0]) return true
  if (previousMajorMinor[0] > nextMajorMinor[0]) return false
  return previousMajorMinor[1] < nextMajorMinor[1]
}
