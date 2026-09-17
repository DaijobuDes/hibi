import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { electronEnvironment } from '../scripts/electron-runtime.mjs'
import { electron } from './electron.mjs'

test('development runtime uses the hibi bundle name and supplied icon', {
  skip: process.platform !== 'darwin',
  timeout: 60000,
}, async (t) => {
  const env = await electronEnvironment()
  const contents = resolve(dirname(env.ELECTRON_EXEC_PATH), '..')
  const plist = JSON.parse(
    execFileSync(
      'plutil',
      ['-convert', 'json', '-o', '-', join(contents, 'Info.plist')],
      { encoding: 'utf8' },
    ),
  )
  assert.equal(plist.CFBundleDisplayName, 'hibi')
  assert.equal(plist.CFBundleName, 'hibi')
  assert.equal(plist.CFBundleIconFile, 'hibi.icns')
  assert.deepEqual(
    await readFile(join(contents, 'Resources/hibi.icns')),
    await readFile('build/icon.icns'),
  )
  const original = JSON.parse(
    execFileSync(
      'plutil',
      [
        '-convert',
        'json',
        '-o',
        '-',
        'node_modules/electron/dist/Electron.app/Contents/Info.plist',
      ],
      { encoding: 'utf8' },
    ),
  )
  assert.equal(original.CFBundleName, 'Electron')
  const profile = await mkdtemp(join(tmpdir(), 'hibi-branding-'))
  const app = await electron.launch({
    executablePath: env.ELECTRON_EXEC_PATH,
    args: [resolve('.'), `--user-data-dir=${profile}`],
  })
  t.after(async () => {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  })
  await (await app.firstWindow())
    .getByRole('textbox', { name: 'document editor' })
    .waitFor()
  assert.equal(await app.evaluate(({ app }) => app.getName()), 'hibi')
})
