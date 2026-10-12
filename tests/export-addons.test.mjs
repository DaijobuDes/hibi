import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { exportAddons } from '../scripts/export-addons.mjs'

test('addon catalog export keeps metadata, markdown, and relative images without runtime code or audio', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hibi-catalog-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'),
    destination = join(root, 'export')
  await mkdir(join(source, 'sample/images'), { recursive: true })
  for (const [file, contents] of Object.entries({
    'authors.ts': 'static authors',
    'sample/manifest.ts': 'static manifest',
    'sample/hibi-addon.json': '{"id":"sample"}',
    'sample/README.md': '![preview](images/preview.png)',
    'sample/guide.md': 'More help',
    'sample/images/preview.png': 'image bytes',
    'sample/index.ts': 'throw new Error("never execute")',
    'sample/sound.mp3': 'audio bytes',
  }))
    await writeFile(join(source, file), contents)
  const files = await exportAddons(source, destination)
  assert.equal(files.length, 6)
  assert.equal(
    await readFile(join(destination, 'sample/hibi-addon.json'), 'utf8'),
    '{"id":"sample"}',
  )
  assert.equal(
    await readFile(join(destination, 'sample/README.md'), 'utf8'),
    '![preview](images/preview.png)',
  )
  assert.equal(
    await readFile(join(destination, 'sample/images/preview.png'), 'utf8'),
    'image bytes',
  )
  assert.ok(!files.some((file) => /index\.ts|mp3/.test(file)))
  await rm(join(source, 'sample/guide.md'))
  await exportAddons(source, destination)
  assert.ok(!(await readdir(join(destination, 'sample'))).includes('guide.md'))
})
