// The cellular texture is generated once at a small fixed size. Both water
// scenes reuse it rather than evaluating a Voronoi search at every pixel.
export const waterCausticsShader = `
uniform sampler2D uWaterCaustics;
uniform float uWaterCausticsEnabled;
float waterCaustics(vec2 p, float time) {
  if (uWaterCausticsEnabled < .5) return 0.;
  vec2 drift = vec2(time * 1.5, time * .65);
  vec2 noise = texture(uNoise, p / 640. + vec2(time * .001, -time * .0007)).rg - .5;
  vec2 warp = vec2(
    sin(p.y * .013 + time * .23) + .4 * sin(p.x * .022 - time * .15),
    cos(p.x * .015 - time * .19) + .35 * cos(p.y * .018 + time * .22)
  ) * 23. + noise * 55.;
  vec2 a = (p + drift + warp) / 720.;
  vec2 b = mat2(.8, .6, -.6, .8) * (p - drift * .65 - warp) / 920.;
  float first = texture(uWaterCaustics, a).r;
  float second = texture(uWaterCaustics, b).r;
  return clamp(first * .82 + second * .28, 0., 1.);
}`

export function createWaterCaustics(gl: WebGL2RenderingContext) {
  const vertex = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2. - 1., 0., 1.);
}`
  const fragment = `#version 300 es
precision highp float;
out vec4 color;
vec2 seed(vec2 p) {
  p = mod(p, 8.);
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}
void main() {
  vec2 p = gl_FragCoord.xy / 256. * 8.;
  vec2 cell = floor(p), f = fract(p);
  float d1 = 9., d2 = 9.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 offset = vec2(float(x), float(y));
    vec2 delta = offset + .15 + .7 * seed(cell + offset) - f;
    float d = dot(delta, delta);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  float edge = sqrt(d2) - sqrt(d1);
  float line = 1. - smoothstep(.018, .11, edge);
  color = vec4(line, line, line, 1.);
}`
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('Could not create water shader')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader) || 'Water shader compilation failed')
    return shader
  }
  const texture = gl.createTexture()
  const framebuffer = gl.createFramebuffer()
  const program = gl.createProgram()
  const vao = gl.createVertexArray()
  if (!texture || !framebuffer || !program || !vao)
    throw new Error('Could not create water texture')
  const vs = compile(gl.VERTEX_SHADER, vertex)
  const fs = compile(gl.FRAGMENT_SHADER, fragment)
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program) || 'Water shader linking failed')
  const oldFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null
  const oldProgram = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null
  const oldVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null
  const oldViewport = gl.getParameter(gl.VIEWPORT) as Int32Array
  const oldTexture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
    throw new Error('Could not create water framebuffer')
  gl.viewport(0, 0, 256, 256)
  gl.bindVertexArray(vao)
  gl.useProgram(program)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  gl.bindFramebuffer(gl.FRAMEBUFFER, oldFramebuffer)
  gl.bindVertexArray(oldVao)
  gl.useProgram(oldProgram)
  gl.viewport(oldViewport[0]!, oldViewport[1]!, oldViewport[2]!, oldViewport[3]!)
  gl.bindTexture(gl.TEXTURE_2D, oldTexture)
  gl.deleteVertexArray(vao)
  gl.deleteProgram(program)
  gl.deleteFramebuffer(framebuffer)
  return texture
}
