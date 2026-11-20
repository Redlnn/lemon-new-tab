export function createOceanWhaleTexture(
  gl: WebGL2RenderingContext,
  url: string,
  pendingImages: Set<HTMLImageElement>,
  isDisposed: () => boolean,
) {
  const texture = gl.createTexture()
  if (!texture) throw new Error('Could not create whale texture')
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  const image = new Image()
  image.crossOrigin = 'anonymous'
  pendingImages.add(image)
  image.onload = () => {
    pendingImages.delete(image)
    image.onload = null
    image.onerror = null
    if (isDisposed()) return
    const previous = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null
    const limit = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    let source: TexImageSource = image
    if (image.naturalWidth > limit || image.naturalHeight > limit) {
      const scale = Math.min(limit / image.naturalWidth, limit / image.naturalHeight)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.floor(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.floor(image.naturalHeight * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Could not resize whale texture')
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      source = canvas
    }
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.bindTexture(gl.TEXTURE_2D, previous)
  }
  image.onerror = () => {
    pendingImages.delete(image)
    image.onload = null
    image.onerror = null
    if (!isDisposed()) console.error('[ocean] Could not load whale image')
  }
  image.src = url
  return texture
}
