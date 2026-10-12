import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const { outputFiles, metafile } = await build({
  entryPoints: [
    fileURLToPath(new URL('../src/shared/addon-manifest.ts', import.meta.url)),
  ],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
  metafile: true,
})
const { parseAddonManifest } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
)
const fixture = async (name) =>
  JSON.parse(
    await readFile(
      fileURLToPath(
        new URL(`./fixtures/addon-manifests/${name}.json`, import.meta.url),
      ),
      'utf8',
    ),
  )
const base = {
  id: 'sample',
  name: 'Sample',
  description: 'Manifest fixture',
  apiVersion: 2,
  version: '1.0.0',
  kind: 'extension',
  authors: [{ displayName: 'Test' }],
  entry: 'index.js',
}
const { entry, ...metadata } = base

test('package parser bundles without main, platform, or editor dependencies', () => {
  const paths = Object.keys(metafile.inputs).join('\n')
  assert.doesNotMatch(paths, /node_modules|src\/main\//)
  assert.equal(
    Object.values(metafile.outputs).flatMap((output) => output.imports).length,
    0,
  )
})

for (const item of await fixture('compatibility')) {
  test(`package compatibility: ${item.name}`, () => {
    const parse = () => parseAddonManifest({ ...base, ...item.fields })
    if (item.error) return assert.throws(parse, new RegExp(item.error))
    assert.deepEqual(parse(), {
      manifest: { ...metadata, defaultEnabled: false, ...item.expected },
      entry,
      themes: [],
    })
  })
}

// Captured from foundation-proof installed by d8a33091's installer in a clean profile.
test('current installed manifest retains the captured normalized shape', async () => {
  assert.deepEqual(
    parseAddonManifest(await fixture('installed')),
    await fixture('installed-expected'),
  )
})
