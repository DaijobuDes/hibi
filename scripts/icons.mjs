import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Regenerate the committed native icons from the supplied PNG on macOS.
const folder = await mkdtemp(join(tmpdir(), 'hibi-icon-'))
const source = resolve('build/icon.png')
try {
  const { mkdir } = await import('node:fs/promises')
  const iconset = join(folder, 'hibi.iconset')
  await mkdir(iconset)
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      execFileSync(
        'sips',
        [
          '-z',
          String(size * scale),
          String(size * scale),
          source,
          '--out',
          join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`),
        ],
        { stdio: 'ignore' },
      )
    }
  }
  execFileSync('iconutil', [
    '-c',
    'icns',
    iconset,
    '-o',
    resolve('build/icon.icns'),
  ])
  const images = await Promise.all(
    [16, 32, 128, 256].map(async (size) => ({
      size,
      png: await readFile(join(iconset, `icon_${size}x${size}.png`)),
    })),
  )
  const header = Buffer.alloc(6 + images.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, png }, index) => {
    const at = 6 + index * 16
    header[at] = header[at + 1] = size === 256 ? 0 : size
    header.writeUInt16LE(1, at + 4)
    header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(png.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += png.length
  })
  await writeFile(
    'build/icon.ico',
    Buffer.concat([header, ...images.map(({ png }) => png)]),
  )
} finally {
  await rm(folder, { recursive: true, force: true })
}
