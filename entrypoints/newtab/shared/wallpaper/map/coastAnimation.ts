import { createFieldTextures } from '../dynamic/fieldTextures'
import { snapshotField } from '../dynamic/fieldTransition'

import type { MapField, Point } from './model'

const vertex = `#version 300 es
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}`
// Transparent shore-only transition. Static details stay on the native-DPR
// canvas below: only small paper and shared field textures are uploaded.
const fragment = `#version 300 es
precision highp float;
uniform sampler2D uFrom,uTo,uPaper;
uniform vec2 uGrid,uWorld,uCanvas;
uniform float uStep,uMix,uScale,uFirst;
out vec4 color;
float stroke(float d,float width){float aa=max(.01,fwidth(d)*.65);return 1.-smoothstep(max(0.,width*.5-aa),width*.5+aa,abs(d));}
void main(){
 vec2 p=vec2(gl_FragCoord.x,uCanvas.y-gl_FragCoord.y)/uScale;
 vec2 uv=p/uWorld,fieldUV=(p/uStep+.5)/uGrid;
 vec3 paper=texture(uPaper,uv).rgb,sea=vec3(247.,229.,184.)/255.;
 float to=texture(uTo,fieldUV).r,raw=mix(texture(uFrom,fieldUV).r,to,uMix);
 float d=raw;
 float wet=1.-smoothstep(-.65,.65,d);
 float cover=uFirst>0.5?1.:(abs(to)<4. || (raw<0.)!=(to<0.))?1.:0.;
 vec3 base=mix(paper,sea,wet);
 float pixel=max(length(vec2(dFdx(d),dFdy(d))),.1/uScale);
 float ink=max(stroke(d,pixel*1.7),max(stroke(d-5.,pixel*.85)*.6,stroke(d-10.,pixel*.7)*.42));
 float inkAlpha=ink*.93,alpha=cover+(1.-cover)*inkAlpha;
 vec3 premult=base*cover*(1.-inkAlpha)+vec3(101.,67.,35.)/255.*inkAlpha;
 float visible=1.-smoothstep(.74,1.,uMix);
 color=vec4(premult*visible,alpha*visible);
}`

