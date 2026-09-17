const { app, nativeImage } = require('electron')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')

// Native image conversion only: no windows or Dock presence during generation.
if (process.platform === 'darwin') app.setActivationPolicy('accessory')
const [source, directory] = process.argv.slice(2)
const artwork = nativeImage.createFromPath(source)
if (artwork.isEmpty()) throw new Error('could not read app icon')
for (const [platform, fraction] of [
  ['mac', 0.8],
  ['win', 0.875],
  ['linux', 0.875],
]) {
  for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
    const inner = Math.round(size * fraction)
    const inset = Math.floor((size - inner) / 2)
    const pixels = artwork
      .resize({ width: inner, height: inner, quality: 'best' })
      .toBitmap()
    const canvas = Buffer.alloc(size * size * 4)
    for (let row = 0; row < inner; row++)
      pixels.copy(
        canvas,
        ((row + inset) * size + inset) * 4,
        row * inner * 4,
        (row + 1) * inner * 4,
      )
    writeFileSync(
      join(directory, `${platform}-${size}.png`),
      nativeImage
        .createFromBitmap(canvas, { width: size, height: size })
        .toPNG(),
    )
  }
}
app.quit()
