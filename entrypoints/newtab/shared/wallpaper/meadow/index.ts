import boyBackFrames from '@newtab/assets/meadow/boy-back-frames.webp'
import boyFrontFrames from '@newtab/assets/meadow/boy-front-frames.webp'
import boyRun from '@newtab/assets/meadow/boy-run.webp'
import boy from '@newtab/assets/meadow/boy.webp'
import catCalico from '@newtab/assets/meadow/cat-calico.webp'
import catRagdoll from '@newtab/assets/meadow/cat-ragdoll.webp'
import catWhite from '@newtab/assets/meadow/cat-white.webp'
import cat from '@newtab/assets/meadow/cat.webp'

import { createMeadowScene } from './meadowScene'

export function createMeadowRenderer(canvas: HTMLCanvasElement) {
  return createMeadowScene(canvas, {
    boy,
    boyRun,
    boyFrontFrames,
    boyBackFrames,
    cats: [cat, catWhite, catCalico, catRagdoll],
  })
}
