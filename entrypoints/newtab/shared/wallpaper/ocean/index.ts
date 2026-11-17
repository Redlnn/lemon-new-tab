import whale from '@newtab/assets/ocean/whale.webp'

import { createDynamicScene } from '../meadow/meadowScene'

import { createOceanMotion } from './oceanMotion'
import { oceanShader } from './oceanShader'
import { createOceanWake } from './oceanWake'
import { createOceanWhaleTexture } from './oceanWhale'

export function createOceanRenderer(canvas: HTMLCanvasElement, disableEntrance = false) {
  return createDynamicScene(
    canvas,
    {
      ocean: {
        whale,
        shader: oceanShader,
        createMotion: createOceanMotion,
        createWake: createOceanWake,
        createWhaleTexture: createOceanWhaleTexture,
      },
    },
    disableEntrance,
  )
}
