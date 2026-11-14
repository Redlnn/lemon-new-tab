import {
  beachRegionsSeparate,
  createBeachIslands,
  shouldRepositionBeachIslands,
  type BeachRect,
} from './beachIslands'
import { beachVertexShader, beachFragmentShader } from './beachShaders'
import { snapshotField } from './fieldTransition'

const STEP = 5
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
}
type Field = { s: Float32Array }
type Bounds = { left: number; top: number; width: number; height: number }

export function createBeachScene(
  cv: HTMLCanvasElement,
  treesCanvas: HTMLCanvasElement,
  treeUrls: string[],
) {
  const context = cv.getContext('webgl2', {
    antialias: false,
    alpha: false,
    powerPreference: 'low-power',
  })
  if (!context) throw new Error('WebGL2 unavailable')
  const gl: WebGL2RenderingContext = context
  const treeContext = treesCanvas.getContext('2d')
  if (!treeContext) throw new Error('Canvas 2D unavailable')
  const seed = (Math.random() * 1e6) | 0
  const hash2 = (x: number, y: number, k = 0) => {
    let h =
      Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed + k, 2246822519)
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }

  const vnoise = (x: number, y: number, k = 0) => {
    const ix = Math.floor(x),
      iy = Math.floor(y),
      fx = x - ix,
      fy = y - iy
    const ux = fx * fx * (3 - 2 * fx),
      uy = fy * fy * (3 - 2 * fy)
    const a = hash2(ix, iy, k),
      b = hash2(ix + 1, iy, k),
      c = hash2(ix, iy + 1, k),
      d = hash2(ix + 1, iy + 1, k)
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
  }

  const fbm = (x: number, y: number, k = 0) => {
    let a = 0.5,
      s = 0
    for (let i = 0; i < 4; i++) {
      s += a * vnoise(x, y, k + i * 7)
      x = x * 2.03 + 17.1
      y = y * 2.03 + 17.1
      a *= 0.5
    }
    return s
  }

  const tileNoise = (x: number, y: number, px: number, py: number, k: number) => {
    const ix = Math.floor(x),
      iy = Math.floor(y),
      fx = x - ix,
      fy = y - iy
    const ux = fx * fx * (3 - 2 * fx),
      uy = fy * fy * (3 - 2 * fy)
    const m = (v: number, p: number) => ((v % p) + p) % p
    const x0 = m(ix, px),
      x1 = m(ix + 1, px),
      y0 = m(iy, py),
      y1 = m(iy + 1, py)
    const a = hash2(x0, y0, k),
      b = hash2(x1, y0, k),
      c = hash2(x0, y1, k),
      d = hash2(x1, y1, k)
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
  }

  const tileFbm = (u: number, v: number, periods: number[], k: number) => {
    let s = 0,
      w = 0.5,
      tw = 0
    for (let i = 0; i < periods.length; i++) {
      const period = periods[i]!
      s += w * tileNoise(u * period, v * period, period, period, k + i * 13)
      tw += w
      w *= 0.5
    }
    return s / tw
  }

  const makeNoiseImage = () => {
    const S = 256,
      d = new Uint8Array(S * S * 4)
    const chans = [
      [8, 16, 32, 64],
      [8, 16, 32, 64],
      [8, 16, 32],
      [16, 32, 64, 128],
    ]
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const u = x / S,
          v = y / S,
          i = (y * S + x) * 4
        for (let c = 0; c < 4; c++) {
          const n = tileFbm(u, v, chans[c]!, 100 + c * 50)
          d[i + c] = Math.min(Math.max((n - 0.5) * 1.9 + 0.5, 0), 1) * 255
        }
      }
    return { S, d }
  }

  /* ======================================================================
   陆地场（CPU）：s = 到海岸的有符号距离（<0 陆地）
   ====================================================================== */
  let W = innerWidth,
    H = innerHeight,
    Gw = 1,
    Gh = 1,
    NZ: { wx: Float32Array; wy: Float32Array }

  const buildNoise = () => {
    const N = Gw * Gh
    NZ = { wx: new Float32Array(N), wy: new Float32Array(N) }
    for (let gy = 0; gy < Gh; gy++)
      for (let gx = 0; gx < Gw; gx++) {
        const i = gy * Gw + gx,
          x = gx * STEP,
          y = gy * STEP
        NZ.wx[i] = fbm(x * 0.0028, y * 0.0028, 1) - 0.47
        NZ.wy[i] = fbm(x * 0.0028, y * 0.0028, 2) - 0.47
      }
  }

  const computeField = (rects: { cx: number; cy: number; hw: number; hh: number }[]) => {
    const N = Gw * Gh,
      f1 = new Float32Array(N)
    const sig = P.sigma,
      is1 = 1 / (sig * sig)
    const wa = P.warp * 2.2,
      wmax = wa * 0.5
    for (const r of rects) {
      const R = 5.5 * sig + Math.max(r.hw, r.hh) * 0.5 + wmax
      const gx0 = Math.max(0, Math.floor((r.cx - R) / STEP)),
        gx1 = Math.min(Gw - 1, Math.ceil((r.cx + R) / STEP))
      const gy0 = Math.max(0, Math.floor((r.cy - R) / STEP)),
        gy1 = Math.min(Gh - 1, Math.ceil((r.cy + R) / STEP))
      const chw = r.hw * 0.5,
        chh = r.hh * 0.5
      for (let gy = gy0; gy <= gy1; gy++)
        for (let gx = gx0; gx <= gx1; gx++) {
          const i = gy * Gw + gx
          const qx = gx * STEP + NZ.wx[i]! * wa,
            qy = gy * STEP + NZ.wy[i]! * wa
          let dx = Math.abs(qx - r.cx) - chw,
            dy = Math.abs(qy - r.cy) - chh
          if (dx < 0) dx = 0
          if (dy < 0) dy = 0
          f1[i]! += Math.exp(-(dx * dx + dy * dy) * is1)
        }
    }
    // 下限 = 计算范围边缘处的贡献值：范围内外算出的"离岸距离"一致，深海不会出现方框状的接缝
    const c0 = Math.sqrt(-Math.log(0.35)),
      s = new Float32Array(N),
      fMin = Math.exp(-30)
    for (let i = 0; i < N; i++) {
      const g = Math.log(Math.max(f1[i]!, fMin))
      s[i] = sig * (Math.sqrt(Math.max(-g, 0)) - c0) - sig * 0.6 * Math.max(g, 0)
    }
    return { s }
  }

  const sampleArr = (a: Float32Array, x: number, y: number) => {
    const fx = Math.min(Math.max(x / STEP, 0), Gw - 1.001),
      fy = Math.min(Math.max(y / STEP, 0), Gh - 1.001)
    const ix = Math.floor(fx),
      iy = Math.floor(fy),
      tx = fx - ix,
      ty = fy - iy,
      i = iy * Gw + ix
    return (
      (a[i]! * (1 - tx) + a[i + 1]! * tx) * (1 - ty) +
      (a[i + Gw]! * (1 - tx) + a[i + Gw + 1]! * tx) * ty
    )
  }

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('Could not create beach shader')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader) || 'Shader error')
    return shader
  }
  const vertex = compile(gl.VERTEX_SHADER, beachVertexShader)
  const fragment = compile(gl.FRAGMENT_SHADER, beachFragmentShader)
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
  const fieldTextures = [gl.createTexture(), gl.createTexture()]
  const float = new Float32Array(1),
    bits = new Uint32Array(float.buffer)
  const half = (value: number) => {
    float[0] = value
    const x = bits[0]!,
      sign = (x >>> 16) & 0x8000,
      exponent = ((x >>> 23) & 255) - 112
    return exponent <= 0
      ? sign
      : exponent >= 31
        ? sign | 0x7c00
        : sign | (exponent << 10) | ((x & 0x7fffff) >>> 13)
  }
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
  const agents = Array.from({ length: 5 }, (_, i) => ({
    x: Math.random() * W,
    y: Math.random() * H,
    angle: Math.random() * 6.28,
    phase: Math.random() * 6.28,
    bird: i >= 2,
  }))
  const upload = (index: number, field: Field) => {
    const data = new Uint16Array(field.s.length)
    for (let i = 0; i < data.length; i++) data[i] = half(field.s[i]!)
    gl.bindTexture(gl.TEXTURE_2D, fieldTextures[index]!)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, Gw, Gh, 0, gl.RED, gl.HALF_FLOAT, data)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }
  const randomForLayout = () => {
    let n = seed
    return () => {
      n = Math.imul(n ^ (n >>> 15), 2246822519)
      n = Math.imul(n ^ (n >>> 13), 3266489917)
      return ((n ^= n >>> 16) >>> 0) / 4294967296
    }
  }
  const setLayout = (bounds: Bounds | null, reset = false, startField?: Field) => {
    const main = bounds
      ? {
          x: bounds.left - bounds.width * 0.05,
          y: bounds.top,
          w: bounds.width * 1.1,
          h: bounds.height,
        }
      : null
    const key = `${W},${H},${main?.x},${main?.y},${main?.w},${main?.h}`
    if (!reset && key === layoutKey) return
    layoutKey = key
    const random = randomForLayout()
    const needsIslands =
      !islandViewport ||
      shouldRepositionBeachIslands(islandViewport, W, H) ||
      (main && islands.some((island) => !beachRegionsSeparate(island, main)))
    if (needsIslands) {
      islands = createBeachIslands(W, H, main, random)
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
    transitionStart = sceneTime
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
    for (let tries = 0; tries < 1800 && trees.length < 5; tries++) {
      const x = 30 + random() * (W - 60),
        y = 55 + random() * (H - 90)
      if (sampleArr(next.s, x, y) > -20 || sampleArr(next.s, x, y) < -75) continue
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
  const resizeViewport = () => {
    const box = cv.getBoundingClientRect()
    scale = Math.min(window.devicePixelRatio || 1, P.quality)
    const width = Math.max(1, Math.round((box.width || window.innerWidth) * scale)),
      height = Math.max(1, Math.round((box.height || window.innerHeight) * scale))
    if (cv.width === width && cv.height === height) return false
    if (cv.width !== width) cv.width = width
    if (cv.height !== height) cv.height = height
    treesCanvas.width = width
    treesCanvas.height = height
    treesDirty = true
    return true
  }
  const resize = (bounds: Bounds | null) => {
    resizeViewport()
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
  const draw = (time: number, bounds: Bounds | null) => {
    sceneTime = time * 1000
    const key = bounds ? `${bounds.left},${bounds.top},${bounds.width},${bounds.height}` : ''
    if (key !== lastBounds) {
      lastBounds = key
      setLayout(bounds)
    }
    if (!current || !previous) return
    const progress = Math.min(Math.max((sceneTime - transitionStart) / transitionDuration, 0), 1)
    currentMix = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2
    const dt = lastTime ? Math.min(time - lastTime, 0.1) : 0
    lastTime = time
    kay.fill(0)
    birds.fill(0)
    agents.forEach((agent, i) => {
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
      if (agent.bird)
        birds.set([agent.x, agent.y, agent.angle, 0.68 + 0.32 * Math.cos(agent.phase)], (i - 2) * 4)
      else kay.set([agent.x, agent.y, agent.angle, agent.phase], i * 4)
    })
    gl.viewport(0, 0, cv.width, cv.height)
    gl.useProgram(program)
    gl.bindVertexArray(vao)
    for (const [unit, texture] of [
      noise,
      fieldTextures[fromIndex],
      fieldTextures[toIndex],
    ].entries()) {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, texture!)
    }
    const u = uniforms
    gl.uniform1i(u.uNoise!, 0)
    gl.uniform1i(u.uFA!, 1)
    gl.uniform1i(u.uFB!, 2)
    gl.uniform2f(u.uRes!, cv.width / scale, cv.height / scale)
    gl.uniform2f(u.uGrid!, Gw, Gh)
    for (const [name, value] of Object.entries({
      uScale: scale,
      uSeed: (seed % 997) * 0.37,
      uStep: STEP,
      uMix: currentMix,
      uTime: time,
      uSpeed: P.speed,
      uRunup: P.runup,
      uShallow: P.shallow,
      uShoal: P.shoal,
      uGrain: P.grain,
      uWave: P.wave,
      uSigma: P.sigma,
      uSpacing: P.spacing,
      uWaves: P.waves,
      uDebug: 0,
      uKayN: 2,
      uBirdN: 3,
    }))
      gl.uniform1f(u[name]!, value)
    gl.uniform4fv(u.uKay!, kay)
    gl.uniform4fv(u.uBird!, birds)
    gl.uniform4fv(u.uRip!, ripples)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    if (!treesDirty && currentMix >= 1) return
    treesDirty = false
    treeContext.setTransform(scale, 0, 0, scale, 0, 0)
    treeContext.clearRect(0, 0, W, H)
    for (const { tree, opacity } of [
      ...previousTrees.map((tree) => ({ tree, opacity: 1 - currentMix })),
      ...trees.map((tree) => ({ tree, opacity: currentMix })),
    ]) {
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
      treeContext.fillStyle = 'rgba(69, 103, 89, 0.25)'
      treeContext.beginPath()
      treeContext.ellipse(0, 0, 2.5, 1.2, 0, 0, Math.PI * 2)
      treeContext.fill()
      treeContext.drawImage(image, x, y, width, height)
      treeContext.restore()
    }
    if (currentMix >= 1) previousTrees = []
  }
  return {
    resize,
    resizeViewport,
    draw,
    dispose() {
      for (const img of images) {
        img.onload = null
        img.onerror = null
        img.src = ''
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
