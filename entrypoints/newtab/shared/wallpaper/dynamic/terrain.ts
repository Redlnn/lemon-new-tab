type FieldRect = { cx: number; cy: number; hw: number; hh: number }

/** Shared seeded noise and distance field for dynamic wallpapers. */
export function createTerrain(seed: number, step: number, sigma: () => number, warp: () => number) {
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
  let Gw = 1,
    Gh = 1
  let NZ: { wx: Float32Array; wy: Float32Array } | undefined
  let accumulation = new Float32Array(0)

  const resize = (width: number, height: number) => {
    if (NZ && width === Gw && height === Gh) return
    const oldWidth = Gw,
      oldHeight = Gh,
      oldNoise = NZ
    Gw = width
    Gh = height
    const N = Gw * Gh
    NZ = { wx: new Float32Array(N), wy: new Float32Array(N) }
    const copiedWidth = oldNoise ? Math.min(oldWidth, Gw) : 0
    const copiedHeight = oldNoise ? Math.min(oldHeight, Gh) : 0
    for (let gy = 0; gy < Gh; gy++) {
      if (oldNoise && gy < copiedHeight) {
        NZ.wx.set(oldNoise.wx.subarray(gy * oldWidth, gy * oldWidth + copiedWidth), gy * Gw)
        NZ.wy.set(oldNoise.wy.subarray(gy * oldWidth, gy * oldWidth + copiedWidth), gy * Gw)
      }
      for (let gx = gy < copiedHeight ? copiedWidth : 0; gx < Gw; gx++) {
        const i = gy * Gw + gx,
          x = gx * step,
          y = gy * step
        NZ.wx[i] = fbm(x * 0.0028, y * 0.0028, 1) - 0.47
        NZ.wy[i] = fbm(x * 0.0028, y * 0.0028, 2) - 0.47
      }
    }
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
