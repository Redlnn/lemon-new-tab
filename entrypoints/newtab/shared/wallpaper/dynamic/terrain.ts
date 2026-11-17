type FieldRect = { cx: number; cy: number; hw: number; hh: number }

/** Shared seeded noise and distance field for dynamic wallpapers. */
export function createTerrain(seed: number, step: number, sigma: () => number, warp: () => number) {
  const hash2 = (x: number, y: number, k = 0) => {
    let h =
      Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed + k, 2246822519)
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }

  // The land field samples the same smooth fbm on a regular pixel grid. Each
  // octave's lattice is tiny compared to the grid, so evaluating it once per
  // lattice node removes millions of duplicated hash evaluations. Both warp
  // channels share the same grid traversal.
  const buildNoiseGrids = (width: number, height: number, spacing: number) => {
    const first = new Float64Array(width * height)
    const second = new Float64Array(width * height)
    const xIndex = new Int32Array(width),
      xBlend = new Float64Array(width)
    let amp = 0.5,
      scale = 0.0028 * spacing,
      offset = 0
    for (let octave = 0; octave < 4; octave++) {
      const kFirst = 1 + octave * 7,
        kSecond = 2 + octave * 7
      const xMin = Math.floor(offset),
        yMin = Math.floor(offset)
      const xMax = Math.floor(scale * (width - 1) + offset),
        yMax = Math.floor(scale * (height - 1) + offset)
      const tw = xMax - xMin + 2,
        th = yMax - yMin + 2
      const tableFirst = new Float64Array(tw * th),
        tableSecond = new Float64Array(tw * th)
      for (let iy = 0; iy < th; iy++)
        for (let ix = 0; ix < tw; ix++) {
          tableFirst[iy * tw + ix] = hash2(xMin + ix, yMin + iy, kFirst)
          tableSecond[iy * tw + ix] = hash2(xMin + ix, yMin + iy, kSecond)
        }
      for (let gx = 0; gx < width; gx++) {
        const x = scale * gx + offset,
          fx = x - Math.floor(x)
        xIndex[gx] = Math.floor(x) - xMin
        xBlend[gx] = fx * fx * (3 - 2 * fx)
      }
      let index = 0
      for (let gy = 0; gy < height; gy++) {
        const y = scale * gy + offset,
          fy = y - Math.floor(y),
          iy = Math.floor(y) - yMin,
          uy = fy * fy * (3 - 2 * fy)
        for (let gx = 0; gx < width; gx++, index++) {
          const ux = xBlend[gx]!,
            row = iy * tw + xIndex[gx]!
          const a1 = tableFirst[row]!,
            b1 = tableFirst[row + 1]!,
            c1 = tableFirst[row + tw]!,
            d1 = tableFirst[row + tw + 1]!
          const a2 = tableSecond[row]!,
            b2 = tableSecond[row + 1]!,
            c2 = tableSecond[row + tw]!,
            d2 = tableSecond[row + tw + 1]!
          first[index]! +=
            amp * (a1 + (b1 - a1) * ux + (c1 - a1) * uy + (a1 - b1 - c1 + d1) * ux * uy)
          second[index]! +=
            amp * (a2 + (b2 - a2) * ux + (c2 - a2) * uy + (a2 - b2 - c2 + d2) * ux * uy)
        }
      }
      amp *= 0.5
      scale *= 2.03
      offset = offset * 2.03 + 17.1
    }
    return { first, second }
  }

  const latticeCache = new Map<number, Float64Array>()
  const lattice = (period: number, k: number) => {
    const key = period * 4096 + k
    let table = latticeCache.get(key)
    if (!table) {
      table = new Float64Array(period * period)
      for (let y = 0; y < period; y++)
        for (let x = 0; x < period; x++) table[y * period + x] = hash2(x, y, k)
      latticeCache.set(key, table)
    }
    return table
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
    // Every channel reuses the same five tile periods. The per-axis lattice
    // indices and blend weights only depend on the pixel coordinate, so they
    // are precomputed once for the whole image and shared by all channels.
    const periods = [8, 16, 32, 64, 128]
    const slots = new Map(periods.map((period, index) => [period, index]))
    const axes = periods.map(() => ({
      base: new Int32Array(S),
      next: new Int32Array(S),
      blend: new Float64Array(S),
    }))
    for (let s = 0; s < periods.length; s++) {
      const period = periods[s]!,
        axis = axes[s]!
      for (let i = 0; i < S; i++) {
        const q = (i / S) * period,
          base = Math.floor(q),
          f = q - base
        axis.base[i] = base
        axis.next[i] = base + 1 === period ? 0 : base + 1
        axis.blend[i] = f * f * (3 - 2 * f)
      }
    }
    const layers = chans.map((channel, c) => {
      const total = channel.reduce((sum, _, i) => sum + 0.5 ** (i + 1), 0)
      return channel.map((period, l) => ({
        slot: slots.get(period)!,
        table: lattice(period, 100 + c * 50 + l * 13),
        weight: 0.5 ** (l + 1) / total,
      }))
    })
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4
        for (let c = 0; c < 4; c++) {
          let n = 0
          for (const layer of layers[c]!) {
            const period = periods[layer.slot]!,
              axis = axes[layer.slot]!,
              table = layer.table
            const x0 = axis.base[x]!,
              x1 = axis.next[x]!,
              y0 = axis.base[y]!,
              y1 = axis.next[y]!,
              ux = axis.blend[x]!,
              uy = axis.blend[y]!
            const a = table[y0 * period + x0]!,
              b = table[y0 * period + x1]!,
              cc = table[y1 * period + x0]!,
              dd = table[y1 * period + x1]!
            n += layer.weight * (a + (b - a) * ux + (cc - a) * uy + (a - b - cc + dd) * ux * uy)
          }
          d[i + c] = Math.min(Math.max((n - 0.5) * 1.9 + 0.5, 0), 1) * 255
        }
      }
    return { S, d }
  }
  /* ======================================================================
   陆地场（CPU）：s = 到海岸的有符号距离（<0 陆地）
   ====================================================================== */
  let Gw = 1,
    Gh = 1
  let NZ: { wx: Float32Array; wy: Float32Array } | undefined
  let accumulation = new Float32Array(0)
  // The warp field is very low frequency; evaluating it every other cell and
  // interpolating keeps the shape while halving the octave work.
  const NOISE_CELL = 2

  const resize = (width: number, height: number) => {
    if (NZ && width === Gw && height === Gh) return
    Gw = width
    Gh = height
    const cols = Math.ceil(width / NOISE_CELL) + 1,
      rows = Math.ceil(height / NOISE_CELL) + 1
    const coarse = buildNoiseGrids(cols, rows, step * NOISE_CELL)
    const N = width * height
    const wx = new Float32Array(N),
      wy = new Float32Array(N)
    for (let gy = 0; gy < height; gy++) {
      const ny = gy / NOISE_CELL,
        iy = Math.floor(ny),
        fy = ny - iy,
        row = iy * cols
      for (let gx = 0; gx < width; gx++) {
        const nx = gx / NOISE_CELL,
          ix = Math.floor(nx),
          fx = nx - ix,
          base = row + ix
        const topX = coarse.first[base]! + (coarse.first[base + 1]! - coarse.first[base]!) * fx,
          bottomX =
            coarse.first[base + cols]! +
            (coarse.first[base + cols + 1]! - coarse.first[base + cols]!) * fx
        const topY = coarse.second[base]! + (coarse.second[base + 1]! - coarse.second[base]!) * fx,
          bottomY =
            coarse.second[base + cols]! +
            (coarse.second[base + cols + 1]! - coarse.second[base + cols]!) * fx
        const index = gy * width + gx
        wx[index] = topX + (bottomX - topX) * fy - 0.47
        wy[index] = topY + (bottomY - topY) * fy - 0.47
      }
    }
    NZ = { wx, wy }
  }

  const computeField = (rects: FieldRect[]) => {
    const N = Gw * Gh
    if (accumulation.length !== N) accumulation = new Float32Array(N)
    else accumulation.fill(0)
    const f1 = accumulation
    const sig = sigma(),
      is1 = 1 / (sig * sig)
    const wa = warp() * 2.2,
      wmax = wa * 0.5
    for (const r of rects) {
      const R = 5.5 * sig + Math.max(r.hw, r.hh) * 0.5 + wmax
      const gx0 = Math.max(0, Math.floor((r.cx - R) / step)),
        gx1 = Math.min(Gw - 1, Math.ceil((r.cx + R) / step))
      const gy0 = Math.max(0, Math.floor((r.cy - R) / step)),
        gy1 = Math.min(Gh - 1, Math.ceil((r.cy + R) / step))
      const chw = r.hw * 0.5,
        chh = r.hh * 0.5
      for (let gy = gy0; gy <= gy1; gy++)
        for (let gx = gx0; gx <= gx1; gx++) {
          const i = gy * Gw + gx
          const qx = gx * step + NZ!.wx[i]! * wa,
            qy = gy * step + NZ!.wy[i]! * wa
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
    if (!rects.length) {
      s.fill(sig * (Math.sqrt(30) - c0))
      return { s }
    }
    for (let i = 0; i < N; i++) {
      const g = Math.log(Math.max(f1[i]!, fMin))
      s[i] = sig * (Math.sqrt(Math.max(-g, 0)) - c0) - sig * 0.6 * Math.max(g, 0)
    }
    return { s }
  }

  const sampleArr = (a: Float32Array, x: number, y: number) => {
    const fx = Math.min(Math.max(x / step, 0), Gw - 1.001),
      fy = Math.min(Math.max(y / step, 0), Gh - 1.001)
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

  return { hash2, makeNoiseImage, resize, computeField, sampleArr }
}
