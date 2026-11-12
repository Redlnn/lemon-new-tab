import { createMeadowCharacters } from './meadowCharacters'

export type MeadowAssets = {
  boy: string
  boyRun: string
  boyFrontFrames: string
  boyBackFrames: string
  cats: [string, string, string, string]
}
export type MeadowRegion = { x: number; y: number; w: number; h: number }
export type MeadowProgram = { p: WebGLProgram; U: Record<string, WebGLUniformLocation> }
type MeadowBounds = { left: number; top: number; width: number; height: number }
type MeadowOptions = {
  cloudSize: number
  cloudCover: number
  flow: number
  showBoy: boolean
  showCat: boolean
}
type Circle = [number, number, number, number]
type Field = { s: Float32Array }

export function createMeadowScene(cv: HTMLCanvasElement, assets: MeadowAssets) {
  const context = cv.getContext('webgl2', {
    antialias: false,
    alpha: false,
    powerPreference: 'low-power',
  })
  if (!context) throw new Error('WebGL2 unavailable')
  const gl: WebGL2RenderingContext = context
  let disposed = false
  let initialized = false
  const pendingImages = new Set<HTMLImageElement>()
  const resolution = { scale: 1 }
  const TASKBAR = 0,
    STEP = 5,
    MORPH_MS = 1800
  const P = {
    sigma: 72,
    warp: 40,
    edge: 10,
    cover: 0.3,
    flow: 1,
    quality: 2,
    showBoy: 1,
    showCat: 1,
    avoidCenter: false,
  }
  let sceneNow = 0,
    lastSceneNow: number | null = null,
    regions: MeadowRegion[] = [],
    lastBounds: MeadowBounds | null = null
  try {
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

    /* ======================================================================
   着色器
   ====================================================================== */
    const VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

    const FS = `#version 300 es
precision highp float;
uniform sampler2D uNoise, uFA, uFB, uMeadowGround;
uniform vec2 uRes, uGrid;
uniform float uScale, uSeed, uStep, uMix, uEdge;
#ifdef MEADOW_ACTOR
uniform sampler2D uActor, uActorShadow;
uniform vec4 uActorRect;
#endif
#ifdef MEADOW_CAT
uniform sampler2D uCat;
uniform vec4 uCatRect;
uniform vec2 uCatShadow;
uniform float uCatTail;
#endif
uniform highp sampler2D uCirc;   // 云的圆（CPU 算好、按格子分好）：每格最多 CIRC_K 个，(x, y, 半径, 色调)，半径 0 = 没有了
uniform vec2 uCGrid;             // 格子数
uniform float uCellG;            // 格子大小（px）
out vec4 o;

// ---- 调色板 ----
const vec3 G_LIGHT = vec3(0.76, 0.83, 0.52), G_MID = vec3(0.62, 0.75, 0.42);  // 草地：浅的黄绿 / 绿（大块水彩晕染）
const vec3 G_DEEP = vec3(0.52, 0.68, 0.36);                                   // 草地里颜色深一点的几片
const vec3 INK = vec3(0.24, 0.38, 0.18);                                      // 画草的墨绿短线
const vec3 SHADOW = vec3(0.56, 0.66, 0.52);                                   // 云影：把草地压成深绿
const vec3 CLOUD_HI = vec3(1.0, 1.0, 0.99);                                   // 云：朝光外沿的亮白
const vec3 CLOUD_BODY = vec3(0.90, 0.93, 0.96), CLOUD_SH = vec3(0.80, 0.85, 0.90); // 云：主体 / 偏暗的圆（比大海主题少一些蓝；主体不能太白，白色的图标文字要看得清）
const vec2 LIGHT = vec2(-0.6, -0.8);                                          // 太阳在左上方
const vec2 SHADOW_OFF = vec2(115.0, 156.0);                                    // 云影落在右下方，离云远 → 云飘得高
const int CIRC_K = 36;

float hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float ss(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
vec4 N(vec2 p, float scale) { return texture(uNoise, p / scale + uSeed * 0.013); }
float fieldS(sampler2D t, vec2 p) { return texture(t, (p / uStep + 0.5) / uGrid).r; }
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

// 到云的距离（<0 在云里）：图标周围云团的主体 + 自己格子里的圆（和天空主题同一套）
// front = true 时顺便找出盖住这个点、圆心最靠下（最前面）的那个圆：fc = (圆心 x, y, 半径, 色调)
float cloudDist(vec2 q, bool front, inout vec4 fc) {
  float sF = mix(fieldS(uFA, q), fieldS(uFB, q), uMix);
  float d = sF - uEdge + 0.6 * 95.0;                                              // 主体：把圆之间的缝填上
  ivec2 cell = ivec2(floor(q / uCellG)) + 4;                                      // 格子比屏幕左、上多 4 格（右下方的云影要用到），右、下多 3 格
  if (cell.x < 0 || cell.y < 0 || float(cell.x) >= uCGrid.x || float(cell.y) >= uCGrid.y) return d;
  for (int k = 0; k < CIRC_K; k++) {
    vec4 c = texelFetch(uCirc, ivec2(cell.x * CIRC_K + k, cell.y), 0);
    if (c.z <= 0.0) break;
    float di = length(q - c.xy) - c.z;
    d = smin(d, di, 6.0);
    if (front && di < 0.0 && c.y > fc.y) fc = c;
  }
  return d;
}
float cloudDist(vec2 q) { vec4 fc = vec4(0.0, -1e9, 0.0, 0.0); return cloudDist(q, false, fc); }

// 到一段线的距离
float segD(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }

// 画草的短线：每个 12×6 的格子里最多一笔，方向跟着大片区域走（一片片平行的排线），疏密也跟着区域变（有的地方密、有的地方空）
// 只看自己的格子和上下两格（一笔不会伸出左右的格子）
float grassInk(vec2 p) {
  const vec2 G = vec2(12.0, 6.0);
  vec2 c0 = floor(p / G);
  float ink = 0.0;
  for (int j = -1; j <= 1; j++) {
    vec2 c = c0 + vec2(0.0, float(j));
    vec2 cp = (c + 0.5) * G;
    float h = hash2(c + 3.1);
    float dens = 0.75 * ss(0.42, 0.72, N(cp, 900.0).r) * ss(0.35, 0.6, N(cp + 50.0, 380.0).g) + 0.02;   // 一片片、一簇簇地画，中间留空
    if (h > dens) continue;
    float ang = (N(cp, 1400.0).g - 0.5) * 0.7 + (hash2(c + 7.7) - 0.5) * 0.3;    // 以接近水平为主，一片里的线大致平行
    float len = 2.5 + 3.0 * hash2(c + 1.9);                                      // 半长 2.5~5.5px
    vec2 ctr = cp + (vec2(hash2(c + 4.3), hash2(c + 5.9)) - 0.5) * vec2(2.0, 3.0);
    vec2 dir = vec2(cos(ang), sin(ang)) * len;
    float d = segD(p, ctr - dir, ctr + dir);
    ink = max(ink, (1.0 - ss(0.2, 0.9, d)) * (0.35 + 0.45 * hash2(c + 9.1)));
  }
  return ink;
}

#ifdef MEADOW_CAT
float catTailMask(vec2 uv) {
  return smoothstep(.635,.665,uv.x)*smoothstep(.715,.75,uv.y);
}
vec4 catColor(vec2 uv) {
  vec2 pivot=vec2(.68,.73),delta=uv-pivot;
  // 尾根固定，越靠尾尖摆幅越大；只变形尾巴，身体和四肢保持原位。
  float angle=-uCatTail*smoothstep(.025,.16,length(delta));
  float c=cos(angle),s=sin(angle);
  vec2 source=pivot+vec2(c*delta.x-s*delta.y,s*delta.x+c*delta.y);
  vec4 body=texture(uCat,uv),tail=texture(uCat,source);
  body.a*=1.-catTailMask(uv);tail.a*=catTailMask(source);
  float alpha=body.a+tail.a;
  return vec4((body.rgb*body.a+tail.rgb*tail.a)/max(alpha,.001),min(alpha,1.));
}
#endif

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y * uScale - gl_FragCoord.y) / uScale;

#ifdef MEADOW_GROUND
  // ---------- 草地：黄绿和绿的大块水彩晕染，几片颜色深一点，左上（向阳）稍亮；纸的颗粒 ----------
  float w1 = N(p, 1900.0).b, w2 = N(p + 311.0, 650.0).g;
  vec3 col = mix(G_MID, G_LIGHT, ss(0.3, 0.75, w1 * 0.7 + w2 * 0.3));
  col = mix(col, G_DEEP, ss(0.45, 0.85, N(p + 977.0, 1300.0).r) * 0.4);       // 阈值放宽：噪声放大很多倍，卡得太陡会出现台阶状的方块
  col *= 1.0 + 0.05 * (0.5 - (p.x + p.y) / (uRes.x + uRes.y));
  col *= 1.0 + (hash2(floor(p * (0.8 * max(uScale, 1.0)))) - 0.5) * 0.035;   // 颗粒按屏幕的实际像素取
  // 画草的墨绿短线
  col = mix(col, INK, grassInk(p) * 0.75);
  o = vec4(col, 1.0);
#else
  vec3 col = texelFetch(uMeadowGround, ivec2(gl_FragCoord.xy), 0).rgb;

#ifdef MEADOW_ACTOR
  // 人物、风筝和完整投影都先落在草地上，随后由同一层云影和白云覆盖。
  vec2 actorUV=(p-uActorRect.xy)/uActorRect.zw;
  actorUV.y=1.0-actorUV.y;
  float inActor=step(0.0,actorUV.x)*step(0.0,actorUV.y)*step(actorUV.x,1.0)*step(actorUV.y,1.0);
  vec4 actor=texture(uActor,actorUV);
  float actorShadow=texture(uActorShadow,actorUV).r*inActor;
  col=mix(col,col*SHADOW,actorShadow*0.85);
  col=mix(col,actor.rgb,actor.a*inActor);
#endif

#ifdef MEADOW_CAT
  // 只在猫所在的小矩形内启用这份着色器，猫与贴地阴影同样位于云层之下。
  vec2 catUV=(p-uCatRect.xy)/uCatRect.zw;
  vec2 catShadowUV=(p-uCatShadow-uCatRect.xy)/uCatRect.zw;
  vec4 cat=catColor(catUV);
  float catShadow=catColor(catShadowUV).a;
  float inCat=step(0.,catUV.x)*step(0.,catUV.y)*step(catUV.x,1.)*step(catUV.y,1.);
  float inShadow=step(0.,catShadowUV.x)*step(0.,catShadowUV.y)*step(catShadowUV.x,1.)*step(catShadowUV.y,1.);
  col=mix(col,col*SHADOW,catShadow*inShadow*.78);
  col=mix(col,cat.rgb,cat.a*inCat);
#endif

  // ---------- 云投在草地上的影子（右下方）：一整块深绿 ----------
  float sd = cloudDist(p - SHADOW_OFF);
  col = mix(col, col * SHADOW, ss(3.0, -3.0, sd) * 0.85);

  // ---------- 云：卡通画法（和大海主题一样）——一个个圆合起来，每个圆色调略有不同，
  //            只有朝光（左上）的外轮廓一道亮白，里面没有亮面；边缘干净 ----------
  vec4 fc = vec4(0.0, -1e9, 0.0, 0.0);
  float d = cloudDist(p, true, fc);
  if (d < 1.5) {
    // 往光那边走一小段就出云了 → 这里是朝光的外沿（离外轮廓超过 21px 的地方不用算）
    float hi = d > -21.0 ? ss(-1.0, 1.0, cloudDist(p + LIGHT * 20.0)) : 0.0;
    vec3 cc = fc.y > -1e8 ? mix(CLOUD_BODY, CLOUD_SH, fc.w * 0.6) : mix(CLOUD_BODY, CLOUD_SH, 0.45);
    cc = mix(cc, CLOUD_HI, hi);
    col = mix(col, cc, ss(1.0, -1.0, d));
  }
  o = vec4(col, 1.0);
#endif
}`

    const program = (fs: string) => {
      const mk = (type: number, src: string) => {
        const s = gl.createShader(type)
        if (!s) throw new Error('Could not create shader')
        gl.shaderSource(s, src)
        gl.compileShader(s)
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.error(gl.getShaderInfoLog(s))
          throw new Error('shader')
        }
        return s
      }
      const p = gl.createProgram()
      if (!p) throw new Error('Could not create program')
      gl.attachShader(p, mk(gl.VERTEX_SHADER, VS))
      gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs))
      gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(p) || 'Shader linking failed')
      const U: Record<string, WebGLUniformLocation> = {}
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS)
      for (let i = 0; i < n; i++) {
        const nm = gl.getActiveUniform(p, i)!.name.replace(/\[0\]$/, '')
        U[nm] = gl.getUniformLocation(p, nm)!
      }
      return { p, U }
    }
    const PR = program(FS)
    const groundPR = program(
      FS.replace('#version 300 es', '#version 300 es\n#define MEADOW_GROUND'),
    )
    const groundTexture = gl.createTexture()
    const groundFramebuffer = gl.createFramebuffer()
    if (!groundTexture || !groundFramebuffer) throw new Error('Could not create meadow cache')
    let actorPR: MeadowProgram | null = null,
      catPR: MeadowProgram | null = null,
      catActorPR: MeadowProgram | null = null
    gl.bindVertexArray(gl.createVertexArray())

    let noiseTex: WebGLTexture | null = null

    const buildNoiseTex = () => {
      const { S, d } = makeNoiseImage()
      noiseTex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, noiseTex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, d)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
    }

    const f32 = new Float32Array(1),
      u32 = new Uint32Array(f32.buffer)

    const toHalf = (v: number) => {
      f32[0] = v
      const x = u32[0]!
      const sign = (x >>> 16) & 0x8000,
        e = ((x >>> 23) & 0xff) - 112,
        m = x & 0x7fffff
      if (e <= 0) return sign
      if (e >= 31) return sign | 0x7c00
      return sign | (e << 10) | (m >>> 13)
    }

    // 两张陆地场纹理：from → to 之间插值
    const ftex: [WebGLTexture | null, WebGLTexture | null] = [null, null]
    let fromI = 0,
      toI = 0,
      morphT0 = -1e9,
      morphDur = MORPH_MS,
      FA: Field | null = null,
      FB: Field | null = null

    const allocField = () => {
      for (let i = 0; i < 2; i++) {
        if (ftex[i]) gl.deleteTexture(ftex[i]!)
        ftex[i] = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, ftex[i]!)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, Gw, Gh, 0, gl.RED, gl.HALF_FLOAT, null)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      }
    }

    const uploadField = (i: number, Fd: Field) => {
      const d = new Uint16Array(Gw * Gh)
      for (let k = 0; k < d.length; k++) d[k] = toHalf(Fd.s[k]!)
      gl.bindTexture(gl.TEXTURE_2D, ftex[i]!)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1) // R16F 奇数宽度行也按紧凑数据上传
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, Gw, Gh, gl.RED, gl.HALF_FLOAT, d)
    }

    // 把容器作为一个图标生成云场，横向略微扩展以覆盖更多快捷链接。
    const regionRects = () =>
      regions.map((ic) => ({
        cx: ic.x + ic.w / 2,
        cy: ic.y + ic.h / 2,
        hw: ic.w * 0.6 - 4,
        hh: ic.h / 2 - 2,
      }))

    const commit = (fromEmpty = false) => {
      const nf = computeField(regionRects())
      const target = 1 - toI
      if (fromEmpty) {
        FA = computeField([])
        uploadField(toI, FA)
      } else FA = FB
      FB = nf
      uploadField(target, FB)
      fromI = toI
      toI = target
      morphT0 = sceneNow
      morphDur = fromEmpty ? 2600 : MORPH_MS
    }

    const refresh = () => {
      FA = FB = computeField(regionRects())
      uploadField(toI, FB)
      fromI = toI
      morphT0 = -1e9
    }

    /* ======================================================================
   当前的场（图标挪动时在新旧两张之间过渡）
   ====================================================================== */
    let curMix = 1
    const curS = (x: number, y: number) =>
      FB && FA ? sampleArr(FA.s, x, y) * (1 - curMix) + sampleArr(FB.s, x, y) * curMix : 999

    /* ======================================================================
   云的圆：每帧在 CPU 上算好所有的圆（几百个），按格子分好上传成一张小纹理，着色器只读自己格子里的几个
   - 图标周围的云团：固定的格子里各放一个圆（随机位置、随机大小），圆心要在云团里面，越靠云边圆越小
     → 边全是圆弧；圆的大小各自慢慢呼吸；图标挪动时跟着场平滑地长大 / 缩小
   - 天上的小云：一朵朵完整的云，由大小不一的圆组成（底下一排、上面堆几个，底部较平），整朵随风飘
   ====================================================================== */
    const CELL_G = 48,
      CIRC_K = 36
    let circTex: WebGLTexture | null = null,
      circBuf = new Float32Array(0),
      cgW = 0,
      cgH = 0
    const rnd1 = (x: number, y: number, k: number) => hash2(x, y, k) // 固定的随机数（和换种子一起变）
    const skyClouds: (ReturnType<typeof makeSkyCloud> & { dying?: boolean })[] = []
    let flowT = 0

    const makeSkyCloud = (x: number, y = 80 + Math.random() * (H - TASKBAR - 120)) => {
      const rnd = Math.random,
        R = 95 * 1.2 // 轮廓大一些（云厚一些，才放得下大圆）；圆的大小还是按 95 算
      // 1) 大致的轮廓：底下一排大圆（中间大、两边小），上面再堆几个 → 底宽上窄的一团
      const n = 3 + Math.floor(rnd() * 3),
        w = R * (1.0 + n * 0.5)
      const body: [number, number, number][] = []
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1) - 0.5,
          r = R * (0.6 - Math.abs(t) * 0.45 + rnd() * 0.12)
        body.push([t * w, -r * 0.55, r])
      }
      for (let i = 0; i < n - 1; i++) {
        const t = n === 2 ? 0 : i / (n - 2) - 0.5,
          r = R * (0.55 + rnd() * 0.25)
        body.push([t * w * 0.6 + (rnd() - 0.5) * R * 0.4, -R * (0.5 + rnd() * 0.35), r])
      }
      if (rnd() < 0.6) body.push([(rnd() - 0.5) * w * 0.3, -R * 1.05, R * (0.4 + rnd() * 0.15)])
      // 离轮廓边多远（<0 在云里）
      const ciOf = (px: number, py: number) => {
        let d = 1e9
        for (const [cx, cy, r] of body) d = Math.min(d, Math.hypot(px - cx, py - cy) - r)
        return d
      }
      let x0 = 1e9,
        x1 = -1e9,
        y0 = 1e9,
        y1 = -1e9
      for (const [cx, cy, r] of body) {
        x0 = Math.min(x0, cx - r)
        x1 = Math.max(x1, cx + r)
        y0 = Math.min(y0, cy - r)
        y1 = Math.max(y1, cy + r)
      }
      // 2) 和图标下方的云一样：每层一张格子、每格随机一个圆，圆心要在轮廓里，越靠边越小；
      //    小圆、很小的圆只长在靠边的一圈，而且要和比它大的圆叠住一截（不会有飘在外面的小点）
      const circles: Circle[] = []
      const S = 0.62 / 1.2 // 中圆的格子和原来一样大（59px）
      const layer = (
        G: number,
        size: [number, number],
        band: number,
        bandFn: (ci: number) => number,
        attach: boolean,
      ) => {
        for (let gy = Math.floor((y0 - G) / G); gy <= Math.ceil((y1 + G) / G); gy++)
          for (let gx = Math.floor((x0 - G) / G); gx <= Math.ceil((x1 + G) / G); gx++) {
            const px = (gx + 0.1 + rnd() * 0.8) * G,
              py = (gy + 0.1 + rnd() * 0.8) * G
            const ci = ciOf(px, py)
            if (ci > 0 || ci < band) continue
            let r = G * (size[0] + (size[1] - size[0]) * rnd()) * bandFn(ci)
            if (attach) {
              let att = 0
              for (const [cx, cy, cr] of circles)
                att = Math.max(att, sstep(0.2 * r, 0.6 * r, cr + r - Math.hypot(cx - px, cy - py)))
              r *= att
            }
            r *= sstep(5, 11, r)
            if (r > 0.5) circles.push([px, py, r, rnd()])
          }
      }
      const Rm = R * S
      // 大圆：只长在云厚的地方（圆心在轮廓里够深），云里就有几个大圆弧
      const Gb = 90
      layer(Gb, [0.55, 0.85], -1e9, (ci) => sstep(-0.2 * Gb, -0.65 * Gb, ci), false)
      layer(Rm, [0.6, 0.95], -1e9, (ci) => sstep(-0.1 * Rm, -0.7 * Rm, ci), false)
      // 云的深处圆之间不能有缝：轮廓的大圆缩一点垫在底下
      for (const [cx, cy, r] of body)
        if (r > 0.75 * Rm) circles.push([cx, cy, r - 0.75 * Rm, rnd()])
      layer(
        34 * 0.85,
        [0.5, 0.9],
        -1.0 * Rm,
        (ci) => sstep(-0.05 * Rm, -0.35 * Rm, ci) * (1 - sstep(-0.7 * Rm, -1.0 * Rm, ci)),
        true,
      )
      layer(
        24 * 0.85,
        [0.45, 0.8],
        -0.6 * Rm,
        (ci) => sstep(0, -0.2 * Rm, ci) * (1 - sstep(-0.4 * Rm, -0.6 * Rm, ci)),
        true,
      )
      return { x, y, circles, v: 0.7 + rnd() * 0.6, grow: 0, hw: Math.max(-x0, x1) + 20 }
    }

    const stepSkyClouds = (dt: number) => {
      flowT += dt * P.flow // 云自己的时钟：流动速度越快，鼓包呼吸得也越快
      const want = Math.round(P.cover * 10)
      // 数量变少：多出来的慢慢缩小消失；变多：直接在画面里淡入（找一块别的小云不太挤的地方）
      const alive = skyClouds.filter((c) => !c.dying)
      for (let i = want; i < alive.length; i++) alive[i]!.dying = true
      for (let n = alive.length; n < want; n++) {
        let best = null,
          bestD = -1
        for (let k = 0; k < 20; k++) {
          const c = { x: Math.random() * W, y: 80 + Math.random() * (H - TASKBAR - 120) }
          const dmin = Math.min(
            1e9,
            ...skyClouds.map((o) => Math.hypot((o.x - c.x) / 1.6, o.y - c.y)),
          )
          if (dmin > bestD) {
            bestD = dmin
            best = c
          }
        }
        if (best) skyClouds.push(makeSkyCloud(best.x, best.y))
      }
      for (let i = skyClouds.length - 1; i >= 0; i--) {
        const c = skyClouds[i]!
        c.x += P.flow * 10 * c.v * dt // 流动速度 ×1 时约 10px/秒
        c.grow = c.dying ? c.grow - dt * 0.5 : Math.min(1, c.grow + dt * 0.5)
        if (c.grow <= 0) {
          skyClouds.splice(i, 1)
          continue
        }
        // 飘出画面：从上风那边画面外重新飘进来
        if (c.x - c.hw > W + 50) {
          const n = makeSkyCloud(-c.hw - 50)
          n.grow = 1
          skyClouds[i] = n
        }
      }
    }

    const sstep = (a: number, b: number, x: number) => {
      const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
      return t * t * (3 - 2 * t)
    }

    let massList: { circles: number[]; W: number; H: number } | null = null,
      massT = -1e9

    const buildMassCircles = () => {
      const list: number[] = []
      // 图标周围的云团：三层圆（大 / 小 / 很小），每层是一张固定的格子，每格随机放一个圆。
      // 圆的基础大小只看圆心在云团里多深，图标不动就不变；显不显示也按基础大小决定，
      // 最后才乘上很轻（±4%）、很慢（一圈 50~70 秒）的"呼吸" → 圆的大小不会忽大忽小
      const R = 95
      // big：大圆按格子存起来（用基础大小，不含呼吸），小圆要找得到挨着的大圆
      const big = new Map<string, [number, number, number]>()
      const layer = (
        G: number,
        k0: number,
        size: [number, number],
        band: [number, number, (ci: number) => number],
        isBig: boolean,
      ) => {
        if (!FB) return
        for (let cy = -Math.ceil((2 * R) / G); cy <= Math.ceil((H + 2 * R) / G); cy++)
          for (let cx = -Math.ceil((2 * R) / G); cx <= Math.ceil((W + 2 * R) / G); cx++) {
            const ox = rnd1(cx, cy, k0),
              oy = rnd1(cx, cy, k0 + 1),
              rr = rnd1(cx, cy, k0 + 2),
              ph = rnd1(cx, cy, k0 + 3)
            const x = (cx + 0.1 + ox * 0.8) * G,
              y = (cy + 0.1 + oy * 0.8) * G
            const ci = curS(x, y) - P.edge // 圆心处离云团边多远（<0 在云团里）
            if (ci > 0 || ci < band[1] - 10) continue
            let r = G * (size[0] + (size[1] - size[0]) * rr) * band[2](ci)
            // 要和云团连在一起：碰得到主体（主体边在 ci = -0.6R 处），或（小圆）和某个大圆叠住一截
            const gap = ci + 0.6 * R
            let att = sstep(gap - 4, gap + 12, r)
            if (!isBig) {
              const bx = Math.floor(x / R),
                by = Math.floor(y / R)
              for (let j = by - 1; j <= by + 1; j++)
                for (let i = bx - 1; i <= bx + 1; i++) {
                  const o = big.get(i + ',' + j)
                  if (!o) continue
                  const ov = o[2] + r - Math.hypot(o[0] - x, o[1] - y) // 叠住了多少
                  att = Math.max(att, sstep(0.2 * r, 0.6 * r, ov))
                }
            }
            r *= att
            r *= sstep(5, 11, r) // 太小的圆慢慢缩没，不留小点
            if (r < 0.5) continue
            if (isBig) big.set(cx + ',' + cy, [x, y, r])
            list.push(x, y, r * (1 + 0.04 * Math.sin(flowT * (0.09 + 0.035 * ph) + ph * 6.283)), ph)
          }
      }
      // 大圆：圆心在云团里，越靠云边越小
      layer(R, 1, [0.55, 0.9], [0, -1e9, (ci) => sstep(-0.15 * R, -0.8 * R, ci)], true)
      // 小圆：靠云边的一圈（再往里会被大圆盖住，看不见）
      layer(
        34,
        11,
        [0.5, 0.9],
        [0, -1.0 * R, (ci) => sstep(-0.05 * R, -0.3 * R, ci) * (1 - sstep(-0.7 * R, -1.0 * R, ci))],
        false,
      )
      // 很小的圆：贴着云边一圈，让轮廓上的小鼓包更多
      layer(
        24,
        21,
        [0.45, 0.8],
        [0, -0.6 * R, (ci) => sstep(0, -0.15 * R, ci) * (1 - sstep(-0.4 * R, -0.6 * R, ci))],
        false,
      )
      return list
    }

    // 云里的圆在动：每个圆绕着原来的位置慢慢转一个小圈（约 6~15px，大圆动得多一点，一圈 20~30 秒）。
    // 相邻的圆大致朝同一个方向走（整团云在轻轻翻动），每个圆再带一点自己的小动作。只动位置、不动大小
    const wobX = (x: number, y: number, r: number, ph: number) =>
      (4.5 + 0.12 * r) *
      (0.85 * Math.sin(flowT * 0.24 + x * 0.011 + y * 0.004) +
        0.3 * Math.sin(flowT * 0.3 + ph * 6.283))

    const wobY = (x: number, y: number, r: number, ph: number) =>
      (4.5 + 0.12 * r) *
      (0.65 * Math.sin(flowT * 0.2 + y * 0.013 - x * 0.006 + 1.7) +
        0.25 * Math.cos(flowT * 0.28 + ph * 6.283))

    const uploadCircles = (t: number) => {
      gl.activeTexture(gl.TEXTURE3) // 用第 3 号纹理单元，不要动到别的纹理
      const gw = Math.ceil(W / CELL_G) + 7,
        gh = Math.ceil(H / CELL_G) + 7 // 左、上多 4 格（右下方的云影要用到画面外的云），右、下多 3 格
      if (!circTex || gw !== cgW || gh !== cgH) {
        cgW = gw
        cgH = gh
        if (circTex) gl.deleteTexture(circTex)
        circTex = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, circTex)
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, gw * CIRC_K, gh)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        circBuf = new Float32Array(gw * CIRC_K * gh * 4)
      }
      // 图标周围云团的圆：只在图标挪动时（场在过渡）每帧重算，平时每 0.5 秒重算一次（呼吸很慢，看不出跳）
      const morphing = curMix < 1 || !massList || massList.W !== W || massList.H !== H
      if (morphing || t - massT > 0.5) {
        massList = { circles: buildMassCircles(), W, H }
        massT = t
      }
      const list = massList!.circles.slice()
      for (let i = 0; i < list.length; i += 4) {
        const x = list[i]!,
          y = list[i + 1]!,
          r = list[i + 2]!,
          ph = list[i + 3]!
        list[i] = x + wobX(x, y, r, ph)
        list[i + 1] = y + wobY(x, y, r, ph)
      }
      // 天上的小云
      for (const c of skyClouds) {
        const g = c.grow * c.grow * (3 - 2 * c.grow)
        c.circles.forEach(([dx, dy, r, ph], i) => {
          const rb = r * g * (1 + 0.04 * Math.sin(flowT * (0.09 + 0.035 * ph) + ph * 6.283 + i))
          if (rb > 0.5)
            list.push(c.x + dx + wobX(dx, dy, r, ph), c.y + dy + wobY(dx, dy, r, ph), rb, ph) // 天上的云：按云自己的坐标算，整朵飘的时候也在轻轻翻动
        })
      }
      // 分到格子里（圆盖到的每个格子都放一份；一个格子放不下就留大的）
      circBuf.fill(0)
      const cnt = new Uint8Array(gw * gh)
      const order = []
      for (let i = 0; i < list.length; i += 4) order.push(i)
      order.sort((a, b) => list[b + 2]! - list[a + 2]!)
      for (const i of order) {
        const x = list[i]!,
          y = list[i + 1]!,
          r = list[i + 2]! + 6
        const x0 = Math.max(0, Math.floor((x - r) / CELL_G) + 4),
          x1 = Math.min(gw - 1, Math.floor((x + r) / CELL_G) + 4)
        const y0 = Math.max(0, Math.floor((y - r) / CELL_G) + 4),
          y1 = Math.min(gh - 1, Math.floor((y + r) / CELL_G) + 4)
        for (let gy = y0; gy <= y1; gy++)
          for (let gx = x0; gx <= x1; gx++) {
            const ci = gy * gw + gx
            const nx = Math.max((gx - 4) * CELL_G, Math.min(x, (gx - 3) * CELL_G)),
              ny = Math.max((gy - 4) * CELL_G, Math.min(y, (gy - 3) * CELL_G))
            if ((nx - x) * (nx - x) + (ny - y) * (ny - y) > r * r) continue // 圆碰不到这个格子
            if (cnt[ci]! >= CIRC_K) continue
            const o = ((gy * gw + gx) * CIRC_K + cnt[ci]!++) * 4
            circBuf[o] = x
            circBuf[o + 1] = y
            circBuf[o + 2] = list[i + 2]!
            circBuf[o + 3] = list[i + 3]!
          }
      }
      gl.bindTexture(gl.TEXTURE_2D, circTex)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gw * CIRC_K, gh, gl.RGBA, gl.FLOAT, circBuf)
    }

    // 人物和投影使用局部纹理，合成到云层之下。
    const characters = createMeadowCharacters({
      gl,
      cv,
      resolution,
      program,
      assets,
      pendingImages,
      isDisposed: () => disposed,
      getScene: () => ({ width: W, height: H, seed, regions, options: P }),
    })

    const drawScene = (now: number) => {
      // 隐藏男孩时只保留路线状态，小猫仍能独立显示并避开男孩再次出现的路线。
      const boy = P.showBoy || P.showCat ? characters.prepareBoy(now, P.showBoy === 1) : null
      const actor = P.showBoy === 1 && boy?.rect ? boy : null
      const cats = P.showCat === 1 ? characters.prepareCat(boy, now) : []
      if (actor && !actorPR)
        actorPR = program(FS.replace('#version 300 es', '#version 300 es\n#define MEADOW_ACTOR'))
      // 小猫的局部绘制共享本帧云数据，不额外重算、上传云团。
      uploadCircles(now / 1000)
      const render = (renderer: MeadowProgram, cat: (typeof cats)[number] | null) => {
        const { p, U } = renderer
        gl.useProgram(p)
        gl.viewport(0, 0, cv.width, cv.height)
        gl.activeTexture(gl.TEXTURE9)
        gl.bindTexture(gl.TEXTURE_2D, groundTexture)
        gl.uniform1i(U.uMeadowGround!, 9)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, ftex[fromI]!)
        gl.activeTexture(gl.TEXTURE2)
        gl.bindTexture(gl.TEXTURE_2D, ftex[toI]!)
        gl.uniform1i(U.uFA!, 1)
        gl.uniform1i(U.uFB!, 2)
        gl.uniform2f(U.uRes!, cv.width / resolution.scale, cv.height / resolution.scale) // 和画布的实际像素对齐（innerWidth、innerHeight 是取整过的）
        gl.uniform2f(U.uGrid!, Gw, Gh)
        gl.uniform1f(U.uScale!, resolution.scale)
        gl.uniform1f(U.uStep!, STEP)
        gl.uniform1f(U.uMix!, curMix)
        gl.activeTexture(gl.TEXTURE3)
        gl.bindTexture(gl.TEXTURE_2D, circTex)
        gl.uniform1i(U.uCirc!, 3)
        gl.uniform2f(U.uCGrid!, cgW, cgH)
        gl.uniform1f(U.uCellG!, CELL_G)
        gl.uniform1f(U.uEdge!, P.edge)
        if (actor?.rect) {
          gl.activeTexture(gl.TEXTURE5)
          gl.bindTexture(gl.TEXTURE_2D, actor.actor ?? null)
          gl.uniform1i(U.uActor!, 5)
          gl.activeTexture(gl.TEXTURE6)
          gl.bindTexture(gl.TEXTURE_2D, actor.shadow ?? null)
          gl.uniform1i(U.uActorShadow!, 6)
          gl.uniform4f(U.uActorRect!, ...actor.rect)
        }
        if (cat) {
          gl.activeTexture(gl.TEXTURE8)
          gl.bindTexture(gl.TEXTURE_2D, cat.texture)
          gl.uniform1i(U.uCat!, 8)
          gl.uniform4f(U.uCatRect!, ...cat.rect)
          gl.uniform2f(U.uCatShadow!, ...cat.shadow)
          gl.uniform1f(U.uCatTail!, cat.tail)
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      }
      render(actor ? actorPR! : PR, null)
      if (cats.length) {
        if (actor && !catActorPR)
          catActorPR = program(
            FS.replace(
              '#version 300 es',
              '#version 300 es\n#define MEADOW_ACTOR\n#define MEADOW_CAT',
            ),
          )
        if (!actor && !catPR)
          catPR = program(FS.replace('#version 300 es', '#version 300 es\n#define MEADOW_CAT'))
        gl.enable(gl.SCISSOR_TEST)
        try {
          for (const cat of cats) {
            const k = resolution.scale,
              [x, y, w, h] = cat.bounds
            const left = Math.max(0, Math.floor(x * k)),
              top = Math.max(0, Math.floor(y * k))
            const right = Math.min(cv.width, Math.ceil((x + w) * k)),
              bottom = Math.min(cv.height, Math.ceil((y + h) * k))
            gl.scissor(
              left,
              cv.height - bottom,
              Math.max(0, right - left),
              Math.max(0, bottom - top),
            )
            render((actor ? catActorPR : catPR)!, cat)
          }
        } finally {
          gl.disable(gl.SCISSOR_TEST)
        }
      }
    }

    const resize = (bounds: MeadowBounds | null) => {
      const width = window.innerWidth
      const height = window.innerHeight
      const scale = Math.min(window.devicePixelRatio || 1, P.quality)
      const box = cv.getBoundingClientRect()
      const pixelWidth = Math.max(1, Math.round((box.width || width) * scale))
      const pixelHeight = Math.max(1, Math.round((box.height || height) * scale))
      if (
        initialized &&
        W === width &&
        H === height &&
        resolution.scale === scale &&
        cv.width === pixelWidth &&
        cv.height === pixelHeight
      )
        return
      W = width
      H = height
      lastBounds = bounds
      regions = bounds ? [{ x: bounds.left, y: bounds.top, w: bounds.width, h: bounds.height }] : []
      resolution.scale = scale
      Gw = Math.ceil(W / STEP) + 2
      Gh = Math.ceil(H / STEP) + 2
      buildNoise()
      allocField()
      refresh()
      massList = null
      gl.activeTexture(gl.TEXTURE9)
      gl.bindTexture(gl.TEXTURE_2D, groundTexture)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        pixelWidth,
        pixelHeight,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      )
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.bindFramebuffer(gl.FRAMEBUFFER, groundFramebuffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, groundTexture, 0)
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error('Could not create meadow framebuffer')
      gl.viewport(0, 0, pixelWidth, pixelHeight)
      gl.useProgram(groundPR.p)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, noiseTex)
      gl.uniform1i(groundPR.U.uNoise!, 0)
      gl.uniform2f(groundPR.U.uRes!, pixelWidth / scale, pixelHeight / scale)
      gl.uniform1f(groundPR.U.uScale!, scale)
      gl.uniform1f(groundPR.U.uSeed!, (seed % 997) * 0.37)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      // 保留旧画面直到新缓存准备好；修改画布尺寸后由调用方同一任务内立即重绘。
      if (cv.width !== pixelWidth) cv.width = pixelWidth
      if (cv.height !== pixelHeight) cv.height = pixelHeight
      initialized = true
    }

    const draw = (
      time: number,
      bounds: MeadowBounds | null,
      options: MeadowOptions,
      avoidCenter: boolean,
    ) => {
      sceneNow = time * 1000
      const changed =
        bounds?.left !== lastBounds?.left ||
        bounds?.top !== lastBounds?.top ||
        bounds?.width !== lastBounds?.width ||
        bounds?.height !== lastBounds?.height
      const sizeChanged = P.sigma !== options.cloudSize
      P.sigma = options.cloudSize
      P.cover = options.cloudCover
      P.flow = options.flow
      P.showBoy = options.showBoy ? 1 : 0
      P.showCat = options.showCat ? 1 : 0
      P.avoidCenter = avoidCenter
      if (changed || sizeChanged) {
        lastBounds = bounds
        regions = bounds
          ? [{ x: bounds.left, y: bounds.top, w: bounds.width, h: bounds.height }]
          : []
        commit(!FB)
        massList = null
      }
      const dt =
        lastSceneNow === null ? 0.03 : Math.min(Math.max((sceneNow - lastSceneNow) / 1000, 0), 0.1)
      lastSceneNow = sceneNow
      const e = Math.min(Math.max((sceneNow - morphT0) / morphDur, 0), 1)
      curMix = e < 0.5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2
      stepSkyClouds(dt)
      drawScene(sceneNow)
    }
    buildNoiseTex()
    return {
      resize,
      draw,
      moveBoy(x: number, y: number) {
        characters.moveBoy(x, y)
      },
      dispose() {
        disposed = true
        for (const image of pendingImages) {
          image.onload = null
          image.onerror = null
          image.src = ''
        }
        pendingImages.clear()
        gl.getExtension('WEBGL_lose_context')?.loseContext()
      },
    }
  } catch (error) {
    disposed = true
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    throw error
  }
}
