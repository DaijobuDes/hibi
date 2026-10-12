import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  root: resolve('.'),
  server: { middlewareMode: true },
  appType: 'custom',
})
after(() => server.close())
const { readAddonPackages, addonCatalog } = await server.ssrLoadModule(
  '/scripts/addon-packages.ts',
)
const packages = await readAddonPackages()
const stable = (value) =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, field]) => [key, stable(field)]),
        )
      : value

test('all 42 compiled manifests retain their metadata before catalog migration', async () => {
  const expected = JSON.parse(
    await readFile(
      fileURLToPath(
        new URL('./fixtures/addon-catalog-manifests.json', import.meta.url),
      ),
      'utf8',
    ),
  )
  const builtins = packages.filter(({ source }) => source === 'built-in')
  assert.equal(builtins.length, 42)
  for (const { manifest, directory } of builtins) {
    assert.equal(basename(directory), manifest.id)
    assert.equal(
      createHash('sha256')
        .update(JSON.stringify(stable(manifest)))
        .digest('hex'),
      expected[manifest.id],
      manifest.id,
    )
  }
})

test('catalog emits process-specific lazy entries and separate author/license details', async () => {
  const load = async (process, part = process) => {
    const plugin = addonCatalog(process)
    return plugin.load.call(
      { addWatchFile() {} },
      `\0virtual:hibi-addon-catalog/${part}`,
    )
  }
  const main = await load('main')
  const renderer = await load('renderer')
  const details = await load('renderer', 'details')
  assert.match(main, /loadNative:.*import\(/)
  assert.doesNotMatch(main, /index\.tsx?["']/)
  assert.match(renderer, /load:.*import\(/)
  assert.match(renderer, /loadSettings:.*import\(/)
  assert.match(renderer, /import flavors/)
  assert.doesNotMatch(
    renderer,
    /native\.ts|loadNative|node:|electron|authors|licenses/,
  )
  assert.doesNotMatch(main, /"authors"|"licenses"/)
  const records = JSON.parse(details.slice('export default '.length))
  for (const { manifest } of packages) {
    assert.deepEqual(records[manifest.id], {
      ...(manifest.authors ? { authors: manifest.authors } : {}),
      ...(manifest.licenses ? { licenses: manifest.licenses } : {}),
    })
  }
})

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'hibi-addon-catalog-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const folder = join(root, 'src/addons/sample')
  await mkdir(join(folder, 'views'), { recursive: true })
  await writeFile(
    join(folder, 'views/window.tsx'),
    'throw new Error("catalog must not import addon code")',
  )
  const manifest = {
    id: 'sample',
    name: 'Sample',
    description: 'Catalog fixture',
    version: '1.0.0',
    apiVersion: 2,
    kind: 'extension',
    authors: [{ displayName: 'Example' }],
    entry: 'views/window.tsx',
  }
  const write = (value) =>
    writeFile(join(folder, 'hibi-addon.json'), JSON.stringify(value))
  await write(manifest)
  return { root, folder, manifest, write }
}

test('json takes precedence over a legacy shim and declares the owner renderer entry', async (t) => {
  const { root, folder } = await fixture(t)
  await writeFile(
    join(folder, 'manifest.ts'),
    'throw new Error("json must take precedence")',
  )
  const [item] = await readAddonPackages(root)
  assert.equal(item.manifest.id, 'sample')
  assert.equal(item.entry, 'src/addons/sample/views/window.tsx')
})

test('catalog rejects mismatched ids, missing entries and paths outside the package', async (t) => {
  const { root, folder, manifest, write } = await fixture(t)
  await write({ ...manifest, id: 'different' })
  await assert.rejects(readAddonPackages(root), /folder must match/)
  await write({ ...manifest, entry: 'missing.tsx' })
  await assert.rejects(readAddonPackages(root), /ENOENT/)
  await write({ ...manifest, entry: '../outside.ts' })
  await assert.rejects(readAddonPackages(root), /entry/)
  await writeFile(join(root, 'outside.ts'), 'export default {}')
  await symlink(join(root, 'outside.ts'), join(folder, 'linked.ts'), 'file')
  await write({ ...manifest, entry: 'linked.ts' })
  await assert.rejects(
    readAddonPackages(root),
    /regular file inside its folder/,
  )
})

test('catalog rejects oversized json before reading addon entries', async (t) => {
  const { root, manifest, write } = await fixture(t)
  await write({ ...manifest, description: 'x'.repeat(65536) })
  await assert.rejects(readAddonPackages(root), /64 KiB/)
})