export function createCoastAnimation(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    powerPreference: 'low-power',
  })
  let from: Float32Array = new Float32Array(),
    to: Float32Array = new Float32Array(),
    cols = 0,
    rows = 0,
    step = 12
  let started = 0,
    duration = 2.6,
    currentMix = 1,
    active = false,
    disabled = !gl,
    worldWidth = 1,
    worldHeight = 1,
    renderScale = 1
  let firstTransition = false
  let program: WebGLProgram | null = null,
    vao: WebGLVertexArrayObject | null = null
  let paper: WebGLTexture | null = null
  const fields = gl ? createFieldTextures(gl) : null
  const uniforms: Record<string, WebGLUniformLocation | null> = {}
  canvas.hidden = true
  if (gl) {
    const compile = (kind: number, source: string) => {
      const shader = gl.createShader(kind)!
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(shader)
        gl.deleteShader(shader)
        throw new Error(error || 'Map transition shader failed')
      }
      return shader
    }
    const vs = compile(gl.VERTEX_SHADER, vertex),
      fs = compile(gl.FRAGMENT_SHADER, fragment)
    program = gl.createProgram()!
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) || 'Map transition program failed')
    vao = gl.createVertexArray()
    for (const name of [
      'uFrom',
      'uTo',
      'uPaper',
      'uGrid',
      'uWorld',
      'uCanvas',
      'uStep',
      'uMix',
      'uScale',
      'uFirst',
    ])
      uniforms[name] = gl.getUniformLocation(program, name)
  }
  const ease = (t: number) => {
    t = Math.max(0, Math.min(1, t))
    return t * t * (3 - 2 * t)
  }
  function releaseImages() {
    if (gl) {
      gl.deleteTexture(paper)
    }
    paper = null
  }
  function finish() {
    active = false
    currentMix = 1
    firstTransition = false
    canvas.hidden = true
    canvas.width = canvas.height = 1
    releaseImages()
  }
  function resize() {
    if (!active) return
    renderScale = Math.min(1, devicePixelRatio || 1)
    // Keep this layer in the same buffered world coordinates as the 2D map.
    // Window dragging only clips it; it must not reallocate a GL framebuffer
    // for every pixel of the drag.
    const width = worldWidth,
      height = worldHeight
    const w = Math.ceil(width * renderScale),
      h = Math.ceil(height * renderScale)
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    if (canvas.style.width !== `${width}px`) canvas.style.width = `${width}px`
    if (canvas.style.height !== `${height}px`) canvas.style.height = `${height}px`
  }
  function upload(bitmap: ImageBitmap) {
    const texture = gl!.createTexture()!
    gl!.bindTexture(gl!.TEXTURE_2D, texture)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, bitmap)
    return texture
  }
  function begin(
    bitmap: ImageBitmap,
    paperBitmap: ImageBitmap,
    field: MapField,
    scale: number,
    time: number,
    animate: boolean,
  ) {
    const first = !to.length
    const sameTarget =
      !first &&
      cols === field.cols &&
      rows === field.rows &&
      to.every((value, i) => Math.abs(value - field.values[i]!) < 0.01)
    if (sameTarget) {
      if (!animate || disabled) finish()
      return
    }
    const mix = active ? ease((time - started) / duration) : 1
    const before = first
      ? new Float32Array(field.values.length).fill(34)
      : snapshotField(from, to, mix, cols, rows, field.cols, field.rows, 34, field.step)
    const changed = before.some(
      (value, i) =>
        Math.abs(value - field.values[i]!) > 0.4 && Math.min(value, field.values[i]!) < 30,
    )
    from = before
    to = field.values
    cols = field.cols
    rows = field.rows
    step = field.step
    worldWidth = bitmap.width / scale
    worldHeight = bitmap.height / scale
    if (!animate || disabled || !changed) {
      finish()
      return
    }
    releaseImages()
    paper = upload(paperBitmap)
    fields!.resize(cols, rows)
    fields!.upload(0, from)
    fields!.upload(1, to)
    started = time
    firstTransition = first
    duration = first ? 2.6 : 1.8
    currentMix = 0
    active = true
    canvas.hidden = false
    resize()
  }
  function draw(time: number, animate = true) {
    if (!active) return false
    if (!animate || disabled) {
      finish()
      return false
    }
    currentMix = ease((time - started) / duration)
    if (currentMix >= 1) {
      finish()
      return false
    }
    resize()
    gl!.viewport(0, 0, canvas.width, canvas.height)
    gl!.useProgram(program)
    gl!.bindVertexArray(vao)
    ;[fields!.textures[0]!, fields!.textures[1]!, paper].forEach((texture, i) => {
      gl!.activeTexture(gl!.TEXTURE0 + i)
      gl!.bindTexture(gl!.TEXTURE_2D, texture)
    })
    gl!.uniform1i(uniforms.uFrom!, 0)
    gl!.uniform1i(uniforms.uTo!, 1)
    gl!.uniform1i(uniforms.uPaper!, 2)
    gl!.uniform2f(uniforms.uGrid!, cols, rows)
    gl!.uniform2f(uniforms.uWorld!, worldWidth, worldHeight)
    gl!.uniform2f(uniforms.uCanvas!, canvas.width, canvas.height)
    gl!.uniform1f(uniforms.uStep!, step)
    gl!.uniform1f(uniforms.uMix!, currentMix)
    gl!.uniform1f(uniforms.uScale!, renderScale)
    gl!.uniform1f(uniforms.uFirst!, firstTransition ? 1 : 0)
    gl!.drawArrays(gl!.TRIANGLES, 0, 3)
    return true
  }
  function value(p: Point) {
    if (!to.length) return 34
    const x = Math.max(0, Math.min(cols - 1.001, p.x / step)),
      y = Math.max(0, Math.min(rows - 1.001, p.y / step)),
      ix = Math.floor(x),
      iy = Math.floor(y),
      tx = x - ix,
      ty = y - iy
    const sample = (values: Float32Array) => {
      const i = iy * cols + ix
      return (
        (values[i]! * (1 - tx) + values[i + 1]! * tx) * (1 - ty) +
        (values[i + cols]! * (1 - tx) + values[i + cols + 1]! * tx) * ty
      )
    }
    return sample(from) * (1 - currentMix) + sample(to) * currentMix
  }
  return {
    isActive: () => active,
    begin,
    draw,
    resize,
    visibility: (p: Point, water: boolean) =>
      Math.max(0, Math.min(1, (water ? -value(p) : value(p)) / 8)),
    loseContext() {
      disabled = true
      finish()
    },
    dispose() {
      finish()
      if (gl) {
        for (const texture of fields!.textures) gl.deleteTexture(texture)
        gl.deleteProgram(program)
        gl.deleteVertexArray(vao)
      }
    },
  }
}
