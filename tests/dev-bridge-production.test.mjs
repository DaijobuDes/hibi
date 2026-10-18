import assert from 'node:assert/strict'
import { access, readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

test('production output omits the addon development bridge and watcher', async () => {
  await assert.rejects(access(resolve('out/.addon-restart')), {
    code: 'ENOENT',
  })
  let checked = 0
  for (const directory of ['out/main', 'out/preload', 'out/renderer']) {
    for (const file of await readdir(resolve(directory), { recursive: true })) {
      if (!/\.m?js$/.test(file)) continue
      const code = await readFile(resolve(directory, file), 'utf8')
      assert.doesNotMatch(
        code,
        /addons:development-manifest|updateDevelopmentAddon|developmentContract|hibi:addon-update|watchAddonDevelopment|addon-development/,
        `${directory}/${file} contains addon development code`,
      )
      checked++
    }
  }
  assert.ok(checked > 0, 'production JavaScript was checked')
})
