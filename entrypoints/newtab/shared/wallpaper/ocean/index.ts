import whale from '@newtab/assets/ocean/whale.webp'

import { createMeadowScene } from '../meadow/meadowScene'

import { createOceanMotion } from './oceanMotion'
import { oceanShader } from './oceanShader'
import { createOceanWake } from './oceanWake'
import { createOceanWhaleTexture } from './oceanWhale'

export function createOceanRenderer(canvas: HTMLCanvasElement) {
  return createMeadowScene(canvas, {
    ocean: {
      whale,
      shader: oceanShader,
      createMotion: createOceanMotion,
      createWake: createOceanWake,
      createWhaleTexture: createOceanWhaleTexture,
    },
  })
}
