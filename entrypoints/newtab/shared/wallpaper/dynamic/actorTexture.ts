/** Small float texture for actor attributes indexed by the active scene count. */
export function createActorTexture(gl: WebGL2RenderingContext, unit: number) {
  const texture = gl.createTexture()
  if (!texture) throw new Error('Could not create actor texture')
  let data = new Float32Array(4)
  let allocated = 0
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  return {
    reserve(texels: number) {
      if (texels * 4 > data.length) data = new Float32Array(texels * 4)
      return data
    },
    upload(texels: number) {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      const width = data.length / 4
      if (width !== allocated) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, 1, 0, gl.RGBA, gl.FLOAT, null)
        allocated = width
      }
      if (texels) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, texels, 1, gl.RGBA, gl.FLOAT, data)
    },
  }
}
