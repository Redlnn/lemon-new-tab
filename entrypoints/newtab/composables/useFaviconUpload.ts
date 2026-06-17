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
        if (typeof reader.result === 'string') {
          resolve(reader.result)
        } else {
          reject(new Error('Failed to read favicon file'))
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
