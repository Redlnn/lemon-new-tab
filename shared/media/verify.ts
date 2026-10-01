const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/apng',
  'image/avif',
  'image/bmp',
  'image/tiff',
]

/**
 * 检查文件是否为有效的图片文件
 * @param file - 要检查的文件
 * @param extraTypes - 额外允许的MIME类型数组
 * @returns 是否为有效的图片文件
 */
export function isImageFile(file: Blob, extraTypes: string[] = []): boolean {
  const allowedTypes = new Set([...ALLOWED_IMAGE_TYPES, ...extraTypes])
  return allowedTypes.has(file.type)
}
