// Headed WebGL regression. Stage the six-card menu, use a 375x667 @2x
// viewport, then call assertCardPixelSeams(canvas, wasmExports.frame).
// Render/read in one JS task: the default framebuffer need not be preserved.
export function assertCardPixelSeams(canvas, render) {
  const gl = canvas.getContext('webgl2')
  if (!gl) throw new Error('WebGL2 is required for the card pixel regression')
  render(0)
  const zoom = Math.max(320 / canvas.width, 240 / canvas.height)
  const y = Math.floor(canvas.height / 2 + 50 / zoom)
  const samples = []
  // Empty space between the central card's header and title, crossing atlas
  // cell boundaries. A nearest-sampled UV endpoint used to pick a transparent
  // texel from the next atlas cell and expose the world as a one-pixel seam.
  for (const worldX of [-16, 0, 16]) {
    const x = Math.floor(canvas.width / 2 + worldX / zoom)
    const pixels = new Uint8Array(7 * 4)
    gl.readPixels(x - 3, y, 7, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    for (let i = 0; i < 7; ++i) {
      const rgba = Array.from(pixels.slice(i * 4, i * 4 + 4))
      samples.push({x: x - 3 + i, y, rgba})
      if (rgba.some((value, channel) => value !== [9,13,19,255][channel]))
        throw new Error(`Card atlas seam at ${x - 3 + i},${y}: ${rgba.join(',')}; expected 9,13,19,255`)
    }
  }
  return samples
}
