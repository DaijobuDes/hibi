import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { electron } from './electron.mjs'

test('Electron cleanup kills a blocked quit and reports failure', {
  timeout: 25000,
}, async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'hibi-blocked-quit-'))
  const app = await electron.launch({
    args: [resolve('.'), `--user-data-dir=${profile}`],
  })
  const child = app.process()
  const exited = once(child, 'exit')
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGKILL')
    await exited
    await rm(profile, { recursive: true, force: true })
  })
  await app.evaluate(({ app }) => {
    app.on('before-quit', (event) => event.preventDefault())
  })
  await assert.rejects(app.close(), /Electron test cleanup exceeded 10 seconds/)
  await exited
  assert.ok(child.exitCode !== null || child.signalCode !== null)
})
