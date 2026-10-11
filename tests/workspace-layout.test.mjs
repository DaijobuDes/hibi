import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'

const bundle = await build({
  entryPoints: ['src/main/workspace-layout.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  write: false,
})
const module = { exports: {} }
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(
  module,
  module.exports,
  createRequire(import.meta.url),
)
const { moveTableLayout, readTableLayout, writeTableLayout } = module.exports

const table = (key, columns = [120, 0], rows = null) => ({
  key,
  columns,
  rows,
})

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'hibi-layout-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'notes'))
  await writeFile(join(root, 'a.md'), '')
  await writeFile(join(root, 'notes/b.md'), '')
  return root
}

const stored = async (root) =>
  JSON.parse(await readFile(join(root, '.hibi/layout.json'), 'utf8'))

test('table layout is created lazily, read back, and pruned', async (t) => {
  const root = await workspace(t)
  await writeTableLayout(root, 'a.md', [])
  await assert.rejects(stat(join(root, '.hibi')), { code: 'ENOENT' })
  assert.deepEqual(await readTableLayout(root, 'a.md'), [])

  await writeTableLayout(root, 'a.md', [
    table('0:abc'),
    table('1:def', null, [0, 48]),
    table('2:auto', [0, 0], [0]),
  ])
  await writeTableLayout(root, 'notes/b.md', [table('0:b')])
  assert.deepEqual(await readTableLayout(root, 'a.md'), [
    table('0:abc'),
    table('1:def', null, [0, 48]),
  ])
  assert.deepEqual(Object.keys((await stored(root)).documents), [
    'a.md',
    'notes/b.md',
  ])

  await rm(join(root, 'notes/b.md'))
  await writeTableLayout(root, 'a.md', [table('0:abc', [90])])
  assert.deepEqual(await stored(root), {
    version: 1,
    documents: { 'a.md': { tables: [table('0:abc', [90])] } },
  })
  await writeTableLayout(root, 'a.md', [])
  assert.deepEqual(await stored(root), { version: 1, documents: {} })
})

test('table layout follows renames and moves inside the workspace', async (t) => {
  const root = await workspace(t)
  await writeTableLayout(root, 'a.md', [table('0:a')])
  await writeTableLayout(root, 'notes/b.md', [table('0:b')])
  await moveTableLayout(root, 'a.md', 'renamed.md')
  await moveTableLayout(root, 'notes', 'archive/notes')
  assert.deepEqual(Object.keys((await stored(root)).documents).sort(), [
    'archive/notes/b.md',
    'renamed.md',
  ])
  assert.deepEqual(await readTableLayout(root, 'renamed.md'), [table('0:a')])
})

test('table layout validates sizes and paths', async (t) => {
  const root = await workspace(t)
  for (const input of [
    null,
    [{ key: 1, columns: null, rows: null }],
    [table('0:a', [-1])],
    [table('0:a', [1.5])],
    [table('0:a', [10001])],
    [table('x'.repeat(65))],
  ])
    await assert.rejects(writeTableLayout(root, 'a.md', input), /invalid/)
  for (const path of ['', '../a.md', '/a.md', 'notes/../a.md', 'a\\b.md'])
    await assert.rejects(writeTableLayout(root, path, []), /workspace/)
  await assert.rejects(stat(join(root, '.hibi')), { code: 'ENOENT' })
})

test('table layout ignores damaged entries and refuses newer files', async (t) => {
  const root = await workspace(t)
  await mkdir(join(root, '.hibi'))
  await writeFile(
    join(root, '.hibi/layout.json'),
    JSON.stringify({
      version: 1,
      documents: {
        'a.md': { tables: [table('0:a')] },
        'notes/b.md': { tables: 'broken' },
        '../outside.md': { tables: [table('0:x')] },
      },
    }),
  )
  assert.deepEqual(await readTableLayout(root, 'a.md'), [table('0:a')])
  assert.deepEqual(await readTableLayout(root, 'notes/b.md'), [])
  await writeFile(join(root, '.hibi/layout.json'), '{')
  assert.deepEqual(await readTableLayout(root, 'a.md'), [])
  await writeFile(
    join(root, '.hibi/layout.json'),
    JSON.stringify({ version: 2, documents: {} }),
  )
  await assert.rejects(readTableLayout(root, 'a.md'), /newer version/)
  await assert.rejects(writeTableLayout(root, 'a.md', []), /newer version/)
})

