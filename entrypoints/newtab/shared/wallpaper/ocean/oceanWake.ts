import type { OceanWakeSubject } from './oceanMotion'

// Foam particles use recorded world-space stern positions. The trail remains
// behind when a boat turns or the viewport changes.
export function createOceanWake(gl: WebGL2RenderingContext) {
  const vertex = `#version 300 es
in vec4 point;
uniform vec2 size;
out float opacity;
void main() { gl_Position = vec4(point.x / size.x * 2. - 1., 1. - point.y / size.y * 2., 0., 1.); opacity = point.z; gl_PointSize = point.w; }`
  const fragment = `#version 300 es
precision mediump float;
in float opacity;
out vec4 color;
void main() {
  float distance = length(gl_PointCoord - vec2(.5)) * 2.;
  float soft = 1. - smoothstep(.15, 1., distance);
  color = vec4(.88, .95, 1., opacity * soft);
}`
  const compile = (kind: number, source: string) => {
    const shader = gl.createShader(kind)
    if (!shader) throw new Error('Could not create wake shader')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader) || 'Wake shader failed')
    return shader
  }
  const program = gl.createProgram()
  const texture = gl.createTexture()
  const framebuffer = gl.createFramebuffer()
  const vao = gl.createVertexArray()
  const buffer = gl.createBuffer()
  if (!program || !texture || !framebuffer || !vao || !buffer)
    throw new Error('Could not create wake renderer')
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex))
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program) || 'Wake program failed')
  const sceneVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  const vertices = new Float32Array(6 * 60 * 8 * 4)
  gl.bufferData(gl.ARRAY_BUFFER, vertices.byteLength, gl.DYNAMIC_DRAW)
  const location = gl.getAttribLocation(program, 'point')
  const sizeLocation = gl.getUniformLocation(program, 'size')
  gl.enableVertexAttribArray(location)
  gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 0, 0)
  gl.bindVertexArray(sceneVao)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  let previousWidth = 0,
    previousHeight = 0

  function draw(subjects: OceanWakeSubject[], now: number, width: number, height: number) {
    const textureWidth = Math.max(1, Math.ceil(width)),
      textureHeight = Math.max(1, Math.ceil(height))
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    if (textureWidth !== previousWidth || textureHeight !== previousHeight) {
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        textureWidth,
        textureHeight,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      )
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error('Could not create wake framebuffer')
      previousWidth = textureWidth
      previousHeight = textureHeight
    }
    gl.viewport(0, 0, textureWidth, textureHeight)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    let used = 0
    for (const subject of subjects) {
      if (subject.kind > 1) continue
      for (const point of subject.trail) {
        const age = Math.max(0, now - point.time)
        const fade = Math.max(0, 1 - age / 8)
        const spread = (subject.kind === 0 ? 3 : 5) + age * 2.4
        const normalX = -Math.sin(point.heading),
          normalY = Math.cos(point.heading)
        const emit = (offset: number, alpha: number, size: number) => {
          vertices[used++] = point.x + normalX * offset
          vertices[used++] = point.y + normalY * offset
          vertices[used++] = alpha * fade
          vertices[used++] = size
        }
        // Stable jitter is tied to each recorded position, rather than changing
        // randomly every frame. The specks drift apart as the foam ages.
        const seed = point.time * 31.7 + subject.phase * 13.1
        const random = (n: number) => {
          const value = Math.sin(seed + n * 19.3) * 43758.5453
          return value - Math.floor(value)
        }
        for (const side of [-1, 1]) {
          for (let i = 0; i < 3; i++)
            emit(
              side * spread + (random(i + side * 5) - 0.5) * (3 + age * 0.5),
              0.22,
              2.5 + random(i + 4) * 2.5,
            )
        }
        // A motor yacht also leaves a lighter stream of propeller bubbles.
        if (subject.kind === 1)
          for (let i = 0; i < 2; i++)
            emit((random(i + 17) - 0.5) * (4 + age * 1.2), 0.14, 2 + random(i + 21) * 2)
      }
    }
    if (used) {
      gl.useProgram(program)
      gl.uniform2f(sizeLocation, width, height)
      gl.bindVertexArray(vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices.subarray(0, used))
      gl.enable(gl.BLEND)
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.drawArrays(gl.POINTS, 0, used / 4)
      gl.disable(gl.BLEND)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindVertexArray(sceneVao)
    return texture
  }
  return { draw }
}
