import { storage } from '#imports'

export interface MonetColors {
  cssLight: Record<string, string>
  cssDark: Record<string, string>
  timestamp: number
  sourceKey?: string
}

// 使用 wxt storage 存储莫奈颜色
export const monetColorsStorage = storage.defineItem<MonetColors | null>('local:monetColors', {
  fallback: null,
})

/**
 * 保存莫奈颜色到 storage
 */
export async function saveMonetColors(
  cssLight: Record<string, string>,
  cssDark: Record<string, string>,
  sourceKey?: string,
) {
  await monetColorsStorage.setValue({
    cssLight,
    cssDark,
    timestamp: Date.now(),
    sourceKey,
  })
}

/**
 * 从 storage 读取莫奈颜色
 */
export async function getMonetColors(): Promise<MonetColors | null> {
  return await monetColorsStorage.getValue()
}

/**
 * 清除存储的莫奈颜色
 */
export async function clearMonetColors() {
  await monetColorsStorage.setValue(null)
}

/**
 * 应用已存储的莫奈颜色到当前页面
 * 适用于 popup 等无法直接从图片提取颜色的场景
 */
export function applyStoredMonetColors(colors: MonetColors | null) {
  const STYLE_ID = 'monet'
  let styleTag = document.getElementById(STYLE_ID) as HTMLStyleElement | null

  if (!colors) {
    // 如果没有颜色数据，移除 monet 样式
    if (styleTag) {
      styleTag.textContent = ''
    }
    return
  }

  if (!styleTag) {
    styleTag = document.createElement('style')
    styleTag.id = STYLE_ID
    styleTag.type = 'text/css'
    document.head.appendChild(styleTag)
  }

  const toCssText = (vars: Record<string, string>) => {
    let result = ''
    for (const k in vars) {
      result += `${k}: ${vars[k]};`
    }
    return result
  }

  styleTag.textContent = `html.monet{${toCssText(colors.cssLight)}}html.dark.monet{${toCssText(colors.cssDark)}}`
}
