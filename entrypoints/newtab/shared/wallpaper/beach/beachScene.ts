import type { CURRENT_CONFIG_SCHEMA } from '@/shared/settings/current'

import { createFieldTextures } from '../dynamic/fieldTextures'
import { snapshotField } from '../dynamic/fieldTransition'
import { createTerrain } from '../dynamic/terrain'
import { canvasViewportSize, setCanvasViewportStyle } from '../dynamic/viewport'
import { createWaterCaustics } from '../dynamic/waterCaustics'

import { createBeachFish } from './beachFish'
import {
  beachRegionsSeparate,
  createBeachIslands,
  shouldRepositionBeachIslands,
  type BeachRect,
} from './beachIslands'
import {
  beachFishFragment,
  beachFishVertex,
  beachFragmentShader,
  beachVertexShader,
} from './beachShaders'

const STEP = 5
type BeachOptions = CURRENT_CONFIG_SCHEMA['background']['beach'] & { night: boolean }
type Field = { s: Float32Array }
type Bounds = { left: number; top: number; width: number; height: number }

export function createBeachScene(
  cv: HTMLCanvasElement,
  treesCanvas: HTMLCanvasElement,
  treeUrls: string[],
  disableEntrance = false,
) {
  const gl = cv.getContext('webgl2', {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  })
  if (!gl) throw new Error('WebGL2 unavailable')
  try {
    return initializeBeachScene(gl, cv, treesCanvas, treeUrls, disableEntrance)
  } catch (error) {
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    throw error
  }
}

