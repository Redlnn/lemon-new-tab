import type { UploadProps, UploadRequestOptions } from 'element-plus'
import { useTranslation } from 'i18next-vue'

import { isImageFile } from '@/shared/media'

const DEFAULT_WARN_SIZE_KB = 1024

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B'
  const unit = 1024
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(unit)), units.length - 1)
  return `${parseFloat((bytes / Math.pow(unit, index)).toFixed(2))} ${units[index]}`
}

export function useFaviconUpload(options?: { maxKB?: number }) {
  const { t } = useTranslation()
  const warnSizeKB = options?.maxKB ?? DEFAULT_WARN_SIZE_KB

  const isSvg = (file: Blob) => file.type.endsWith('svg+xml')

  const beforeFaviconUpload: UploadProps['beforeUpload'] = async (rawFile) => {
    if (!isImageFile(rawFile, ['image/x-icon', 'image/svg+xml'])) {
      ElMessage.error(t('settings:background.warning.fileIsNotImage'))
      return false
    }
    if (rawFile.size / 1024 > warnSizeKB) {
      try {
        await ElMessageBox.confirm(
          t('common.tooLargeImageConfirm', { size: formatBytes(rawFile.size) }),
          t('common.warning'),
          { type: 'warning' },
        )
      } catch {
        return false
      }
    }
    return true
  }

  const fileToBase64 = async (file: File): Promise<string> => {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onloadend = () => {
        try {
          let res = reader.result as string
          if (res.startsWith('data:image/svg+xml')) {
            // 使用 TextEncoder 将 UTF-8 字符串转为字节，再进行 base64 编码
            const encoder = new TextEncoder()
            const bytes = encoder.encode(res)
            const CHUNK = 0x8000
            let binary = ''
            for (let i = 0; i < bytes.length; i += CHUNK) {
              const slice = bytes.subarray(i, i + CHUNK)
              // Array.prototype.slice.call 转为普通数组以兼容 apply
              const nums = Array.prototype.slice.call(slice) as number[]
              binary += String.fromCharCode.apply(null, nums)
            }
            res = `data:image/svg+xml;base64,${btoa(binary)}`
          }
          resolve(res)
        } catch (e) {
          reject(e)
        }
      }
      reader.onerror = reject
    })
  }

  const httpRequest = async (option: UploadRequestOptions, onDone: (base64: string) => void) => {
    const base64 = await fileToBase64(option.file as File)
    onDone(base64)
  }

  return { beforeFaviconUpload, fileToBase64, httpRequest, isSvg }
}
