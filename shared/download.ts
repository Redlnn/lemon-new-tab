export function downloadBlob(blob: Blob, filename: string, options?: { target?: string }) {
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = filename
  if (options?.target) a.target = options.target

  a.click()

  URL.revokeObjectURL(url)
}

export function downloadJSON<T>(obj: T, filename: string) {
  const jsonStr = JSON.stringify(obj, null, 2)
  const blob = new Blob([jsonStr], { type: 'application/json' })
  downloadBlob(blob, filename)
}