function initializeBeachScene(
  gl: WebGL2RenderingContext,
  cv: HTMLCanvasElement,
  treesCanvas: HTMLCanvasElement,
  treeUrls: string[],
  disableEntrance: boolean,
) {
  const P = {
    sigma: 85,
    warp: 34,
    shallow: 260,
    shoal: 110,
    speed: 22,
    runup: 120,
    wave: 1.6,
    spacing: 70,
    waves: 1,
    grain: 1,
    quality: 2,
    palms: 4,
    kayaks: 2,
    birds: 3,
    night: false,
  }
  const treeContext = treesCanvas.getContext('2d')
  if (!treeContext) throw new Error('Canvas 2D unavailable')
  const seed = (Math.random() * 1e6) | 0
  const terrain = createTerrain(
    seed,
    STEP,
    () => P.sigma,
    () => P.warp,
  )
  const { makeNoiseImage, computeField, sampleArr } = terrain
  let W = innerWidth,
    H = innerHeight,
    Gw = 1,
    Gh = 1
  const buildNoise = () => terrain.resize(Gw, Gh)

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('Could not create beach shader')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader) || 'Shader error')
    return shader
  }
  const createProgram = (vertexSource: string, fragmentSource: string) => {
    const vertex = compile(gl.VERTEX_SHADER, vertexSource)
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource)
    const program = gl.createProgram()
    if (!program) throw new Error('Could not create beach program')
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) || 'Shader linking failed')
    const uniforms: Record<string, WebGLUniformLocation> = {}
    for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
      const name = gl.getActiveUniform(program, i)!.name.replace(/\[0\]$/, '')
      uniforms[name] = gl.getUniformLocation(program, name)!
    }
    return { program, uniforms }
  }
  const { program, uniforms } = createProgram(beachVertexShader, beachFragmentShader)
  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  const noise = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, noise)
  const { S, d } = makeNoiseImage()
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, d)
  gl.generateMipmap(gl.TEXTURE_2D)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
  const fieldStorage = createFieldTextures(gl)
  let causticsTexture: WebGLTexture | null = null
  const fieldTextures = fieldStorage.textures
  let current: Field | null = null,
    previous: Field | null = null
  let fromIndex = 0,
    toIndex = 1,
    currentMix = 1,
    transitionStart = 0,
    transitionDuration = 1800,
    sceneTime = 0
  let scale = 1,
    lastBounds = '',
    layoutKey = '',
    lastTime = 0
  let islandViewport: { width: number; height: number } | null = null
  let islands: BeachRect[] = []
  let groups: BeachRect[] = []
  let treesDirty = true
  type Tree = { x: number; y: number; variant: number; mirror: number; size: number }
  let trees: Tree[] = [],
    previousTrees: Tree[] = []
  const kay = new Float32Array(16),
    birds = new Float32Array(32),
    ripples = new Float32Array(24)
  type PalmSprite = {
    image: HTMLImageElement
    shadow: HTMLCanvasElement
    footX: number
    footY: number
    extent: number
  }
  const preparePalm = (image: HTMLImageElement): PalmSprite => {
    const shadow = document.createElement('canvas')
    shadow.width = image.naturalWidth
    shadow.height = image.naturalHeight
    const ctx = shadow.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Could not prepare palm shadow')
    ctx.drawImage(image, 0, 0)
    const { data, width, height } = ctx.getImageData(0, 0, shadow.width, shadow.height)
    let left = width,
      right = -1,
      top = height
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3]! < 180) continue
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
      }
    }
    let bottom = -1
    for (let y = height - 1; y >= 0 && bottom < 0; y--) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3]! >= 180) {
          bottom = y
          break
        }
      }
    }
    let sumX = 0,
      count = 0
    for (let y = Math.max(0, bottom - 3); y <= bottom; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3]! >= 180) {
          sumX += x
          count++
        }
      }
    }
    ctx.globalCompositeOperation = 'source-in'
    ctx.fillStyle = '#456759'
    ctx.fillRect(0, 0, width, height)
    return {
      image,
      shadow,
      footX: count ? sumX / count : width / 2,
      footY: bottom < 0 ? height : bottom + 1,
      extent: bottom < 0 ? Math.max(width, height) : Math.max(right - left + 1, bottom - top + 1),
    }
  }
  const sprites: (PalmSprite | undefined)[] = []
  const images = treeUrls.map((url, index) => {
    const img = new Image()
    img.onload = () => {
      sprites[index] = preparePalm(img)
      treesDirty = true
    }
    img.src = url
    return img
  })
  const agents = Array.from({ length: 12 }, (_, i) => ({
    x: Math.random() * W,
    y: Math.random() * H,
    angle: Math.random() * 6.28,
    phase: Math.random() * 6.28,
    bird: i >= 4,
  }))
  const upload = (index: number, field: Field) => {
    fieldStorage.resize(Gw, Gh)
    fieldStorage.upload(index, field.s)
  }
  const randomForLayout = () => {
    let n = seed
    return () => {
      n = Math.imul(n ^ (n >>> 15), 2246822519)
      n = Math.imul(n ^ (n >>> 13), 3266489917)
      return ((n ^= n >>> 16) >>> 0) / 4294967296
    }
  }
  const setLayout = (
    bounds: Bounds | null,
    reset = false,
    startField?: Field,
    showMainIsland = true,
  ) => {
    const main =
      showMainIsland && bounds
        ? {
            x: bounds.left - bounds.width * 0.05,
            y: bounds.top + Math.min(20, bounds.height * 0.1),
            w: bounds.width * 1.1,
            h: bounds.height - Math.min(20, bounds.height * 0.1),
          }
        : null
    const key = `${W},${H},${main?.x},${main?.y},${main?.w},${main?.h}`
    if (!reset && key === layoutKey) return
    layoutKey = key
    const random = randomForLayout()
    const gap = Math.max(300, (P.sigma * 300) / 85)
    const needsIslands =
      !islandViewport ||
      shouldRepositionBeachIslands(islandViewport, W, H) ||
      (main && islands.some((island) => !beachRegionsSeparate(island, main, gap))) ||
      islands.some((island, i) =>
        islands.slice(i + 1).some((other) => !beachRegionsSeparate(island, other, gap)),
      )
    if (needsIslands) {
      islands = createBeachIslands(W, H, main, random, gap)
      islandViewport = { width: W, height: H }
      // Nearby virtual icons create different, irregular coastlines.
      groups = islands.flatMap((island) => {
        const count = 1 + Math.floor(random() * 3)
        if (count === 1) return [island]
        const horizontal = island.w >= island.h
        return Array.from({ length: count }, (_, i) => {
          const offset = i / (count - 1)
          const w = island.w * (horizontal ? 0.4 + random() * 0.25 : 0.65 + random() * 0.25)
          const h = island.h * (horizontal ? 0.65 + random() * 0.25 : 0.4 + random() * 0.25)
          return {
            x: island.x + (island.w - w) * (horizontal ? offset : random()),
            y: island.y + (island.h - h) * (horizontal ? random() : offset),
            w,
            h,
          }
        })
      })
    }
    const all = main ? [main, ...groups] : groups
    const next = computeField(
      all.map((r) => ({ cx: r.x + r.w / 2, cy: r.y + r.h / 2, hw: r.w / 2 - 4, hh: r.h / 2 - 2 })),
    )
    const firstLayout = !previous || !current
    const before =
      startField ??
      (previous && current
        ? { s: snapshotField(previous.s, current.s, currentMix, Gw, Gh, Gw, Gh, 0, STEP) }
        : computeField([]))
    previous = before
    current = next
    fromIndex = 0
    toIndex = 1
    upload(fromIndex, before)
    upload(toIndex, next)
    currentMix = before === next ? 1 : 0
    transitionStart = firstLayout && disableEntrance ? sceneTime - 2600 : sceneTime
    transitionDuration = firstLayout ? 2600 : 1800
    treesDirty = true
    for (const agent of agents.filter((item) => !item.bird)) {
      if (sampleArr(next.s, agent.x, agent.y) >= 150) continue
      for (let attempt = 0; attempt < 200; attempt++) {
        const x = random() * W,
          y = random() * H
        if (sampleArr(next.s, x, y) < 170) continue
        agent.x = x
        agent.y = y
        break
      }
    }
    previousTrees = currentMix < 1 ? trees : []
    trees = []
    for (let tries = 0; tries < 1800 && trees.length < P.palms; tries++) {
      const x = 30 + random() * (W - 60),
        y = 55 + random() * (H - 90)
      if (sampleArr(next.s, x, y) > -28 || sampleArr(next.s, x, y) < -75) continue
      if (
        main &&
        x > main.x - 50 &&
        x < main.x + main.w + 50 &&
        y > main.y - 50 &&
        y < main.y + main.h + 50
      )
        continue
      if (trees.some((tree) => Math.hypot(tree.x - x, tree.y - y) < 100)) continue
      trees.push({
        x,
        y,
        variant: Math.floor(random() * images.length),
        mirror: random() < 0.5 ? -1 : 1,
        size: 65 + random() * 30,
      })
    }
  }
  const resizeViewport = (trim = false) => {
    const nextScale = Math.min(window.devicePixelRatio || 1, P.quality)
    const { width, height } = canvasViewportSize(cv, nextScale, scale, trim)
    if (cv.style.width && scale === nextScale && cv.width === width && cv.height === height)
      return false
    scale = nextScale
    if (cv.width !== width) cv.width = width
    if (cv.height !== height) cv.height = height
    treesCanvas.width = width
    treesCanvas.height = height
    setCanvasViewportStyle(cv, scale)
    setCanvasViewportStyle(treesCanvas, scale)
    treesDirty = true
    return true
  }
  const resize = (bounds: Bounds | null) => {
    resizeViewport(true)
    const widthCss = window.innerWidth,
      heightCss = window.innerHeight
    if (current && W === widthCss && H === heightCss) return
    const oldWidth = Gw,
      oldHeight = Gh,
      oldFrom = previous,
      oldTo = current,
      oldMix = currentMix
    W = widthCss
    H = heightCss
    Gw = Math.ceil(W / STEP) + 2
    Gh = Math.ceil(H / STEP) + 2
    buildNoise()
    const empty = P.sigma * (Math.sqrt(30) - Math.sqrt(-Math.log(0.35)))
    const oldField =
      oldFrom && oldTo
        ? { s: snapshotField(oldFrom.s, oldTo.s, oldMix, oldWidth, oldHeight, Gw, Gh, empty, STEP) }
        : undefined
    setLayout(bounds, true, oldField)
    lastBounds = ''
  }
  const drawRegion = (
    x: number,
    y: number,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ) => {
    const l = Math.max(0, Math.floor(((x + left) * scale) / 2) * 2)
    const r = Math.min(cv.width, Math.ceil(((x + right) * scale) / 2) * 2)
    const b = Math.max(0, Math.floor((cv.height - (y + bottom) * scale) / 2) * 2)
    const t = Math.min(cv.height, Math.ceil((cv.height - (y + top) * scale) / 2) * 2)
    if (r > l && t > b) {
      gl.scissor(l, b, r - l, t - b)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
  }
  let pendingField: { sigma: number; warp: number; palms: number; since: number } | undefined
  const activeRipples: { x: number; y: number; start: number }[] = []
  const fish = createBeachFish()
  const createFishPass = () => {
    const { program, uniforms } = createProgram(beachFishVertex, beachFishFragment)
    const vao = gl.createVertexArray()
    const buffer = gl.createBuffer()
    if (!vao || !buffer) throw new Error('Could not create beach fish buffers')
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, fish.data.byteLength, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0)
    gl.vertexAttribDivisor(0, 1)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16)
    gl.vertexAttribDivisor(1, 1)
    return { program, uniforms, vao, buffer }
  }
  let fishPass: ReturnType<typeof createFishPass> | undefined

  const drawFish = (count: number, time: number, night: boolean) => {
    if (!count) return
    fishPass ??= createFishPass()
    const { program, uniforms: u, vao, buffer } = fishPass
    gl.useProgram(program)
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, fish.data, 0, count * 5)
    gl.uniform1i(u.uFA!, 1)
    gl.uniform1i(u.uFB!, 2)
    gl.uniform2f(u.uRes!, cv.width / scale, cv.height / scale)
    gl.uniform2f(u.uGrid!, Gw, Gh)
    gl.uniform1f(u.uStep!, STEP)
    gl.uniform1f(u.uMix!, currentMix)
    gl.uniform1f(u.uTime!, time)
    gl.uniform1f(u.uNight!, night ? 1 : 0)
    gl.uniform1f(u.uShoal!, P.shoal)
    gl.enable(gl.BLEND)
    gl.uniform1i(u.uFishShadow!, 1)
    gl.blendFunc(gl.ZERO, gl.SRC_COLOR)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)
    gl.uniform1i(u.uFishShadow!, 0)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)
    gl.disable(gl.BLEND)
  }

  const draw = (time: number, bounds: Bounds | null, options: BeachOptions) => {
    sceneTime = time * 1000
    if (P.night !== options.night) {
      P.night = options.night
      treesDirty = true
    }
    P.shoal = options.shoal
    P.shallow = options.shallow
    P.kayaks = options.kayaks
    P.birds = options.birds
    if (P.sigma !== options.sigma || P.warp !== options.warp || P.palms !== options.palms) {
      if (
        !pendingField ||
        pendingField.sigma !== options.sigma ||
        pendingField.warp !== options.warp ||
        pendingField.palms !== options.palms
      )
        pendingField = {
          sigma: options.sigma,
          warp: options.warp,
          palms: options.palms,
          since: time,
        }
      else if (time - pendingField.since >= 0.18) {
        P.sigma = pendingField.sigma
        P.warp = pendingField.warp
        P.palms = pendingField.palms
        pendingField = undefined
        setLayout(bounds, true, undefined, options.showMainIsland)
      }
    } else pendingField = undefined
    const key = bounds ? `${bounds.left},${bounds.top},${bounds.width},${bounds.height}` : ''
    if (key !== lastBounds) {
      lastBounds = key
      setLayout(bounds, false, undefined, options.showMainIsland)
    }
    if (!current || !previous) return
    const progress = Math.min(Math.max((sceneTime - transitionStart) / transitionDuration, 0), 1)
    currentMix = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2
    const dt = lastTime ? Math.min(time - lastTime, 0.1) : 0
    lastTime = time
    const fromField = previous.s
    const toField = current.s
    const fishCount = fish.update(
      options.fishSchools,
      W,
      H,
      dt,
      (x, y) =>
        sampleArr(fromField, x, y) * (1 - currentMix) + sampleArr(toField, x, y) * currentMix,
    )
    kay.fill(0)
    birds.fill(0)
    agents.forEach((agent, i) => {
      if (agent.bird ? i - 4 >= P.birds : i >= P.kayaks) return
      const margin = 70
      const aheadX = agent.x + Math.cos(agent.angle) * 100,
        aheadY = agent.y + Math.sin(agent.angle) * 100
      if (
        aheadX < margin ||
        aheadX > W - margin ||
        aheadY < margin ||
        aheadY > H - margin ||
        (!agent.bird && sampleArr(current!.s, aheadX, aheadY) < 150)
      ) {
        const gx = agent.bird
          ? W / 2 - agent.x
          : sampleArr(current!.s, agent.x + 12, agent.y) -
            sampleArr(current!.s, agent.x - 12, agent.y) +
            (W / 2 - agent.x) * 0.015
        const gy = agent.bird
          ? H / 2 - agent.y
          : sampleArr(current!.s, agent.x, agent.y + 12) -
            sampleArr(current!.s, agent.x, agent.y - 12) +
            (H / 2 - agent.y) * 0.015
        const delta = Math.atan2(
          Math.sin(Math.atan2(gy, gx) - agent.angle),
          Math.cos(Math.atan2(gy, gx) - agent.angle),
        )
        agent.angle += Math.sign(delta) * Math.min(Math.abs(delta), dt)
      }
      agent.phase += dt * (agent.bird ? 4 : 2.4)
      agent.x += Math.cos(agent.angle) * dt * (agent.bird ? 40 : 8)
      agent.y += Math.sin(agent.angle) * dt * (agent.bird ? 40 : 8)
      const data = agent.bird ? birds : kay
      const offset = (agent.bird ? i - 4 : i) * 4
      data[offset] = agent.x
      data[offset + 1] = agent.y
      data[offset + 2] = agent.angle
      data[offset + 3] = agent.bird ? 0.68 + 0.32 * Math.cos(agent.phase) : agent.phase
    })
    ripples.fill(0)
    for (let i = activeRipples.length - 1; i >= 0; i--) {
      const ripple = activeRipples[i]!
      const age = time - ripple.start
      if (age >= 4) activeRipples.splice(i, 1)
      else {
        const offset = i * 4
        ripples[offset] = ripple.x
        ripples[offset + 1] = ripple.y
        ripples[offset + 2] = age
        ripples[offset + 3] = 1
      }
    }
    const causticsOpacity = options.waterCaustics ? 1 - options.waterTransparency / 100 : 0
    if (causticsOpacity > 0 && !causticsTexture) causticsTexture = createWaterCaustics(gl)
    gl.viewport(0, 0, cv.width, cv.height)
    gl.useProgram(program)
    gl.bindVertexArray(vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, noise)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, fieldTextures[fromIndex]!)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, fieldTextures[toIndex]!)
    const u = uniforms
    gl.uniform1i(u.uNoise!, 0)
    gl.uniform1i(u.uFA!, 1)
    gl.uniform1i(u.uFB!, 2)
    gl.uniform2f(u.uRes!, cv.width / scale, cv.height / scale)
    gl.uniform2f(u.uGrid!, Gw, Gh)
    gl.activeTexture(gl.TEXTURE7)
    gl.bindTexture(gl.TEXTURE_2D, causticsTexture ?? noise)
    gl.uniform1i(u.uWaterCaustics!, 7)
    gl.uniform1f(u.uWaterCausticsScale!, options.waterDensity / 100)
    gl.uniform1f(u.uWaterCausticsOpacity!, causticsOpacity)
    gl.uniform1f(u.uScale!, scale)
    gl.uniform1f(u.uSeed!, (seed % 997) * 0.37)
    gl.uniform1f(u.uStep!, STEP)
    gl.uniform1f(u.uMix!, currentMix)
    gl.uniform1f(u.uTime!, time)
    gl.uniform1f(u.uSpeed!, P.speed)
    gl.uniform1f(u.uRunup!, P.runup)
    gl.uniform1f(u.uShallow!, P.shallow)
    gl.uniform1f(u.uShoal!, P.shoal)
    gl.uniform1f(u.uGrain!, P.grain)
    gl.uniform1f(u.uWave!, P.wave)
    gl.uniform1f(u.uSigma!, P.sigma)
    gl.uniform1f(u.uSpacing!, P.spacing)
    gl.uniform1f(u.uWaves!, P.waves)
    gl.uniform1f(u.uNight!, options.night ? 1 : 0)
    gl.uniform1f(u.uDebug!, 0)
    gl.uniform1f(u.uKayN!, 0)
    gl.uniform1f(u.uBirdN!, 0)
    gl.uniform4fv(u.uKay!, kay)
    gl.uniform4fv(u.uBird!, birds)
    gl.uniform4fv(u.uRip!, ripples)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    // Only shade boats, birds and their shadows where they can affect the image.
    // Align to 2px so derivatives use the same pixel groups as the full-screen pass.
    gl.uniform1f(u.uKayN!, options.night ? 0 : P.kayaks)
    gl.uniform1f(u.uBirdN!, P.birds)
    gl.enable(gl.SCISSOR_TEST)
    try {
      for (let i = 0; i < agents.length; i++) {
        const agent = agents[i]!
        if (agent.bird ? i - 4 >= P.birds : i >= P.kayaks) continue
        if (agent.bird) {
          drawRegion(agent.x, agent.y, -22, -22, 22, 22)
          drawRegion(agent.x + 34, agent.y + 55, -22, -22, 22, 22)
        } else drawRegion(agent.x, agent.y, -36, -36, 48, 52)
      }
    } finally {
      gl.disable(gl.SCISSOR_TEST)
    }
    drawFish(fishCount, time, options.night)
    if (!treesDirty && currentMix >= 1) return
    treesDirty = false
    treeContext.setTransform(scale, 0, 0, scale, 0, 0)
    treeContext.clearRect(0, 0, W, H)
    for (let i = 0; i < previousTrees.length + trees.length; i++) {
      const old = i < previousTrees.length
      const tree = old ? previousTrees[i]! : trees[i - previousTrees.length]!
      const opacity = old ? 1 - currentMix : currentMix
      const fieldAtFoot =
        sampleArr(previous.s, tree.x, tree.y) * (1 - currentMix) +
        sampleArr(current.s, tree.x, tree.y) * currentMix
      const visibleOpacity = opacity * Math.max(0, Math.min(1, -fieldAtFoot / 8))
      if (visibleOpacity <= 0) continue
      const sprite = sprites[tree.variant]
      if (!sprite) continue
      const { image, shadow, footX, footY, extent } = sprite
      const factor = tree.size / extent
      const x = -footX * factor,
        y = -footY * factor
      const width = image.naturalWidth * factor
      const height = image.naturalHeight * factor
      treeContext.save()
      treeContext.translate(tree.x, tree.y)
      treeContext.scale(tree.mirror, 1)
      treeContext.globalAlpha = 0.2 * visibleOpacity
      treeContext.filter = 'blur(1.2px)'
      // Project around the actual opaque foot so the shadow starts at the trunk.
      treeContext.transform(0.85, 0.08, 0, -0.5, 0, 0)
      treeContext.drawImage(shadow, x, y, width, height)
      treeContext.restore()
      treeContext.save()
      treeContext.translate(tree.x, tree.y)
      treeContext.scale(tree.mirror, 1)
      treeContext.globalAlpha = visibleOpacity
      treeContext.fillStyle = options.night ? 'rgba(8, 17, 30, 0.34)' : 'rgba(69, 103, 89, 0.25)'
      treeContext.beginPath()
      treeContext.ellipse(
        0,
        0,
        options.night ? 3.5 : 2.5,
        options.night ? 1.7 : 1.2,
        0,
        0,
        Math.PI * 2,
      )
      treeContext.fill()
      treeContext.filter = options.night ? 'brightness(0.58) saturate(0.72)' : 'none'
      treeContext.drawImage(image, x, y, width, height)
      treeContext.restore()
    }
    if (currentMix >= 1) previousTrees = []
  }
  return {
    resize,
    resizeViewport,
    draw,
    ripple(x: number, y: number) {
      if (!previous || !current || x < 0 || y < 0 || x >= W || y >= H) return
      const distance =
        sampleArr(previous.s, x, y) * (1 - currentMix) + sampleArr(current.s, x, y) * currentMix
      if (distance <= 2) return
      if (activeRipples.length === 6) activeRipples.shift()
      activeRipples.push({ x, y, start: sceneTime / 1000 })
    },
    dispose(contextLost = false) {
      for (const img of images) {
        img.onload = null
        img.onerror = null
        img.src = ''
      }
      if (!contextLost) gl.getExtension('WEBGL_lose_context')?.loseContext()
      treesCanvas.width = treesCanvas.height = 1
    },
  }
}