test('table layout refuses a symbolic .hibi folder or layout file', async (t) => {
  const root = await workspace(t)
  const outside = await mkdtemp(join(tmpdir(), 'hibi-layout-outside-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await symlink(outside, join(root, '.hibi'), 'dir')
  await assert.rejects(readTableLayout(root, 'a.md'), /symbolic link/)
  await assert.rejects(
    writeTableLayout(root, 'a.md', [table('0:a')]),
    /symbolic link/,
  )
  await assert.rejects(stat(join(outside, 'layout.json')), { code: 'ENOENT' })

  await rm(join(root, '.hibi'))
  await mkdir(join(root, '.hibi'))
  await writeFile(join(outside, 'layout.json'), '{"version":1,"documents":{}}')
  await symlink(join(outside, 'layout.json'), join(root, '.hibi/layout.json'))
  await assert.rejects(readTableLayout(root, 'a.md'), /Cannot read/)
})

test('concurrent table layout writes keep every document', async (t) => {
  const root = await workspace(t)
  await Promise.all([
    writeTableLayout(root, 'a.md', [table('0:a')]),
    writeTableLayout(root, 'notes/b.md', [table('0:b')]),
  ])
  assert.deepEqual(Object.keys((await stored(root)).documents).sort(), [
    'a.md',
    'notes/b.md',
  ])
})

test('table layout stores a document named __proto__', async (t) => {
  const root = await workspace(t)
  await writeFile(join(root, '__proto__'), '')
  await writeTableLayout(root, '__proto__', [table('0:p')])
  assert.deepEqual(await readTableLayout(root, '__proto__'), [table('0:p')])
  assert.deepEqual(await readTableLayout(root, 'a.md'), [])
  assert.deepEqual(Object.keys((await stored(root)).documents), ['__proto__'])
})

test('table layout stays under its read limit by dropping old documents', async (t) => {
  const root = await workspace(t)
  const names = Array.from({ length: 70 }, (_, index) => `${index}.md`)
  for (const name of names) await writeFile(join(root, name), '')
  const tall = (key) => [table(key, [120], Array(1000).fill(48))]
  for (const name of names) await writeTableLayout(root, name, tall(name))
  const { size } = await stat(join(root, '.hibi/layout.json'))
  assert.ok(size <= 1048576)
  const kept = Object.keys((await stored(root)).documents)
  assert.ok(kept.length < names.length)
  assert.deepEqual(kept, names.slice(-kept.length))
  assert.deepEqual(await readTableLayout(root, '69.md'), tall('69.md'))
  assert.deepEqual(await readTableLayout(root, '0.md'), [])

  const huge = Array.from({ length: 100 }, (_, index) =>
    table(`${index}:a`, [120], Array(1000).fill(48)),
  )
  await assert.rejects(writeTableLayout(root, 'a.md', huge), /too large/)
  assert.deepEqual(Object.keys((await stored(root)).documents), kept)
})

test('table layout recovers from an oversized file', async (t) => {
  const root = await workspace(t)
  await mkdir(join(root, '.hibi'))
  await writeFile(join(root, '.hibi/layout.json'), ' '.repeat(1048577))
  t.mock.method(console, 'warn', () => {})
  assert.deepEqual(await readTableLayout(root, 'a.md'), [])
  await writeTableLayout(root, 'a.md', [table('0:a')])
  assert.deepEqual(await stored(root), {
    version: 1,
    documents: { 'a.md': { tables: [table('0:a')] } },
  })
  assert.equal(console.warn.mock.callCount(), 2)
})
