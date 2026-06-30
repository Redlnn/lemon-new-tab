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

const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']

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

/**
 * 检查文件是否为视频文件
 */
export function isVideoFile(file: Blob, extraTypes: string[] = []): boolean {
  const allowedTypes = new Set([...ALLOWED_VIDEO_TYPES, ...extraTypes])
  return allowedTypes.has(file.type)
}

/**
 * 检查是否为支持的媒体文件（图片或视频）
 */
export function isMediaFile(file: Blob): boolean {
  return isImageFile(file) || isVideoFile(file)
}
