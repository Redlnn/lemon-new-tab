/// <reference lib="webworker" />

import {
  hexFromArgb,
  Scheme,
  sourceColorFromImageBytes,
  themeFromSourceColor,
} from '@material/material-color-utilities'

import { mixLegacy } from '@/shared/theme/mix'
import { BLACK_COLOR, EL_BG_COLOR_RGBA, WHITE_COLOR } from '@/shared/theme/token'
import { rgba2Hex } from '@/shared/theme/utils'

import { rgbaFromArgb } from './helper'

function buildColorShades(base: Rgba, lightMix: Rgba, darkMix: Rgba) {
  return {
    3: rgba2Hex(mixLegacy(base, lightMix, 70)),
    5: rgba2Hex(mixLegacy(base, lightMix, 50)),
    7: rgba2Hex(mixLegacy(base, lightMix, 30)),
    8: rgba2Hex(mixLegacy(base, lightMix, 20)),
    9: rgba2Hex(mixLegacy(base, lightMix, 10)),
    dark2: rgba2Hex(mixLegacy(base, darkMix, 70)),
  }
}

/** 生成变量表 */
function buildCssVars(scheme: Scheme, mode: 'light' | 'dark') {
  const textMix = mode === 'light' ? WHITE_COLOR : EL_BG_COLOR_RGBA
  const darkMix = mode === 'light' ? BLACK_COLOR : WHITE_COLOR

  const pHex = hexFromArgb(scheme.primary)
  const sHex = hexFromArgb(scheme.tertiary)
  const eHex = hexFromArgb(scheme.error)
  const iHex = hexFromArgb(scheme.secondary)

  const primary = rgbaFromArgb(scheme.primary)
  const success = rgbaFromArgb(scheme.tertiary)
  const error = rgbaFromArgb(scheme.error)
  const info = rgbaFromArgb(scheme.secondary)

  const pShades = buildColorShades(primary, textMix, darkMix)
  const sShades = buildColorShades(success, textMix, darkMix)
  const eShades = buildColorShades(error, textMix, darkMix)
  const iShades = buildColorShades(info, textMix, darkMix)

  return {
    '--el-color-primary': pHex,
    '--el-color-primary-light-3': pShades[3],
    '--el-color-primary-light-5': pShades[5],
    '--el-color-primary-light-7': pShades[7],
    '--el-color-primary-light-8': pShades[8],
    '--el-color-primary-light-9': pShades[9],
    '--el-color-primary-dark-2': pShades.dark2,

    '--el-color-success': sHex,
    '--el-color-success-light-3': sShades[3],
    '--el-color-success-light-5': sShades[5],
    '--el-color-success-light-7': sShades[7],
    '--el-color-success-light-8': sShades[8],
    '--el-color-success-light-9': sShades[9],
    '--el-color-success-dark-2': sShades.dark2,

    '--el-color-warning': mode === 'light' ? '#835500' : '#ffb955',
    '--el-color-warning-light-3': mode === 'light' ? '#a8884d' : '#bc8b45',
    '--el-color-warning-light-5': mode === 'light' ? '#c1aa80' : '#8f6c3a',
    '--el-color-warning-light-7': mode === 'light' ? '#daccb3' : '#624d2f',
    '--el-color-warning-light-8': mode === 'light' ? '#e6ddcc' : '#4c3e2a',
    '--el-color-warning-light-9': mode === 'light' ? '#f3eee6' : '#352e24',
    '--el-color-warning-dark-2': mode === 'light' ? '#5c3b00' : '#ffce88',

    '--el-color-danger': eHex,
    '--el-color-danger-light-3': eShades[3],
    '--el-color-danger-light-5': eShades[5],
    '--el-color-danger-light-7': eShades[7],
    '--el-color-danger-light-8': eShades[8],
    '--el-color-danger-light-9': eShades[9],
    '--el-color-danger-dark-2': eShades.dark2,

    '--el-color-error': eHex,
    '--el-color-error-light-3': eShades[3],
    '--el-color-error-light-5': eShades[5],
    '--el-color-error-light-7': eShades[7],
    '--el-color-error-light-8': eShades[8],
    '--el-color-error-light-9': eShades[9],
    '--el-color-error-dark-2': eShades.dark2,

    '--el-color-info': iHex,
    '--el-color-info-light-3': iShades[3],
    '--el-color-info-light-5': iShades[5],
    '--el-color-info-light-7': iShades[7],
    '--el-color-info-light-8': iShades[8],
    '--el-color-info-light-9': iShades[9],
    '--el-color-info-dark-2': iShades.dark2,

    '--el-bg-color': hexFromArgb(scheme.surface),
    '--el-bg-color-page': hexFromArgb(scheme.background),
    '--el-bg-color-overlay': hexFromArgb(scheme.surface),

    '--el-text-color-primary': hexFromArgb(scheme.onSurface),
    '--el-text-color-regular': hexFromArgb(scheme.onSurfaceVariant),
    '--el-text-color-secondary': rgba2Hex(
      mixLegacy(rgbaFromArgb(scheme.onSurfaceVariant), textMix, 60),
    ),
  }
}

self.onmessage = (
  e: MessageEvent<{ id: number; imageBitmap: ImageBitmap; width: number; height: number }>,
) => {
  const { id, imageBitmap, width, height } = e.data

  try {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get OffscreenCanvas context')

    ctx.drawImage(imageBitmap, 0, 0)
    const imageData = ctx.getImageData(0, 0, width, height).data

    const top = sourceColorFromImageBytes(imageData)

    const theme = themeFromSourceColor(top)
    const cssLight = buildCssVars(theme.schemes.light, 'light')
    const cssDark = buildCssVars(theme.schemes.dark, 'dark')

    self.postMessage({ id, cssLight, cssDark })
  } catch (error) {
    self.postMessage({ id, error: String(error) })
  } finally {
    imageBitmap.close()
  }
}
