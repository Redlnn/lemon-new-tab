/** Pair of distance-field textures and a reusable float16 upload buffer. */
export function createFieldTextures(gl: WebGL2RenderingContext) {
  const textures = [gl.createTexture(), gl.createTexture()]
  if (textures.some((texture) => !texture)) throw new Error('Could not create field textures')
  const value = new Float32Array(1)
  const bits = new Uint32Array(value.buffer)
  let width = 0
  let height = 0
  let data = new Uint16Array(0)

  function resize(nextWidth: number, nextHeight: number) {
    if (width === nextWidth && height === nextHeight) return
    width = nextWidth
    height = nextHeight
    data = new Uint16Array(width * height)
    for (const texture of textures) {
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, width, height, 0, gl.RED, gl.HALF_FLOAT, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
  }

  function upload(index: number, field: Float32Array) {
    for (let i = 0; i < data.length; i++) {
      value[0] = field[i]!
      const x = bits[0]!
      const sign = (x >>> 16) & 0x8000
      const exponent = ((x >>> 23) & 255) - 112
      data[i] =
        exponent <= 0
          ? sign
          : exponent >= 31
            ? sign | 0x7c00
            : sign | (exponent << 10) | ((x & 0x7fffff) >>> 13)
    }
    gl.bindTexture(gl.TEXTURE_2D, textures[index]!)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.HALF_FLOAT, data)
  }

  return { textures, resize, upload }
}
